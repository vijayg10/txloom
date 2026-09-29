package dev.txloom.flink.common;

import com.fasterxml.jackson.databind.ObjectMapper;

/** One shared, thread-safe Jackson mapper for every job. */
public final class Json {
    public static final ObjectMapper MAPPER = new ObjectMapper();

    private Json() {}
}
