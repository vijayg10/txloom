package dev.txloom.flink.common;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;

import java.io.IOException;
import java.time.Instant;

/** epoch-millis long &lt;-&gt; ISO-8601 string, for every `ts`-shaped field
 * shared between Java POJOs and the JSON topics they read/write. */
public final class EpochMillisJson {
    private EpochMillisJson() {}

    public static final class Serializer extends JsonSerializer<Long> {
        @Override
        public void serialize(Long value, JsonGenerator gen, SerializerProvider serializers) throws IOException {
            gen.writeString(Instant.ofEpochMilli(value).toString());
        }
    }

    public static final class Deserializer extends JsonDeserializer<Long> {
        @Override
        public Long deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
            return Instant.parse(p.getValueAsString()).toEpochMilli();
        }
    }
}
