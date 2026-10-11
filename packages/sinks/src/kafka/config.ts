// Typed Kafka connection config/secrets (data-model.md §1.1.1–1.1.2), validated by Ajv in
// the API (FR-007) and used to build librdkafka properties in producer.ts (research R10).

export type KafkaSecurityProtocol = "PLAINTEXT" | "SSL" | "SASL_PLAINTEXT" | "SASL_SSL";
export type KafkaSaslMechanism = "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512";

export interface KafkaConnectionConfig {
  bootstrap_servers: string[];
  security_protocol: KafkaSecurityProtocol;
  sasl_mechanism?: KafkaSaslMechanism;
  ca_pem?: string;
  default_topic: string;
  partition_key_field?: string;
}

export interface KafkaConnectionSecrets {
  username: string;
  password: string;
}

export const kafkaConfigSchema = {
  type: "object",
  additionalProperties: false,
  required: ["bootstrap_servers", "security_protocol", "default_topic"],
  properties: {
    bootstrap_servers: {
      type: "array",
      minItems: 1,
      items: { type: "string", pattern: "^[^:\\s]+:\\d+$" },
    },
    security_protocol: { enum: ["PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"] },
    sasl_mechanism: { enum: ["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"] },
    ca_pem: { type: "string" },
    default_topic: { type: "string", pattern: "^[A-Za-z0-9._-]{1,249}$" },
    partition_key_field: { type: "string" },
  },
  // Conditional rules (data-model.md §1.1.1): sasl_mechanism required iff SASL_*,
  // forbidden otherwise; ca_pem allowed only with SSL/SASL_SSL.
  allOf: [
    {
      if: { properties: { security_protocol: { enum: ["SASL_PLAINTEXT", "SASL_SSL"] } } },
      then: { properties: { sasl_mechanism: {} }, required: ["sasl_mechanism"] },
      else: { not: { properties: { sasl_mechanism: {} }, required: ["sasl_mechanism"] } },
    },
    {
      if: { properties: { security_protocol: { enum: ["PLAINTEXT", "SASL_PLAINTEXT"] } } },
      then: { not: { properties: { ca_pem: {} }, required: ["ca_pem"] } },
    },
  ],
} as const;

export const kafkaSecretsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["username", "password"],
  properties: {
    username: { type: "string", minLength: 1 },
    password: { type: "string", minLength: 1 },
  },
} as const;
