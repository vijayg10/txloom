package dev.txloom.flink;

import dev.txloom.flink.common.Event;
import dev.txloom.flink.common.EventDeserializer;
import dev.txloom.flink.common.Params;
import dev.txloom.flink.common.QualityRecord;
import dev.txloom.flink.common.Sinks;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.OpenContext;
import org.apache.flink.api.common.state.StateTtlConfig;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.datastream.SingleOutputStreamOperator;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import org.apache.flink.util.OutputTag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;

/**
 * J1 clean-and-order (PLAN.md use cases 1 & 2): every downstream job reads
 * its output, so duplicate-dropping and event-time ordering happen exactly
 * once here. Key by event_id, first delivery wins; late and duplicate
 * events are diverted to the quality side output instead of the clean
 * topic, clock-skewed events are flagged but still forwarded.
 */
public class CleanAndOrderJob {
    private static final Logger LOG = LoggerFactory.getLogger(CleanAndOrderJob.class);

    public static final OutputTag<QualityRecord> QUALITY_TAG = new OutputTag<QualityRecord>("quality") {};

    public static void main(String[] args) throws Exception {
        Params params = Params.of(args, LOG);
        String brokers = params.brokers();
        String inputTopic = params.get("input-topic", "txloom-events");
        String cleanTopic = params.get("clean-topic", "txloom-flink-clean");
        String qualityTopic = params.get("quality-topic", "txloom-flink-quality");
        String groupId = params.get("group-id", "txloom-flink-j1-clean-and-order");
        long watermarkBoundSeconds = params.getLong("watermark-bound-seconds", 30);
        // Lab #4 (idle partitions): set to 0 to disable idleness detection
        // and watch a single-key/low-TPS run stall the watermark instead.
        long idlenessSeconds = params.getLong("idleness-seconds", 60);
        long stateTtlHours = params.getLong("state-ttl-hours", 1);
        long clockSkewThresholdSeconds = params.getLong("clock-skew-threshold-seconds", 60);

        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();

        KafkaSource<Event> source = KafkaSource.<Event>builder()
                .setBootstrapServers(brokers)
                .setTopics(inputTopic)
                .setGroupId(groupId)
                .setStartingOffsets(OffsetsInitializer.earliest())
                .setDeserializer(new EventDeserializer())
                .build();

        WatermarkStrategy<Event> watermarkStrategy =
                WatermarkStrategy.<Event>forBoundedOutOfOrderness(Duration.ofSeconds(watermarkBoundSeconds))
                        .withTimestampAssigner((event, recordTimestamp) -> event.ts);
        if (idlenessSeconds > 0) {
            watermarkStrategy = watermarkStrategy.withIdleness(Duration.ofSeconds(idlenessSeconds));
        }

        DataStream<Event> events = env.fromSource(source, watermarkStrategy, "txloom-events-source");

        SingleOutputStreamOperator<Event> cleaned = events
                .keyBy(event -> event.event_id)
                .process(new CleanAndOrder(stateTtlHours, clockSkewThresholdSeconds))
                .name("clean-and-order")
                .uid("clean-and-order");

        DataStream<QualityRecord> quality = cleaned.getSideOutput(QUALITY_TAG);

        cleaned.sinkTo(Sinks.exactlyOnce(brokers, cleanTopic, "txloom-flink-j1-clean-", e -> e.consumer_id))
                .name("clean-sink")
                .uid("clean-sink");
        quality.sinkTo(Sinks.exactlyOnce(brokers, qualityTopic, "txloom-flink-j1-quality-", q -> q.consumer_id))
                .name("quality-sink")
                .uid("quality-sink");

        env.execute("txloom-flink-j1-clean-and-order");
    }

    /** Keyed by event_id. */
    static class CleanAndOrder extends KeyedProcessFunction<String, Event, Event> {
        private final long stateTtlHours;
        private final long clockSkewThresholdMs;
        private transient ValueState<Boolean> seenState;

        CleanAndOrder(long stateTtlHours, long clockSkewThresholdSeconds) {
            this.stateTtlHours = stateTtlHours;
            this.clockSkewThresholdMs = Duration.ofSeconds(clockSkewThresholdSeconds).toMillis();
        }

        @Override
        public void open(OpenContext openContext) {
            // Background cleanup of expired state is on by default (Builder only
            // exposes disableCleanupInBackground()) — nothing to opt into here.
            StateTtlConfig ttlConfig = StateTtlConfig.newBuilder(Duration.ofHours(stateTtlHours))
                    .setUpdateType(StateTtlConfig.UpdateType.OnCreateAndWrite)
                    .setStateVisibility(StateTtlConfig.StateVisibility.NeverReturnExpired)
                    .build();
            ValueStateDescriptor<Boolean> descriptor = new ValueStateDescriptor<>("seen", Boolean.class);
            descriptor.enableTimeToLive(ttlConfig);
            seenState = getRuntimeContext().getState(descriptor);
        }

        @Override
        public void processElement(Event event, Context ctx, Collector<Event> out) throws Exception {
            Boolean seen = seenState.value();
            if (Boolean.TRUE.equals(seen)) {
                ctx.output(QUALITY_TAG, QualityRecord.of(event, "duplicate", null, null));
                return;
            }
            seenState.update(true);

            long currentWatermark = ctx.timerService().currentWatermark();
            boolean late = currentWatermark != Long.MIN_VALUE && event.ts < currentWatermark;
            if (late) {
                ctx.output(QUALITY_TAG, QualityRecord.of(event, "late", currentWatermark - event.ts, null));
            }

            long skewMs = Math.abs(event.ts - event.kafkaRecordTimestampMs);
            if (skewMs > clockSkewThresholdMs) {
                ctx.output(QUALITY_TAG, QualityRecord.of(event, "clock_skew", null, skewMs));
            }

            if (!late) {
                out.collect(event);
            }
        }
    }
}
