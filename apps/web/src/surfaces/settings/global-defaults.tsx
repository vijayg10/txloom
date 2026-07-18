import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { FormField } from "../../components/ui/form-field.js";
import { Input } from "../../components/ui/input.js";

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

  if (!defaults) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-secondary text-sm">Loading settings…</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Global defaults</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Default currency">
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                placeholder="INR"
              />
            </FormField>
            <FormField label="Default locale">
              <Input
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                placeholder="en-IN"
              />
            </FormField>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit">Save</Button>
            {saved && <p className="text-success text-sm">Saved.</p>}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
