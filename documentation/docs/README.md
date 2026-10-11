---
home: true
title: TxLoom — Synthetic Transaction Studio
heroImage: /images/txloom_logo.png
heroAlt: TxLoom
heroText: Synthetic Transaction Studio
tagline: A self-hosted payments world simulator. Consumers, merchants and fraud actors live in a seeded world, and every transaction it emits comes with ground truth.
actions:
  - text: How It Works
    link: /get-to-know/how-it-works.html
    type: secondary
  - text: Browse the Gallery
    link: /gallery/screenshots
    type: secondary
  - text: View on GitHub
    link: https://github.com/vijayg10/txloom
    type: primary
features:
  - title: A world, not rows
    details: Consumer archetypes with income and spending rhythms, a merchant population, seasonality, and fraud actors running multi-step campaigns over a simulated clock.
  - title: The answer key included
    details: Every event is labeled with is_fraud, typology, actor_id and campaign_step. Labels are exported separately, so they never leak into the data under test.
  - title: History, then live
    details: Generate months of history, then the same world keeps going as a live stream to Kafka, RabbitMQ or a webhook at the rate you set.
  - title: Labeled imperfections
    details: Duplicates, late arrival, out-of-order delivery and clock skew are injected per sink, and each corrupted delivery is recorded in the answer key.
  - title: Reproducible by seed
    details: The same seed and the same spec give byte-identical output. Any completed run can be regenerated exactly.
  - title: Authored by your own agent
    details: An MCP server lets Claude Code, Cursor or any MCP client write and validate scenario specs. No language model ships inside TxLoom.
footer: Apache 2.0 Licensed | TxLoom — Open Source Synthetic Transaction Studio
---
