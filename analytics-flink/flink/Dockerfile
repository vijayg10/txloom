# Flink 2.2.1 already ships Java 17 by default; the connector/CEP jars below
# are added on top since the base image doesn't bundle any connectors.
# Versions must match: flink-cep and the Kafka connectors are built against
# the exact Flink minor line (2.2), not just "latest".
FROM flink:2.2.1-java17

ARG KAFKA_CONNECTOR_VERSION=5.0.0-2.2
ARG FLINK_CEP_VERSION=2.2.1

# - flink-sql-connector-kafka: fat jar (Kafka clients included) so Flink SQL
#   `CREATE TABLE ... WITH ('connector' = 'kafka', ...)` works out of the box.
# - flink-cep: not bundled by default; required for SQL MATCH_RECOGNIZE
#   (card-testing.sql) as well as the DataStream CEP library.
RUN wget -q -P /opt/flink/lib \
      "https://repo.maven.apache.org/maven2/org/apache/flink/flink-sql-connector-kafka/${KAFKA_CONNECTOR_VERSION}/flink-sql-connector-kafka-${KAFKA_CONNECTOR_VERSION}.jar" \
    && wget -q -P /opt/flink/lib \
      "https://repo.maven.apache.org/maven2/org/apache/flink/flink-cep/${FLINK_CEP_VERSION}/flink-cep-${FLINK_CEP_VERSION}.jar"

# Presto S3 plugin ships in the image's opt/ dir but isn't enabled by
# default; the entrypoint script reads this env var (also set in
# docker-compose-flink.yaml, redundant here so `docker build` alone is
# reproducible without the compose env).
ENV ENABLE_BUILT_IN_PLUGINS=flink-s3-fs-presto-2.2.1.jar
