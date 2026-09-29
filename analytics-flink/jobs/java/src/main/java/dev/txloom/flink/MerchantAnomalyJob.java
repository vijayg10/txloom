package dev.txloom.flink;

import dev.txloom.flink.common.Alert;
import dev.txloom.flink.common.Event;
import dev.txloom.flink.common.EventDeserializer;
import dev.txloom.flink.common.Json;
import dev.txloom.flink.common.MerchantRef;
import dev.txloom.flink.common.Params;
import dev.txloom.flink.common.Sinks;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.AggregateFunction;
import org.apache.flink.api.common.functions.OpenContext;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.api.common.typeinfo.BasicTypeInfo;
import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.apache.flink.api.common.typeinfo.TypeHint;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.connector.kafka.source.reader.deserializer.KafkaRecordDeserializationSchema;
import org.apache.flink.streaming.api.datastream.BroadcastStream;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.datastream.KeyedStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.functions.co.KeyedBroadcastProcessFunction;
import org.apache.flink.streaming.api.functions.windowing.ProcessWindowFunction;
import org.apache.flink.streaming.api.windowing.assigners.TumblingEventTimeWindows;
import org.apache.flink.streaming.api.windowing.windows.TimeWindow;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.Serializable;
import java.time.Duration;

/**
 * J3 merchant-anomaly (PLAN.md use cases 7 & 8): 1-minute per-merchant
 * volume/decline-rate windows; an EWMA mean/variance of volume carried in
 * keyed state across windows flags a window as anomalous once its z-score
 * exceeds the threshold (after a warm-up period, since a fresh EWMA with
 * near-zero variance would otherwise flag almost everything). Also
 * broadcasts txloom-flink-merchant-ref (hand-published in LABS.md #9) to
 * enrich its own alerts with merchant_risk_tier — publishing a new record
 * changes future alerts without a redeploy.
 *
 * Caveat: the EWMA baseline updates on every window, anomalous or not, so
 * a sustained spike gradually pulls the baseline toward itself — a known
 * limitation of simple online EWMA anomaly detection, worth observing in
 * LABS.md #10 rather than "fixing" here.
 */
public class MerchantAnomalyJob {
    private static final Logger LOG = LoggerFactory.getLogger(MerchantAnomalyJob.class);

    private static final MapStateDescriptor<String, MerchantRef> MERCHANT_REF_DESCRIPTOR =
            new MapStateDescriptor<>("merchant-ref", BasicTypeInfo.STRING_TYPE_INFO, TypeInformation.of(new TypeHint<MerchantRef>() {}));

    public static void main(String[] args) throws Exception {
        Params params = Params.of(args, LOG);
        String brokers = params.brokers();
        String inputTopic = params.get("input-topic", "txloom-flink-clean");
        String merchantRefTopic = params.get("merchant-ref-topic", "txloom-flink-merchant-ref");
        String alertsTopic = params.get("alerts-topic", "txloom-flink-alerts");
        String groupId = params.get("group-id", "txloom-flink-j3-merchant-anomaly");
        String merchantRefGroupId = params.get("merchant-ref-group-id", "txloom-flink-j3-merchant-ref");

        int warmupWindows = params.getInt("warmup-windows", 10);
        double zScoreThreshold = params.getDouble("z-score-threshold", 3.0);
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

        KeyedStream<MerchantWindowStats, String> windowed = events
                .filter(e -> e.merchant_id != null)
                .keyBy(e -> e.merchant_id)
                .window(TumblingEventTimeWindows.of(Duration.ofMinutes(1)))
                .aggregate(new VolumeDeclineAggregate(), new AttachWindowTimes())
                .keyBy(stats -> stats.merchantId);

        KafkaSource<MerchantRef> merchantRefSource = KafkaSource.<MerchantRef>builder()
                .setBootstrapServers(brokers)
                .setTopics(merchantRefTopic)
                .setGroupId(merchantRefGroupId)
                .setStartingOffsets(OffsetsInitializer.earliest())
                .setDeserializer(merchantRefDeserializer())
                .build();
        BroadcastStream<MerchantRef> merchantRefBroadcast = env
                .fromSource(merchantRefSource, WatermarkStrategy.noWatermarks(), "merchant-ref-source")
                .broadcast(MERCHANT_REF_DESCRIPTOR);

        DataStream<Alert> alerts = windowed
                .connect(merchantRefBroadcast)
                .process(new MerchantAnomalyDetector(warmupWindows, zScoreThreshold, ewmaAlpha))
                .name("merchant-anomaly")
                .uid("merchant-anomaly");

        alerts.sinkTo(Sinks.exactlyOnce(brokers, alertsTopic, "txloom-flink-j3-merchant-anomaly-", a -> a.entity_id))
                .name("alerts-sink")
                .uid("alerts-sink");

        env.execute("txloom-flink-j3-merchant-anomaly");
    }

    private static KafkaRecordDeserializationSchema<MerchantRef> merchantRefDeserializer() {
        return new KafkaRecordDeserializationSchema<>() {
            @Override
            public void deserialize(org.apache.kafka.clients.consumer.ConsumerRecord<byte[], byte[]> record, Collector<MerchantRef> out) {
                if (record.value() == null) {
                    return; // tombstone (compacted-topic delete) — nothing to broadcast
                }
                try {
                    out.collect(Json.MAPPER.readValue(record.value(), MerchantRef.class));
                } catch (IOException e) {
                    LOG.warn("Skipping unparseable merchant-ref record at offset {}: {}", record.offset(), e.getMessage());
                }
            }

            @Override
            public TypeInformation<MerchantRef> getProducedType() {
                return TypeInformation.of(MerchantRef.class);
            }
        };
    }

