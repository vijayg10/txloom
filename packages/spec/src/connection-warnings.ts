// FR-012: a connection pointed at `localhost`/`127.0.0.1`/`::1` almost always means the
// author meant the worker's own network, not theirs — the worker is what actually
// publishes (research R10/R11), so this warning is shared by the UI and the API.

const LOCALHOST_RE = /^(localhost|127\.0\.0\.1|::1)$/i;

export interface ConnectionWarning {
  code: "localhost_address" | "topic_missing";
  message: string;
}

export const LOCALHOST_WARNING_MESSAGE =
  "This address is resolved by the TxLoom worker. Inside Docker, localhost is the worker itself; the bundled demo broker is kafka:29092.";

function hostsOf(type: "kafka" | "rabbitmq" | "webhook", config: Record<string, unknown>): string[] {
  if (type === "kafka") {
    const servers = (config.bootstrap_servers as string[] | undefined) ?? [];
    return servers.map((s) => s.split(":")[0] ?? s);
  }
  if (type === "rabbitmq") {
    return [config.host as string].filter(Boolean);
  }
  try {
    return [new URL(config.url as string).hostname];
  } catch {
    return [];
  }
}

/** Returns the `localhost_address` warning when any host in `config` resolves to the
 * caller's own loopback address rather than the worker's network. */
export function addressWarnings(
  type: "kafka" | "rabbitmq" | "webhook",
  config: Record<string, unknown>,
): ConnectionWarning[] {
  const isLocalhost = hostsOf(type, config).some((host) => LOCALHOST_RE.test(host));
  return isLocalhost
    ? [{ code: "localhost_address" as const, message: LOCALHOST_WARNING_MESSAGE }]
    : [];
}
