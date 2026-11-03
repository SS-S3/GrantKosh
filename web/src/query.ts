// Filter state ↔ query string. Shared by the browser (URL and API calls) and the server (API parsing).
// Arrays are comma-separated; defaults are left out to keep URLs short.
export type Shape = Record<string, string | string[]>;

export function parseQuery<T extends Shape>(defaults: T, p: URLSearchParams): T {
  const out: Shape = { ...defaults };
  for (const [k, def] of Object.entries(defaults)) {
    const v = p.get(k);
    if (v == null) continue;
    // Bounded, so a crafted URL can't make the server do much work.
    out[k] = Array.isArray(def) ? v.split(",").filter(Boolean).slice(0, 40).map(x => x.slice(0, 60)) : v.slice(0, 200);
  }
  return out as T;
}

export function toQuery(state: Shape, defaults: Shape, p = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(state)) {
    const def = defaults[k];
    if (Array.isArray(v)) {
      if (v.length && v.join(",") !== (def as string[]).join(",")) p.set(k, v.join(","));
    } else if (v !== def && v !== "") p.set(k, v);
  }
  return p;
}
