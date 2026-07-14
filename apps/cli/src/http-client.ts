/** Thin typed HTTP client over the same REST surface the web UI and MCP server use
 * (contracts/api.md) — no framework, just fetch. Base URL defaults to the local
 * compose install. */
export class ApiClient {
  constructor(
    private readonly baseUrl: string = process.env.TXLOOM_API_URL ?? "http://localhost:3000/api/v1",
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`${this.baseUrl}${path}`, init);

    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        (payload as { error?: { message?: string } } | undefined)?.error?.message ??
        response.statusText;
      throw new Error(`${method} ${path} failed (${response.status}): ${message}`);
    }
    return payload as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
}
