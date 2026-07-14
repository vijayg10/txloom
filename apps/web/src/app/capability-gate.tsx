import { type ReactNode, useEffect, useState } from "react";
import { getCapabilities, type Capabilities } from "../api/client.js";

/** Reveals a surface only when GET /capabilities advertises the module it needs
 * (FR-012, constitution Principle IV). v1 always renders `fallback` for ai_assist
 * since no embedded LLM ships — the gate exists so a future in-process AI-assist
 * plugin can light up without a UI redeploy. */
export function CapabilityGate({
  module,
  children,
  fallback = null,
}: {
  module: keyof Capabilities["modules"];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCapabilities()
      .then((caps) => {
        if (!cancelled) setCapabilities(caps);
      })
      .catch(() => {
        if (!cancelled) setCapabilities({ modules: { ai_assist: false } });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!capabilities) return null;
  return capabilities.modules[module] ? <>{children}</> : <>{fallback}</>;
}
