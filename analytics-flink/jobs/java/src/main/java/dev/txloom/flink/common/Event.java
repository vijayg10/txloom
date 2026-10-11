package dev.txloom.flink.common;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * A txloom event, shared across every job. Public fields (rather than
 * getters/setters) so this both satisfies Flink's POJO rules and lets
 * Jackson read/write it directly without extra annotations per field.
 * `ts` and `delivered_at` are kept as epoch millis internally (cheap to
 * compare for watermarks/timers) but read/write as ISO-8601 strings on the
 * wire, matching every other producer/consumer in the repo.
 *
 * Wire semantics (txloom engine v4): `ts` is the event time as the source
 * reported it (truth time plus any clock-skew offset) and is never moved by
 * late arrival. `delivered_at` is the simulated arrival time: truth time plus
 * the late-arrival delay, otherwise equal to truth time. Events are published
 * in `delivered_at` order, so order by it, not by `ts`.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Event {
    public String event_id;
    public String delivery_id;

    @JsonSerialize(using = EpochMillisJson.Serializer.class)
    @JsonDeserialize(using = EpochMillisJson.Deserializer.class)
    public long ts;

    /** Simulated arrival time; 0 when the producer predates the field (then {@link #deliveredAtMs} falls back to {@code ts}). */
    @JsonSerialize(using = EpochMillisJson.Serializer.class)
    @JsonDeserialize(using = EpochMillisJson.Deserializer.class)
    public long delivered_at;

    public String type;
    public String status;
    public BigDecimal amount;
    public String currency;
    public String consumer_id;
    public String consumer_name;
    public String merchant_id;
    public String merchant_name;
    public String counterparty_id;
    public String channel;
    public int partition_no;

    /**
     * The Kafka record's own broker timestamp — set by {@link EventDeserializer}
     * from {@code ConsumerRecord.timestamp()}, never present on the wire.
     * J1 compares it against {@code ts} to detect clock skew (PLAN.md: the
     * broker timestamp is the only independent clock available).
     */
    @JsonIgnore
    public long kafkaRecordTimestampMs;

    public Event() {}

    public Instant tsAsInstant() {
        return Instant.ofEpochMilli(ts);
    }

    /** When the event arrived (simulated): {@code delivered_at}, or {@code ts} for older producers. */
    public long deliveredAtMs() {
        return delivered_at > 0 ? delivered_at : ts;
    }
}
