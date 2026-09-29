package dev.txloom.flink.common;

/** Reference data broadcast from txloom-flink-merchant-ref (compacted topic,
 * hand-published for the broadcast-state lab — see LABS.md #9). */
public class MerchantRef {
    public String merchant_id;
    public String risk_tier;
    public String category;
    public String updated_at;

    public MerchantRef() {}
}
