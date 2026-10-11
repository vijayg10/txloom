# How It Works

TxLoom takes you from a description of a payments world to delivered, labeled transactions in six steps. Everything below can be done in the web studio at `http://localhost:3000`. The CLI and the MCP server use the same API.

## The Flow at a Glance

![The Flow at a Glance](/txloom-flow-at-glance.svg)

::: tip Two-click first run
On a fresh install started with the bundled demo Kafka broker, the home page offers one button: **Start the UPI reference run**. It clones the UPI reference scenario, launches it to the `local-kafka` connection, and moves to the live stream when history is done. Steps 1 to 3 below are what that button does for you.
:::


## Step 1: Author a Scenario

Open **Scenarios**. Start from a blank scenario or from the template gallery:

| Template | What it models | Default output |
|---|---|---|
| UPI-style instant payments | Salaried and gig-worker consumers in India, Diwali seasonality, all three fraud typologies | Kafka |
| Card-present retail | US point-of-sale shoppers, Black Friday seasonality, card testing and refund abuse | Parquet files |
| Mobile money | Wallet and agent-banking customers, account takeover | Webhook |
| Marketplace payouts | Buyers and sellers, holiday seasonality, refund abuse | CSV files |

The scenario workspace shows the spec in a JSON editor with schema autocomplete. Validation runs as you type, and errors point at the exact field. Below the editor, a structural preview summarizes the population, the fraud mix, the imperfection rates and the estimated event volume.

Prefer plain English? Point your own AI agent at `http://localhost:3000/mcp` and describe the scenario. The agent writes and validates the spec, and it lands as a new version in the scenario's history.

Each **Save version** adds to the version history. Any version can be compared with the previous one or rolled back to.


## Step 2: Add Connections

Files need no setup. For Kafka, RabbitMQ or a webhook, open **Connections** and add one:

- **Kafka**: bootstrap servers, security protocol (PLAINTEXT, SSL, SASL_PLAINTEXT, SASL_SSL), SASL mechanism, optional CA certificate, default topic
- **RabbitMQ**: host, port, vhost, TLS, exchange, exchange type, default routing key
- **Webhook**: URL, timeout, attempt limit, optional headers

**Test** runs from the worker, which is where publishing happens, and reports the stage that failed: connect, TLS, auth or topic. You can test before saving. Passwords and headers are write-only and are never shown again.


## Step 3: Launch a Run

Click **Launch** on the scenario page. The launch drawer lists every sink in the spec.

| Setting | What it controls |
|---|---|
| Destination | For each non-file sink, the connection it is sent to, with an optional topic or routing key override |
| Mode | **History only**, or **History, then live** |
| Rate (events/s) | Target rate for the live stream |
| Seed (Advanced) | Leave blank to use the spec's seed |
| Label channel (Advanced) | Also publish labels for streamed events |
| Replay history (Advanced) | Send the whole generated history to each broker before the live stream starts |

The drawer shows an estimate of history events, partitions and generation time before you commit. Destinations are remembered per scenario, so the next launch is one click.


## Step 4: Watch It Run

The run page has five tabs: **Progress**, **Live**, **Inspect**, **Ground truth** and **Export**.

### Progress

A run moves through phases: `generating`, then `replaying` if you asked for a history replay, then `live`. The Progress tab shows per-partition progress and throughput, with **Pause**, **Resume** and **Cancel**. A failed run can be retried, and only the partitions that did not finish are generated again.

The tab also shows the immutable run record (scenario, spec version, seed) and a **Regenerate exactly this dataset** button.

### Live

When history is done, a `history_then_live` run starts streaming by itself and the page moves to the Live tab. The stream console shows:

- **Throughput** achieved against the target
- **Sink lag**: messages the destination still owes an acknowledgement for
- **Paced rate**: the rate TxLoom is currently allowing, which drops under backpressure and recovers
- **Failed** deliveries and a **Backpressure** indicator
- **Simulated time** and the session number
- A ticker of sampled live events

You can **Pause**, **Resume** and **Stop** the stream, and change the rate while it runs. Starting a stopped stream again opens a new session that continues the same simulated world.


## Step 5: Inspect the World

The **Inspect** tab renders the run before you export anything:

- **Volume over time**, with seasonality windows shaded
- **Amount distributions** per event type
- **Persona heatmap**: activity by day of week and hour of day
- **Fraud timeline**: fraud events per day, per typology
- **Imperfection audit**: how many deliveries of each corruption type each sink received
- **Realism report**: amount statistics, inter-arrival times, achieved fraud rate against the target, and a benchmark comparison where the template provides one

Any two runs can be compared side by side.


## Step 6: Explore Ground Truth and Export

The **Ground truth** tab lists labeled events. Filter by typology, then click an actor to see that actor's story: every step of the campaign in order, with time, type, status, amount and the parties involved.

The **Export** tab builds downloadable files:

- **Source**: the truth, or a file sink's delivered copy (which includes that sink's imperfections)
- **Format**: CSV, Parquet or JSON
- **Labels**: excluded by default. The answer key is a separate file. Merging labels into the main export requires acknowledging a warning, because a labeled dataset must not be fed to the system under test by accident.

Exports are built in the background. The page shows queued, running and completed status, then the download.
