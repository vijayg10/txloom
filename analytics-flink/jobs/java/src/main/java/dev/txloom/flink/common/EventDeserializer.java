package dev.txloom.flink.common;

import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.apache.flink.connector.kafka.source.reader.deserializer.KafkaRecordDeserializationSchema;
import org.apache.flink.util.Collector;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * JSON -&gt; {@link Event}, tolerant of malformed records: logs and skips
 * rather than crashing the job, matching the rest of the stack's
 * "skip broken messages" convention (see analytics/'s
 * kafka_skip_broken_messages). Implemented against the record-level
 * schema (not a plain value deserializer) specifically to read
 * {@code ConsumerRecord.timestamp()} for clock-skew detection.
 */
public class EventDeserializer implements KafkaRecordDeserializationSchema<Event> {
    private static final Logger LOG = LoggerFactory.getLogger(EventDeserializer.class);

    @Override
    public void deserialize(ConsumerRecord<byte[], byte[]> record, Collector<Event> out) {
        if (record.value() == null) {
            return;
        }
        try {
            Event event = Json.MAPPER.readValue(record.value(), Event.class);
            event.kafkaRecordTimestampMs = record.timestamp();
            out.collect(event);
        } catch (Exception e) {
            LOG.warn(
                    "Skipping unparseable event on {}-{}@{}: {}",
                    record.topic(), record.partition(), record.offset(), e.getMessage());
        }
    }

    @Override
    public TypeInformation<Event> getProducedType() {
        return TypeInformation.of(Event.class);
    }
}
