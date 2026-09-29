package dev.txloom.flink.common;

import org.apache.flink.util.ParameterTool;
import org.slf4j.Logger;

/** Thin wrapper over ParameterTool: every job's tunable thresholds are
 * `--param value` args (see PLAN.md "Job API" row) with defaults baked in
 * here, logged once at startup so a lab run's effective config is visible
 * in the JobManager/TaskManager logs without re-reading the submit command. */
public final class Params {
    public static final String KAFKA_BROKERS_DEFAULT = "kafka:29092";

    private final ParameterTool tool;

    private Params(ParameterTool tool) {
        this.tool = tool;
    }

    public static Params of(String[] args, Logger log) {
        Params p = new Params(ParameterTool.fromArgs(args));
        log.info("job parameters: {}", p.tool.toMap());
        return p;
    }

    public String brokers() {
        return tool.get("brokers", KAFKA_BROKERS_DEFAULT);
    }

    public String get(String key, String defaultValue) {
        return tool.get(key, defaultValue);
    }

    public long getLong(String key, long defaultValue) {
        return tool.getLong(key, defaultValue);
    }

    public int getInt(String key, int defaultValue) {
        return tool.getInt(key, defaultValue);
    }

    public double getDouble(String key, double defaultValue) {
        return tool.getDouble(key, defaultValue);
    }
}
