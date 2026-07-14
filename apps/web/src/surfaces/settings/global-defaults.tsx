import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

interface GlobalDefaults {
  "defaults.currency"?: string;
  "defaults.locale"?: string;
  [key: string]: unknown;
}

/** Connections & settings: global-defaults form (data-model.md § settings) —
 * a flat key→value store, PUT-upserted one field at a time. */
export function GlobalDefaultsForm() {
  const [defaults, setDefaults] = useState<GlobalDefaults | null>(null);
  const [currency, setCurrency] = useState("");
  const [locale, setLocale] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiClient
      .get<GlobalDefaults>("/settings")
      .then((body) => {
        setDefaults(body);
        setCurrency(body["defaults.currency"] ?? "");
        setLocale(body["defaults.locale"] ?? "");
      })
      .catch(() => setDefaults({}));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const body: Record<string, unknown> = {};
    if (currency) body["defaults.currency"] = currency;
    if (locale) body["defaults.locale"] = locale;
    const updated = await apiClient.put<GlobalDefaults>("/settings", body);
    setDefaults(updated);
    setSaved(true);
  }

  if (!defaults) return <p>Loading settings…</p>;

  return (
    <form className="global-defaults" onSubmit={(e) => void save(e)}>
      <h2>Global defaults</h2>
      <label>
        Default currency
        <input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="INR" />
      </label>
      <label>
        Default locale
        <input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="en-IN" />
      </label>
      <button type="submit">Save</button>
      {saved && <p>Saved.</p>}
    </form>
  );
}
