// Typed RabbitMQ connection config/secrets (data-model.md §1.1.1–1.1.2).

export interface RabbitConnectionConfig {
  host: string;
  port: number;
  vhost: string;
  tls: boolean;
  ca_pem?: string;
  exchange: string;
  exchange_type: "direct" | "topic" | "fanout";
  default_routing_key: string;
}

export interface RabbitConnectionSecrets {
  username: string;
  password: string;
}

export const rabbitConfigSchema = {
  type: "object",
  additionalProperties: false,
  required: ["host", "exchange", "exchange_type", "default_routing_key"],
  properties: {
    host: { type: "string", minLength: 1 },
    port: { type: "integer", minimum: 1, maximum: 65535 },
    vhost: { type: "string" },
    tls: { type: "boolean" },
    ca_pem: { type: "string" },
    exchange: { type: "string", minLength: 1 },
    exchange_type: { enum: ["direct", "topic", "fanout"] },
    default_routing_key: { type: "string" },
  },
  allOf: [
    {
      if: { properties: { tls: { const: false } } },
      then: { not: { properties: { ca_pem: {} }, required: ["ca_pem"] } },
    },
  ],
} as const;

export const rabbitSecretsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["username", "password"],
  properties: {
    username: { type: "string", minLength: 1 },
    password: { type: "string", minLength: 1 },
  },
} as const;
