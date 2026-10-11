import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { ApiClient } from "../http-client.js";
import type { Command } from "../registry.js";

interface ConnectionView {
  id: string;
  type: string;
  name: string;
  has_credentials: boolean;
  health: { last_test_at: string | null; ok: boolean | null; summary: string | null };
}

interface ProbeView {
  ok: boolean;
  stage: string;
  detail: string;
}

const ADD_USAGE = `Usage: txloom connections-add <kafka|rabbitmq|webhook> <name> [flags]
  kafka:    --bootstrap host:port[,host:port] --topic T [--security PLAINTEXT|SSL|SASL_PLAINTEXT|SASL_SSL]
            [--sasl PLAIN|SCRAM-SHA-256|SCRAM-SHA-512] [--ca-file path] [--username U]
  rabbitmq: --host H --exchange X --routing-key K [--exchange-type direct|topic|fanout] [--port N]
            [--vhost V] [--tls] [--ca-file path] [--username U]
  webhook:  --url URL [--header Name=Value]...
  Passwords: read from a prompt, or from stdin with --password-stdin.`;

/** Parses `--flag value` pairs (repeatable) and bare boolean flags. */
function parseFlags(args: string[]): { positional: string[]; flags: Map<string, string[]> } {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = args[i + 1];
    const value = next !== undefined && !next.startsWith("--") ? args[++i]! : "true";
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { positional, flags };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

/** Prompts on the terminal without echoing what is typed. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const writable = rl as unknown as { _writeToOutput: (s: string) => void };
    writable._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stderr.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}

async function readPassword(flags: Map<string, string[]>): Promise<string> {
  if (flags.has("password-stdin")) return readStdin();
  if (!process.stdin.isTTY) {
    throw new Error("No terminal to prompt on — pass the password with --password-stdin.");
  }
  return promptHidden("Password: ");
}

function one(flags: Map<string, string[]>, name: string): string | undefined {
  return flags.get(name)?.[0];
}

function required(flags: Map<string, string[]>, name: string): string {
  const value = one(flags, name);
  if (!value) throw new Error(`Missing --${name}\n${ADD_USAGE}`);
  return value;
}

async function buildBody(type: string, name: string, flags: Map<string, string[]>) {
  const username = one(flags, "username");
  const wantsPassword = flags.has("password-stdin") || username !== undefined;
  const caFile = one(flags, "ca-file");
  const caPem = caFile ? { ca_pem: readFileSync(caFile, "utf8") } : {};

  if (type === "kafka") {
    const sasl = one(flags, "sasl");
    const config = {
      bootstrap_servers: required(flags, "bootstrap").split(","),
      security_protocol: one(flags, "security") ?? (sasl ? "SASL_SSL" : "PLAINTEXT"),
      default_topic: required(flags, "topic"),
      ...(sasl ? { sasl_mechanism: sasl } : {}),
      ...caPem,
    };
    const secrets = wantsPassword
      ? { username: required(flags, "username"), password: await readPassword(flags) }
      : undefined;
    return { type, name, config, ...(secrets ? { secrets } : {}) };
  }

  if (type === "rabbitmq") {
    const port = one(flags, "port");
    const vhost = one(flags, "vhost");
    const config = {
      host: required(flags, "host"),
      exchange: required(flags, "exchange"),
      exchange_type: one(flags, "exchange-type") ?? "topic",
      default_routing_key: required(flags, "routing-key"),
      ...(port ? { port: Number(port) } : {}),
      ...(vhost ? { vhost } : {}),
      ...(flags.has("tls") ? { tls: true } : {}),
      ...caPem,
    };
    const secrets = wantsPassword
      ? { username: required(flags, "username"), password: await readPassword(flags) }
      : undefined;
    return { type, name, config, ...(secrets ? { secrets } : {}) };
  }

  if (type === "webhook") {
    const headers: Record<string, string> = {};
    for (const header of flags.get("header") ?? []) {
      const eq = header.indexOf("=");
      if (eq < 1) throw new Error(`--header expects Name=Value, got "${header}"`);
      headers[header.slice(0, eq)] = header.slice(eq + 1);
    }
    const hasHeaders = Object.keys(headers).length > 0;
    return {
      type,
      name,
      config: { url: required(flags, "url") },
      ...(hasHeaders ? { secrets: { headers } } : {}),
    };
  }

  throw new Error(`Unknown connection type "${type}"\n${ADD_USAGE}`);
}

export const connectionsListCommand: Command = {
  name: "connections-list",
  description: "List saved connections: txloom connections-list",
  async run() {
    const client = new ApiClient();
    const { connections } = await client.get<{ connections: ConnectionView[] }>("/connections");
    for (const c of connections) {
      const tested = c.health.last_test_at ? (c.health.ok ? "ok" : "failed") : "untested";
      console.log(`${c.id} ${c.name} (${c.type}) — ${tested}`);
    }
  },
};

export const connectionsAddCommand: Command = {
  name: "connections-add",
  description: "Add a connection: txloom connections-add <type> <name> [flags]",
  async run(args) {
    const { positional, flags } = parseFlags(args);
    const [type, name] = positional;
    if (!type || !name) throw new Error(ADD_USAGE);
    const body = await buildBody(type, name, flags);
    const client = new ApiClient();
    const created = await client.post<ConnectionView>("/connections", body);
    console.log(`connection ${created.id}: ${created.name} (${created.type})`);
  },
};

export const connectionsTestCommand: Command = {
  name: "connections-test",
  description: "Test a connection: txloom connections-test <connection_id>",
  async run(args) {
    const [connectionId] = args;
    if (!connectionId) throw new Error("Usage: txloom connections-test <connection_id>");
    const client = new ApiClient();
    const result = await client.post<ProbeView>(`/connections/${connectionId}/test`);
    console.log(`${result.ok ? "ok" : `failed at ${result.stage}`}: ${result.detail}`);
    if (!result.ok) process.exitCode = 1;
  },
};
