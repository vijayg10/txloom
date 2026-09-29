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
 * `ts` is kept as epoch millis internally (cheap to compare for
 * watermarks/timers) but reads/writes as an ISO-8601 string on the wire,
 * matching every other producer/consumer in the repo.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Event {
    public String event_id;
    public String delivery_id;

    @JsonSerialize(using = EpochMillisJson.Serializer.class)
    @JsonDeserialize(using = EpochMillisJson.Deserializer.class)
    public long ts;

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
     * J1 compares it against {@code ts} to detect clock skew (PLAN.md: `ts`
     * is delivery time, not truth time, so this is the only independent
     * signal available).
     */
    @JsonIgnore
    public long kafkaRecordTimestampMs;

    public Event() {}

    public Instant tsAsInstant() {
        return Instant.ofEpochMilli(ts);
    }
}
