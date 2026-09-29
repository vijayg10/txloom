package dev.txloom.flink.common;

import org.apache.flink.connector.base.DeliveryGuarantee;
import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;
import org.apache.flink.connector.kafka.sink.KafkaSink;

import java.nio.charset.StandardCharsets;
import java.util.Properties;
import java.util.function.Function;

/** Builds exactly-once JSON Kafka sinks. One helper shared by every job so
 * the transactional producer settings (timeout, delivery guarantee) stay
 * consistent across topics. */
public final class Sinks {
    private Sinks() {}

    public static <T> KafkaSink<T> exactlyOnce(
            String brokers, String topic, String transactionalIdPrefix, Function<T, String> keyOf) {
        Properties producerConfig = new Properties();
        // Must stay below the broker's transaction.max.timeout.ms (15 min
        // default) — see PLAN.md.
        producerConfig.setProperty("transaction.timeout.ms", "900000");

        return KafkaSink.<T>builder()
                .setBootstrapServers(brokers)
                .setKafkaProducerConfig(producerConfig)
                .setRecordSerializer(
                        KafkaRecordSerializationSchema.<T>builder()
                                .setTopic(topic)
                                .setKeySerializationSchema(value -> keyOf.apply(value).getBytes(StandardCharsets.UTF_8))
                                .setValueSerializationSchema(Sinks::writeJson)
                                .build())
                .setDeliveryGuarantee(DeliveryGuarantee.EXACTLY_ONCE)
                .setTransactionalIdPrefix(transactionalIdPrefix)
                .build();
    }

    private static byte[] writeJson(Object value) {
        try {
            return Json.MAPPER.writeValueAsBytes(value);
        } catch (Exception e) {
            throw new IllegalStateException("failed to serialize " + value.getClass(), e);
        }
    }
}
