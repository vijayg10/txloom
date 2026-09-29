package dev.txloom.flink;

import dev.txloom.flink.common.Alert;
import dev.txloom.flink.common.Event;
import dev.txloom.flink.common.EventDeserializer;
import dev.txloom.flink.common.Params;
import dev.txloom.flink.common.Sinks;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.OpenContext;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.state.StateTtlConfig;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Serializable;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * J2 account-takeover (PLAN.md use case 4): after >= `dormancy` of
 * inactivity, >= `drain-count` p2p_transfers of >= `transfer-amount` each,
 * to previously-unseen counterparties, within `drain-window` → alert.
 * An event-time timer closes the drain window and emits the summary,
 * rather than firing on the Nth qualifying transfer, so later transfers in
 * the same window are captured.
 *
 * Caveat (PLAN.md): the generator's history phase (batch_then_stream mode)
 * doesn't go through Kafka, so this detector sees a consumer's first
 * streamed event as "first seen" — treated as dormancy-satisfied, since
 * there is no other signal. There's no explicit credential-change event
 * either; detection is purely behavioural.
 */
public class AccountTakeoverJob {
    private static final Logger LOG = LoggerFactory.getLogger(AccountTakeoverJob.class);

    public static void main(String[] args) throws Exception {
        Params params = Params.of(args, LOG);
        String brokers = params.brokers();
        String inputTopic = params.get("input-topic", "txloom-flink-clean");
        String alertsTopic = params.get("alerts-topic", "txloom-flink-alerts");
        String groupId = params.get("group-id", "txloom-flink-j2-account-takeover");

        long dormancyHours = params.getLong("dormancy-hours", 168); // 7d; override low for demos
        double transferAmountThreshold = params.getDouble("transfer-amount-threshold", 500);
        int drainCountThreshold = params.getInt("drain-count-threshold", 3);
        long drainWindowHours = params.getLong("drain-window-hours", 2);
        long knownCounterpartyTtlDays = params.getLong("known-counterparty-ttl-days", 30);
        double ewmaAlpha = params.getDouble("ewma-alpha", 0.2);

        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();

        KafkaSource<Event> source = KafkaSource.<Event>builder()
                .setBootstrapServers(brokers)
                .setTopics(inputTopic)
                .setGroupId(groupId)
                .setStartingOffsets(OffsetsInitializer.earliest())
                .setDeserializer(new EventDeserializer())
                .build();

        WatermarkStrategy<Event> watermarkStrategy =
                WatermarkStrategy.<Event>forBoundedOutOfOrderness(Duration.ofSeconds(5))
                        .withTimestampAssigner((event, recordTimestamp) -> event.ts);

        DataStream<Event> events = env.fromSource(source, watermarkStrategy, "clean-events-source");

        DataStream<Alert> alerts = events
                .keyBy(event -> event.consumer_id)
                .process(new AccountTakeover(
                        dormancyHours, transferAmountThreshold, drainCountThreshold,
                        drainWindowHours, knownCounterpartyTtlDays, ewmaAlpha))
                .name("account-takeover")
                .uid("account-takeover");

        alerts.sinkTo(Sinks.exactlyOnce(brokers, alertsTopic, "txloom-flink-j2-account-takeover-", a -> a.entity_id))
                .name("alerts-sink")
                .uid("alerts-sink");

        env.execute("txloom-flink-j2-account-takeover");
    }

    /** In-progress candidate drain — one open window per consumer at a time. */
    public static class DrainWindow implements Serializable {
        public long windowStart;
        public int count;
        public BigDecimal sumAmount = BigDecimal.ZERO;
        public double sumDeviation;
        public List<String> eventIds = new ArrayList<>();

        public DrainWindow() {}
    }

    /** Keyed by consumer_id. */
    static class AccountTakeover extends KeyedProcessFunction<String, Event, Alert> {
        private final long dormancyMs;
        private final BigDecimal transferAmountThreshold;
        private final int drainCountThreshold;
        private final long drainWindowMs;
        private final long knownCounterpartyTtlDays;
        private final double ewmaAlpha;

        private transient ValueState<Long> lastActivityTs;
        private transient MapState<String, Boolean> knownCounterparties;
        private transient ValueState<DrainWindow> openDrain;
        private transient ValueState<Double> ewmaTransferAmount;

