package dev.txloom.flink.common;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;

import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.List;

/** Unified alert schema (see PLAN.md) shared by every detector, Java or SQL. */
public class Alert {
    public String alert_id;
    public String detector;
    public String entity_type;
    public String entity_id;

    @JsonSerialize(using = EpochMillisJson.Serializer.class)
    @JsonDeserialize(using = EpochMillisJson.Deserializer.class)
    public long window_start;

    @JsonSerialize(using = EpochMillisJson.Serializer.class)
    @JsonDeserialize(using = EpochMillisJson.Deserializer.class)
    public long window_end;

    public double score;
    public List<String> event_ids;
    /** Detector-specific fields, as a raw JSON object string — see 00_tables.sql for why. */
    public String details;
    public String merchant_risk_tier;

    @JsonSerialize(using = EpochMillisJson.Serializer.class)
    @JsonDeserialize(using = EpochMillisJson.Deserializer.class)
    public long emitted_at;

    public Alert() {}

    /** Deterministic id (hash of detector+entity+window) so a replay after
     * failover produces the same id; ClickHouse's ReplacingMergeTree on
     * alert_id is the second line of defence. */
    public static String deterministicId(String detector, String entityId, long windowStart) {
        try {
            MessageDigest md5 = MessageDigest.getInstance("MD5");
            byte[] digest = md5.digest(
                    (detector + '|' + entityId + '|' + windowStart).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(32);
            for (byte b : digest) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
