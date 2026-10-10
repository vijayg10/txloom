// Typed webhook connection config/secrets (data-model.md §1.1.1–1.1.2).

export interface WebhookConnectionConfig {
  url: string;
  timeout_ms: number;
  max_attempts: number;
}

export interface WebhookConnectionSecrets {
  headers: Record<string, string>;
}

export const webhookConfigSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url"],
  properties: {
    url: { type: "string", pattern: "^https?://" },
    timeout_ms: { type: "integer", minimum: 100, maximum: 60_000, default: 5000 },
    max_attempts: { type: "integer", minimum: 1, maximum: 10, default: 5 },
  },
} as const;

export const webhookSecretsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headers"],
  properties: {
    headers: { type: "object", additionalProperties: { type: "string" } },
  },
} as const;
