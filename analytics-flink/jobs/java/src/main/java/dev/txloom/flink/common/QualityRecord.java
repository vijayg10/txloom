package dev.txloom.flink.common;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;

import java.math.BigDecimal;

/** One row per data-quality finding on the raw stream — J1's side output
 * (txloom-flink-quality). `kind` is "duplicate", "late" or "clock_skew";
 * lateness/skew are only set for the matching kind. */
public class QualityRecord {
    public String event_id;

    @JsonSerialize(using = EpochMillisJson.Serializer.class)
    @JsonDeserialize(using = EpochMillisJson.Deserializer.class)
    public long ts;

    public String type;
    public String consumer_id;
    public String merchant_id;
    public BigDecimal amount;
    public String currency;
    public String channel;
    public String kind;
    public Long lateness_ms;
    public Long skew_ms;

    @JsonSerialize(using = EpochMillisJson.Serializer.class)
    @JsonDeserialize(using = EpochMillisJson.Deserializer.class)
    public long detected_at;

    public QualityRecord() {}

    public static QualityRecord of(Event event, String kind, Long latenessMs, Long skewMs) {
        QualityRecord q = new QualityRecord();
        q.event_id = event.event_id;
        q.ts = event.ts;
        q.type = event.type;
        q.consumer_id = event.consumer_id;
        q.merchant_id = event.merchant_id;
        q.amount = event.amount;
        q.currency = event.currency;
        q.channel = event.channel;
        q.kind = kind;
        q.lateness_ms = latenessMs;
        q.skew_ms = skewMs;
        q.detected_at = System.currentTimeMillis();
        return q;
    }
}
