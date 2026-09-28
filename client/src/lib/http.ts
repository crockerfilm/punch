/** Shared fetch-and-parse-JSON helper: throws the server's `error` field (or a fallback
 * message) on a non-ok response, otherwise returns the parsed body. Every route in this
 * app always responds with JSON on success; on failure it may not (a Multer/Express-layer
 * error, a proxy timeout), hence the `.catch(() => ({}))` — never let a non-JSON error body
 * itself become the visible error message. */
export async function fetchJson<T = unknown>(url: string, opts: RequestInit | undefined, fallbackMessage: string): Promise<T> {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || fallbackMessage);
  return r.json();
}