        AccountTakeover(
                long dormancyHours, double transferAmountThreshold, int drainCountThreshold,
                long drainWindowHours, long knownCounterpartyTtlDays, double ewmaAlpha) {
            this.dormancyMs = Duration.ofHours(dormancyHours).toMillis();
            this.transferAmountThreshold = BigDecimal.valueOf(transferAmountThreshold);
            this.drainCountThreshold = drainCountThreshold;
            this.drainWindowMs = Duration.ofHours(drainWindowHours).toMillis();
            this.knownCounterpartyTtlDays = knownCounterpartyTtlDays;
            this.ewmaAlpha = ewmaAlpha;
        }

        @Override
        public void open(OpenContext openContext) {
            lastActivityTs = getRuntimeContext().getState(new ValueStateDescriptor<>("last-activity-ts", Long.class));

            MapStateDescriptor<String, Boolean> counterpartyDescriptor =
                    new MapStateDescriptor<>("known-counterparties", String.class, Boolean.class);
            // Background cleanup of expired state is on by default (Builder only
            // exposes disableCleanupInBackground()) — nothing to opt into here.
            counterpartyDescriptor.enableTimeToLive(
                    StateTtlConfig.newBuilder(Duration.ofDays(knownCounterpartyTtlDays))
                            .setUpdateType(StateTtlConfig.UpdateType.OnCreateAndWrite)
                            .build());
            knownCounterparties = getRuntimeContext().getMapState(counterpartyDescriptor);

            openDrain = getRuntimeContext().getState(new ValueStateDescriptor<>("open-drain", DrainWindow.class));
            ewmaTransferAmount = getRuntimeContext().getState(new ValueStateDescriptor<>("ewma-transfer-amount", Double.class));
        }

        @Override
        public void processElement(Event event, Context ctx, Collector<Alert> out) throws Exception {
            Long lastTs = lastActivityTs.value();
            boolean dormancySatisfied = lastTs == null || (event.ts - lastTs) >= dormancyMs;
            lastActivityTs.update(event.ts);

            if (!"p2p_transfer".equals(event.type)) {
                return;
            }

            Double ewma = ewmaTransferAmount.value();
            double amount = event.amount.doubleValue();
            double deviation = ewma == null ? 0.0 : (amount - ewma) / Math.max(ewma, 1.0);
            ewmaTransferAmount.update(ewma == null ? amount : ewmaAlpha * amount + (1 - ewmaAlpha) * ewma);

            boolean counterpartyKnown = event.counterparty_id != null
                    && knownCounterparties.contains(event.counterparty_id);
            if (event.counterparty_id != null) {
                knownCounterparties.put(event.counterparty_id, true);
            }

            boolean qualifies = dormancySatisfied
                    && !counterpartyKnown
                    && event.amount.compareTo(transferAmountThreshold) >= 0;
            if (!qualifies) {
                return;
            }

            DrainWindow drain = openDrain.value();
            if (drain == null || event.ts - drain.windowStart > drainWindowMs) {
                drain = new DrainWindow();
                drain.windowStart = event.ts;
                ctx.timerService().registerEventTimeTimer(drain.windowStart + drainWindowMs);
            }
            drain.count++;
            drain.sumAmount = drain.sumAmount.add(event.amount);
            drain.sumDeviation += deviation;
            drain.eventIds.add(event.event_id);
            openDrain.update(drain);
        }

        @Override
        public void onTimer(long timestamp, OnTimerContext ctx, Collector<Alert> out) throws Exception {
            DrainWindow drain = openDrain.value();
            if (drain == null || timestamp < drain.windowStart + drainWindowMs) {
                return; // a newer drain has already superseded this timer
            }
            if (drain.count >= drainCountThreshold) {
                Alert alert = new Alert();
                alert.detector = "account_takeover";
                alert.entity_type = "consumer";
                alert.entity_id = ctx.getCurrentKey();
                alert.window_start = drain.windowStart;
                alert.window_end = timestamp;
                alert.alert_id = Alert.deterministicId(alert.detector, alert.entity_id, alert.window_start);
                alert.score = drain.sumDeviation / drain.count;
                alert.event_ids = drain.eventIds;
                alert.details = String.format(
                        "{\"drain_count\":%d,\"sum_amount\":%s,\"avg_deviation\":%s}",
                        drain.count, drain.sumAmount.toPlainString(), alert.score);
                alert.merchant_risk_tier = null;
                alert.emitted_at = System.currentTimeMillis();
                out.collect(alert);
            }
            openDrain.clear();
        }
    }
}
