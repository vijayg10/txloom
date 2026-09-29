package dev.txloom.flink;

import dev.txloom.flink.common.Event;
import dev.txloom.flink.common.QualityRecord;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.streaming.runtime.streamrecord.StreamRecord;
import org.apache.flink.streaming.util.KeyedOneInputStreamOperatorTestHarness;
import org.apache.flink.streaming.util.ProcessFunctionTestHarnesses;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Drives J1's dedup/late/clock-skew logic directly, without a Kafka
 * source or a MiniCluster — see PLAN.md phase 2 ("validate with a
 * duplicate/late scenario"). */
class CleanAndOrderJobTest {
    private static final long CLOCK_SKEW_THRESHOLD_SECONDS = 60;

    private KeyedOneInputStreamOperatorTestHarness<String, Event, Event> harness;

    @BeforeEach
    void setUp() throws Exception {
        CleanAndOrderJob.CleanAndOrder function =
                new CleanAndOrderJob.CleanAndOrder(1, CLOCK_SKEW_THRESHOLD_SECONDS);
        harness = ProcessFunctionTestHarnesses.forKeyedProcessFunction(
                function, event -> event.event_id, Types.STRING);
    }

    private static Event event(String eventId, String consumerId, long ts, long kafkaRecordTimestampMs) {
        Event event = new Event();
        event.event_id = eventId;
        event.consumer_id = consumerId;
        event.type = "payment";
        event.status = "approved";
        event.amount = BigDecimal.TEN;
        event.currency = "USD";
        event.channel = "web";
        event.ts = ts;
        event.kafkaRecordTimestampMs = kafkaRecordTimestampMs;
        return event;
    }

    private List<QualityRecord> qualityOutput() {
        Iterable<StreamRecord<QualityRecord>> sideOutput = harness.getSideOutput(CleanAndOrderJob.QUALITY_TAG);
        List<QualityRecord> records = new ArrayList<>();
        if (sideOutput != null) {
            sideOutput.forEach(r -> records.add(r.getValue()));
        }
        return records;
    }

    @Test
    void forwardsFirstDeliveryToCleanOutput() throws Exception {
        harness.processElement(event("e1", "c1", 1_000L, 1_000L), 1_000L);

        assertEquals(1, harness.extractOutputValues().size());
        assertEquals("e1", harness.extractOutputValues().get(0).event_id);
        assertTrue(qualityOutput().isEmpty());
    }

    @Test
    void secondDeliveryOfSameEventIdIsFlaggedDuplicateAndDropped() throws Exception {
        harness.processElement(event("e1", "c1", 1_000L, 1_000L), 1_000L);
        harness.processElement(event("e1", "c1", 1_050L, 1_050L), 1_050L);

        assertEquals(1, harness.extractOutputValues().size()); // only the first delivery
        List<QualityRecord> quality = qualityOutput();
        assertEquals(1, quality.size());
        assertEquals("duplicate", quality.get(0).kind);
    }

    @Test
    void eventBehindTheWatermarkIsFlaggedLateAndDroppedFromCleanOutput() throws Exception {
        harness.processWatermark(5_000L);

        harness.processElement(event("e2", "c1", 1_000L, 1_000L), 1_000L);

        assertTrue(harness.extractOutputValues().isEmpty()); // late events don't reach clean
        List<QualityRecord> quality = qualityOutput();
        assertEquals(1, quality.size());
        assertEquals("late", quality.get(0).kind);
        assertEquals(4_000L, quality.get(0).lateness_ms);
    }

    @Test
    void eventWithClockSkewBeyondThresholdIsFlaggedButStillForwarded() throws Exception {
        long ts = 100_000L;
        long kafkaRecordTs = ts - 70_000L; // 70s skew, beyond the 60s default threshold

        harness.processElement(event("e3", "c1", ts, kafkaRecordTs), ts);

        assertEquals(1, harness.extractOutputValues().size()); // skew alone doesn't block forwarding
        List<QualityRecord> quality = qualityOutput();
        assertEquals(1, quality.size());
        assertEquals("clock_skew", quality.get(0).kind);
        assertEquals(70_000L, quality.get(0).skew_ms);
    }
}
