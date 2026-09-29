package dev.txloom.flink;

import dev.txloom.flink.common.Alert;
import dev.txloom.flink.common.Event;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.streaming.util.KeyedOneInputStreamOperatorTestHarness;
import org.apache.flink.streaming.util.ProcessFunctionTestHarnesses;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Drives J2's drain-window detection directly. dormancyHours=0 so every
 * transfer trivially satisfies the dormancy precondition — this test is
 * about the drain-count / unseen-counterparty / timer logic, not dormancy
 * itself (PLAN.md's caveat about "first streamed event = first seen"
 * covers that separately). */
class AccountTakeoverJobTest {
    private static final double TRANSFER_AMOUNT_THRESHOLD = 500;
    private static final int DRAIN_COUNT_THRESHOLD = 3;
    private static final long DRAIN_WINDOW_HOURS = 2;

    private KeyedOneInputStreamOperatorTestHarness<String, Event, Alert> harness;

    @BeforeEach
    void setUp() throws Exception {
        AccountTakeoverJob.AccountTakeover function = new AccountTakeoverJob.AccountTakeover(
                0, TRANSFER_AMOUNT_THRESHOLD, DRAIN_COUNT_THRESHOLD, DRAIN_WINDOW_HOURS, 30, 0.2);
        harness = ProcessFunctionTestHarnesses.forKeyedProcessFunction(
                function, event -> event.consumer_id, Types.STRING);
    }

    private static Event transfer(String eventId, String consumerId, String counterpartyId, double amount, long ts) {
        Event event = new Event();
        event.event_id = eventId;
        event.consumer_id = consumerId;
        event.counterparty_id = counterpartyId;
        event.type = "p2p_transfer";
        event.amount = BigDecimal.valueOf(amount);
        event.currency = "USD";
        event.ts = ts;
        event.kafkaRecordTimestampMs = ts;
        return event;
    }

    @Test
    void threeTransfersToUnseenCounterpartiesWithinTheWindowTriggerOneAlertAtWindowClose() throws Exception {
        long drainStart = 0L;
        harness.processElement(transfer("e1", "c1", "cp-a", 600, drainStart), drainStart);
        harness.processElement(transfer("e2", "c1", "cp-b", 600, drainStart + 1_000), drainStart + 1_000);
        harness.processElement(transfer("e3", "c1", "cp-c", 600, drainStart + 2_000), drainStart + 2_000);

        assertTrue(harness.extractOutputValues().isEmpty()); // nothing until the window closes

        long drainWindowMs = DRAIN_WINDOW_HOURS * 3_600_000L;
        harness.processWatermark(drainStart + drainWindowMs);

        List<Alert> alerts = harness.extractOutputValues();
        assertEquals(1, alerts.size());
        assertEquals("account_takeover", alerts.get(0).detector);
        assertEquals("c1", alerts.get(0).entity_id);
        assertEquals(3, alerts.get(0).event_ids.size());
    }

    @Test
    void repeatTransferToAnAlreadySeenCounterpartyDoesNotCountTowardTheDrain() throws Exception {
        long drainStart = 0L;
        harness.processElement(transfer("e1", "c1", "cp-a", 600, drainStart), drainStart);
        // Second transfer to the SAME counterparty — no longer "unseen", must not add to the drain.
        harness.processElement(transfer("e2", "c1", "cp-a", 600, drainStart + 500), drainStart + 500);
        harness.processElement(transfer("e3", "c1", "cp-b", 600, drainStart + 1_000), drainStart + 1_000);
        harness.processElement(transfer("e4", "c1", "cp-c", 600, drainStart + 2_000), drainStart + 2_000);

        long drainWindowMs = DRAIN_WINDOW_HOURS * 3_600_000L;
        harness.processWatermark(drainStart + drainWindowMs);

        List<Alert> alerts = harness.extractOutputValues();
        assertEquals(1, alerts.size());
        assertEquals(3, alerts.get(0).event_ids.size()); // e1, e3, e4 — e2 excluded
    }

    @Test
    void fewerThanThreeQualifyingTransfersProducesNoAlert() throws Exception {
        long drainStart = 0L;
        harness.processElement(transfer("e1", "c1", "cp-a", 600, drainStart), drainStart);
        harness.processElement(transfer("e2", "c1", "cp-b", 600, drainStart + 1_000), drainStart + 1_000);

        long drainWindowMs = DRAIN_WINDOW_HOURS * 3_600_000L;
        harness.processWatermark(drainStart + drainWindowMs);

        assertTrue(harness.extractOutputValues().isEmpty());
    }
}
