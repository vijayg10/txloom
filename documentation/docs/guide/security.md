# Security

## Trust Boundary

::: danger No authentication
TxLoom has no login. Anyone who can reach the studio (the REST API, the WebSocket channels, the `/mcp` endpoint and the web app) can read every scenario and run, launch runs, manage connections and change settings. This is a deliberate scope decision for a self-hosted tool used by one team on a trusted network.
:::

- Deploy TxLoom only on a trusted network. Do not expose port 3000 directly to the internet.
- For outside access, use a VPN or a reverse proxy that does its own authentication. TxLoom has no hook for delegating access decisions, so the proxy must own the whole decision.
- Per-user accounts, roles and multi-tenancy are out of scope.

## Connection Secrets

Connections can hold a username and password (Kafka SASL, RabbitMQ) or webhook headers. These are the only user-supplied secrets TxLoom stores.

- **Encrypted at rest.** AES-256-GCM, one envelope per row (`iv (12 bytes) || authTag (16 bytes) || ciphertext`), under a single per-install key.
- **Never echoed back.** API responses for a connection include only `has_credentials: true | false`. The encrypted blob and any decrypted form never appear in a response, a log line or the web app.
- **Sealed in job payloads.** A `connection-test` job carries its secrets sealed under the instance key, and the worker unseals them. Plaintext passwords never reach Redis.
- **Decrypted only in process.** The API and worker decrypt a secret only to open a connection, and never return it.
- **`managed_by: env` connections** come from `TXLOOM_CONNECTIONS_JSON` in the container environment, so treat that variable as a secret store. The API refuses to edit or delete these connections.
- **`ca_pem` is not a secret.** It is a public certificate, stored in the connection's `config` and readable through the API.
- **File and webhook sinks have no signing secret.** A webhook's authenticity is "whoever holds the URL". Put a secret in a header on the connection, not in `config` fields that are returned by the API.

## The Instance Key

Generated on first start into `data/keys/instance.key` (mode `0600`) inside the data volume. You can instead supply it with `TXLOOM_INSTANCE_KEY` (32 bytes, hex-encoded), for example from a secrets manager.

::: warning Back it up
If the key is lost, every saved connection password becomes unreadable. TxLoom has no key recovery. Connection rows (broker addresses, topics) survive, but you must re-enter the credentials for each affected connection.
:::

### Rotating the Key

No command ships for this, so rotation is a manual runbook:

1. Before rotating, read every `connections.credentials_enc` value and decrypt it with the current key (`decryptSecret` in `apps/api/src/services/secrets.ts`).
2. Generate a new key. Either overwrite `data/keys/instance.key` or set a new `TXLOOM_INSTANCE_KEY`.
3. Re-encrypt each plaintext under the new key (`encryptSecret`) and write it back through the connections repository.
4. Restart the API and worker containers so they pick up the new key.

A proper maintenance command is a natural follow-up and does not exist yet.

## What Is Not Encrypted

- Scenario specs, spec versions and run metadata (MySQL). They describe simulated data, not real customer data.
- Connection `config`: broker lists, topic names, webhook URLs and `ca_pem`. It is stored as plaintext JSON.
- Run outputs on the data volume (truth, labels, exports, reports). This is synthetic data, protected by filesystem permissions like any other file in the volume.

## No Embedded Language Model

No LLM ships in the product, and TxLoom configures no provider key. The `/mcp` endpoint only accepts spec-shaped tool calls, and every one goes through the full validation battery before anything runs. A connected agent can propose specs. It cannot execute arbitrary code or bypass validation.

## Reporting a Vulnerability

Please do not file a security issue publicly first. Contact the maintainers privately (see the repository's contact details) so a fix can ship before the details are public.
