# Configuration

`docker compose up` works with no configuration. This page covers the deployment settings you can change: environment variables, connections and global defaults.

What a simulation contains is configured separately, in the [scenario spec](./scenario-spec.md).

## Compose Variables

`docker-compose.yml` reads these from a `.env` file next to it. Copy `.env.example` to `.env` to change them.

| Variable | Default | Description |
|---|---|---|
| `MYSQL_ROOT_PASSWORD` | `txloom` | MySQL root password |
| `MYSQL_USER` | `txloom` | MySQL user for TxLoom |
| `MYSQL_PASSWORD` | `txloom` | MySQL password for TxLoom |

## Service Variables

These are read by the `api` and `worker` processes. The first four are already set by `docker-compose.yml`.

| Variable | Default | Read by | Description |
|---|---|---|---|
| `DATABASE_URL` | set by compose | api, worker | MySQL connection string |
| `REDIS_URL` | set by compose | api, worker | Redis connection string |
| `DATA_DIR` | `/data` in compose | api, worker | Where run outputs and the instance key are stored. Both services must see the same directory. |
| `PORT` | `3000` | api | HTTP port |
| `HOST` | `0.0.0.0` | api | Bind address |
| `TXLOOM_INSTANCE_KEY` | generated | api, worker | 32 bytes, hex-encoded. Overrides the key file used to encrypt connection secrets. |
| `TXLOOM_CONNECTIONS_JSON` | unset | api | Connections created at startup. See [below](#connections-from-the-environment). |
| `TXLOOM_LOCAL_KAFKA` | `kafka:29092` | api | Address probed at startup to register the `local-kafka` connection |

### Tuning

| Variable | Default | Read by | Description |
|---|---|---|---|
| `TXLOOM_MAX_WORKER_THREADS` | CPUs − 1, limited by memory | api, worker | Partitions one worker generates at once. The default never plans to use more than about 60% of memory at 1 GiB per thread. |
| `TXLOOM_PARTITION_CHUNK_SIZE` | `20000` | api | Consumers per generation partition |
| `TXLOOM_MAX_STREAMS` | `4` | api, worker | Live streams that can run at once |
| `TXLOOM_MAX_DELIVERIES` | `4` | worker | History replays that can run at once |
| `TXLOOM_MAX_EXPORTS` | `2` | worker | Exports that can be built at once |

::: tip Setting service variables with Docker Compose
The `TXLOOM_*` variables are not passed through by the shipped `docker-compose.yml`. Add them under `environment:` for the service that reads them, for example in a `docker-compose.override.yml`:

```yaml
services:
  api:
    environment:
      TXLOOM_MAX_STREAMS: "8"
  worker:
    environment:
      TXLOOM_MAX_STREAMS: "8"
      TXLOOM_MAX_WORKER_THREADS: "6"
```

Set a variable on every service listed in its "Read by" column.
:::

### CLI

| Variable | Default | Description |
|---|---|---|
| `TXLOOM_API_URL` | `http://localhost:3000/api/v1` | API the CLI talks to |

---

## Connections

A connection is a saved Kafka cluster, RabbitMQ broker or webhook endpoint. Manage them on the **Connections** page, through `/api/v1/connections`, or with the CLI. Each non-file sink in a spec is sent to a connection of the same type when a run is launched.

### Kafka

| Field | Required | Description |
|---|---|---|
| `bootstrap_servers` | yes | List of `host:port` |
| `security_protocol` | yes | `PLAINTEXT`, `SSL`, `SASL_PLAINTEXT` or `SASL_SSL` |
| `sasl_mechanism` | with SASL | `PLAIN`, `SCRAM-SHA-256` or `SCRAM-SHA-512` |
| `ca_pem` | no | CA certificate. Allowed with `SSL` and `SASL_SSL` only. |
| `default_topic` | yes | Topic used when a launch does not override it |
| `partition_key_field` | no | Event field used as the message key. Defaults to `consumer_id`. |
| Secrets | with SASL | `username`, `password` |

### RabbitMQ

| Field | Required | Description |
|---|---|---|
| `host` | yes | Broker host |
| `port` | no | Broker port |
| `vhost` | no | Virtual host |
| `tls` | no | Use TLS |
| `ca_pem` | no | CA certificate. Allowed with `tls` only. |
| `exchange` | yes | Exchange to publish to |
| `exchange_type` | yes | `direct`, `topic` or `fanout` |
| `default_routing_key` | yes | Routing key used when a launch does not override it |
| Secrets | no | `username`, `password` |

### Webhook

| Field | Required | Default | Description |
|---|---|---|---|
| `url` | yes | | `http://` or `https://` endpoint. Each event is sent as a JSON `POST`. |
| `timeout_ms` | no | `5000` | Per-request timeout, 100 to 60000 |
| `max_attempts` | no | `5` | Attempts before a delivery is dropped, 1 to 10 |
| Secrets | no | | `headers`: extra request headers, for example an authorization token |

### Testing a connection

**Test** runs from the worker and reports the stage that failed: connect, TLS, auth or topic. A connection can be tested before it is saved.

::: tip Kafka addresses inside Docker
A connection is used by the `worker` container, so `localhost:9092` points at the worker itself. For the bundled demo broker use `kafka:29092`. For a broker on your machine, use an address the container can reach, such as `host.docker.internal:9092`, and make sure the broker advertises that address.
:::

### Secrets

- Passwords and webhook headers are write-only. The API returns `has_credentials: true` and never the values.
- They are encrypted at rest with AES-256-GCM under one instance key.
- The key is generated on first start at `data/keys/instance.key`, or supplied with `TXLOOM_INSTANCE_KEY`.
- A CA certificate is public and is stored with the connection's settings.

::: warning Back up the instance key
If `data/keys/instance.key` is lost, saved passwords and headers cannot be recovered and must be entered again. Broker addresses and topics are not affected.
:::

### Connections from the environment

`TXLOOM_CONNECTIONS_JSON` holds a JSON array of connections created when the API starts. They appear read-only in the studio (`managed_by: env`) and cannot be edited or deleted there.

```json
[
  {
    "type": "kafka",
    "name": "staging-kafka",
    "config": {
      "bootstrap_servers": ["broker-1.internal:9093"],
      "security_protocol": "SASL_SSL",
      "sasl_mechanism": "SCRAM-SHA-512",
      "default_topic": "txloom.events"
    },
    "secrets": { "username": "txloom", "password": "change-me" }
  }
]
```

This variable contains secrets. Treat it as you would any other credential.

---

## Global Defaults

**Settings** in the studio stores two global defaults: a default currency and a default locale. The same page shows the MCP server address and the authoring docs link for AI agents.

---

## Where Data Is Stored

MySQL holds scenarios, spec versions, run records and connections. Everything a run produces is under the data directory:

```text
data/
├── keys/instance.key              # encrypts connection secrets
└── runs/<run_id>/
    ├── truth/                     # truth events, one Parquet file per partition
    ├── labels/                    # answer key: fraud labels
    ├── delivered/<sink>/          # each sink's delivered copy and its labels
    ├── exports/<export_id>/       # files built from the Export tab
    ├── report.json                # realism report
    └── stream-labels.jsonl        # labels for events sent on a live stream
```

Deleting a run's outputs removes its folder. The run record, with its spec snapshot and seed, stays in MySQL so the run can be regenerated.