    public static class MerchantWindowStats implements Serializable {
        public String merchantId;
        public long windowStart;
        public long windowEnd;
        public int volume;
        public double declineRate;

        public MerchantWindowStats() {}
    }

    /** Partial per-window accumulator: total events and declined count. */
    private static class DeclineAcc implements Serializable {
        int count;
        int declined;
    }

    private static class VolumeDeclineAggregate implements AggregateFunction<Event, DeclineAcc, DeclineAcc> {
        @Override
        public DeclineAcc createAccumulator() {
            return new DeclineAcc();
        }

        @Override
        public DeclineAcc add(Event event, DeclineAcc acc) {
            acc.count++;
            if ("declined".equals(event.status)) {
                acc.declined++;
            }
            return acc;
        }

        @Override
        public DeclineAcc getResult(DeclineAcc acc) {
            return acc;
        }

        @Override
        public DeclineAcc merge(DeclineAcc a, DeclineAcc b) {
            a.count += b.count;
            a.declined += b.declined;
            return a;
        }
    }

    private static class AttachWindowTimes
            extends ProcessWindowFunction<DeclineAcc, MerchantWindowStats, String, TimeWindow> {
        @Override
        public void process(String merchantId, Context context, Iterable<DeclineAcc> input, Collector<MerchantWindowStats> out) {
            DeclineAcc acc = input.iterator().next();
            MerchantWindowStats stats = new MerchantWindowStats();
            stats.merchantId = merchantId;
            stats.windowStart = context.window().getStart();
            stats.windowEnd = context.window().getEnd();
            stats.volume = acc.count;
            stats.declineRate = acc.count == 0 ? 0.0 : (double) acc.declined / acc.count;
            out.collect(stats);
        }
    }

    /** EWMA mean/variance of volume, keyed by merchant_id, carried across windows. */
    static class MerchantAnomalyDetector
            extends KeyedBroadcastProcessFunction<String, MerchantWindowStats, MerchantRef, Alert> {
        private final int warmupWindows;
        private final double zScoreThreshold;
        private final double ewmaAlpha;

        private transient ValueState<Double> ewmaMean;
        private transient ValueState<Double> ewmaVariance;
        private transient ValueState<Integer> windowCount;

        MerchantAnomalyDetector(int warmupWindows, double zScoreThreshold, double ewmaAlpha) {
            this.warmupWindows = warmupWindows;
            this.zScoreThreshold = zScoreThreshold;
            this.ewmaAlpha = ewmaAlpha;
        }

        @Override
        public void open(OpenContext openContext) {
            ewmaMean = getRuntimeContext().getState(new ValueStateDescriptor<>("ewma-mean", Double.class));
            ewmaVariance = getRuntimeContext().getState(new ValueStateDescriptor<>("ewma-variance", Double.class));
            windowCount = getRuntimeContext().getState(new ValueStateDescriptor<>("window-count", Integer.class));
        }

        @Override
        public void processBroadcastElement(MerchantRef ref, Context ctx, Collector<Alert> out) throws Exception {
            ctx.getBroadcastState(MERCHANT_REF_DESCRIPTOR).put(ref.merchant_id, ref);
        }

        @Override
        public void processElement(MerchantWindowStats stats, ReadOnlyContext ctx, Collector<Alert> out) throws Exception {
            double volume = stats.volume;
            Double mean = ewmaMean.value();
            Double variance = ewmaVariance.value();
            int seenWindows = windowCount.value() == null ? 0 : windowCount.value();

            if (mean != null && variance != null && seenWindows >= warmupWindows) {
                double stddev = Math.sqrt(variance);
                if (stddev > 0) {
                    double zScore = (volume - mean) / stddev;
                    if (Math.abs(zScore) > zScoreThreshold) {
                        MerchantRef ref = ctx.getBroadcastState(MERCHANT_REF_DESCRIPTOR).get(stats.merchantId);
                        Alert alert = new Alert();
                        alert.detector = "merchant_anomaly";
                        alert.entity_type = "merchant";
                        alert.entity_id = stats.merchantId;
                        alert.window_start = stats.windowStart;
                        alert.window_end = stats.windowEnd;
                        alert.alert_id = Alert.deterministicId(alert.detector, alert.entity_id, alert.window_start);
                        alert.score = zScore;
                        alert.event_ids = java.util.Collections.emptyList(); // window-level, not per-event
                        alert.details = String.format(
                                "{\"volume\":%d,\"decline_rate\":%s,\"ewma_mean\":%s,\"z_score\":%s}",
                                stats.volume, stats.declineRate, mean, zScore);
                        alert.merchant_risk_tier = ref == null ? null : ref.risk_tier;
                        alert.emitted_at = System.currentTimeMillis();
                        out.collect(alert);
                    }
                }
            }

            // Update the EWMA baseline with every window, anomalous or not (see class javadoc caveat).
            double newMean = mean == null ? volume : ewmaAlpha * volume + (1 - ewmaAlpha) * mean;
            double deviationSq = (volume - (mean == null ? volume : mean)) * (volume - (mean == null ? volume : mean));
            double newVariance = variance == null ? 0.0 : ewmaAlpha * deviationSq + (1 - ewmaAlpha) * variance;
            ewmaMean.update(newMean);
            ewmaVariance.update(newVariance);
            windowCount.update(seenWindows + 1);
        }
    }
}
