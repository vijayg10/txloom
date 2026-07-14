# Security

## Trust boundary (read this first)

**v1 has no authentication.** Anyone who can reach the studio — the REST
API, the WebSocket channels, the `/mcp` agent-integration endpoint, and the
built SPA — has full access: they can read every scenario and run, launch
runs, manage sink connections, and change global settings. This is a
deliberate v1 scope decision (spec.md's Assumptions: "self-hosted for a
single team inside a trusted network... there is no login"), not an
oversight.

**Deploy TxLoom only on a trusted network.** Do not expose port 3000 (or
whatever you map it to) directly to the public internet. If you need
external access, put it behind a VPN or a reverse proxy that adds its own
authentication — TxLoom does not have a hook for that today, so the proxy
has to own the entire access-control decision, not delegate any of it back.

Per-user accounts, roles, and multi-tenancy are explicitly out of v1 scope
(constitution § Technology & Architecture Constraints, "Scope discipline").

## Secrets: sink connection credentials

Sink connections (`sink_connections.credentials_enc`) can hold a
username/password (Kafka SASL, RabbitMQ) for connections that need one.
These are the only user-supplied secrets TxLoom stores.

- **Encrypted at rest**: AES-256-GCM, one envelope per row
  (`iv (12B) || authTag (16B) || ciphertext`), under a single per-install
  key (`apps/api/src/services/secrets.ts`).
- **Never echoed back**: every API response for a sink connection
  (`GET/POST/PATCH /sinks*`) includes only a `has_credentials: boolean` —
  the encrypted blob, and any decrypted form of it, never appears in a
  response body, a log line, or the web UI. The only code path that calls
  `decryptCredentials()` is the test-connection route
  (`apps/api/src/routes/sink-test.ts`), which uses the plaintext in-process
  to open a connection and never returns it.
- **File and webhook sinks have no stored secret** (D15) — a webhook's
  authenticity today is "whoever holds the URL," not a signing secret; if
  you need one, put it in the URL's query string or add a custom header via
  the sink's `config` (unencrypted — don't put a real secret there; this is
  a known v1 limitation, not a recommendation).

## The instance key

Generated on first boot (`getOrCreateInstanceKey`) into
`data/keys/instance.key` (mode `0600`) inside the mounted data volume, or
supplied via the `TXLOOM_INSTANCE_KEY` environment variable (32 bytes,
hex-encoded) if you'd rather manage it outside the volume (e.g. from a
secrets manager injected at container start).

**Back it up.** If `instance.key` is lost, every encrypted sink credential
becomes permanently unreadable — TxLoom has no key-recovery mechanism.
Sink connection _rows_ (broker addresses, topic names — the non-secret
`config`) survive; only the encrypted username/password becomes garbage,
and you'd need to re-enter credentials for each affected connection.

**Rotating the instance key** (no automated command ships in v1 — this is
a manual runbook):

1. Before rotating, read every `sink_connections.credentials_enc` row and
   decrypt it with the _current_ key (`decryptSecret`, the same function
   the test-connection route uses).
2. Generate a new key and either overwrite `data/keys/instance.key` or set
   a new `TXLOOM_INSTANCE_KEY`.
3. Re-encrypt each row's plaintext under the new key (`encryptSecret`) and
   write it back via the sink-connections repository's `update()`.
4. Restart the API/worker containers so they pick up the new key for any
   in-flight connections.

Doing this as a proper `txloom` maintenance command (rather than a
hand-rolled script against the repository classes) is a natural follow-up;
flagged here rather than implied to already exist.

## What's _not_ encrypted

- Scenario specs, spec versions, and run metadata (MySQL) — these describe
  simulated data, not real customer data, so they carry no secrecy
  requirement of their own.
- Sink `config` (broker lists, topic names, webhook URLs) — non-secret by
  design (data-model.md § sink_connections), stored in plaintext JSON.
- Run outputs on the data volume (truth/labels/exports/reports) — synthetic
  data, filesystem-permission-protected like any other file in the volume,
  no additional encryption layer.

## No embedded language model

No LLM ships in the product, and none is configured with any provider key
by TxLoom itself (constitution Principle II). The `/mcp` endpoint only
accepts spec-shaped tool calls that go through the full validation battery
before anything runs — an external agent connected to it can propose specs,
never execute arbitrary code or bypass validation.

## Reporting a vulnerability

If you find a security issue, please avoid filing it as a public GitHub
issue first — reach the maintainers privately (see the repository's contact
details) so a fix can ship before the details are public.
