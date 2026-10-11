import { useCallback, useEffect, useState } from "react";

/**
 * Filter state that lives in the URL query string, so any filtered view can be bookmarked or
 * shared. Arrays are comma-separated; defaults are omitted to keep URLs short.
 */
export type Shape = Record<string, string | string[]>;

function read<T extends Shape>(defaults: T): T {
  const p = new URLSearchParams(location.search);
  const out: Shape = { ...defaults };
  for (const [k, def] of Object.entries(defaults)) {
    const v = p.get(k);
    if (v == null) continue;
    out[k] = Array.isArray(def) ? v.split(",").filter(Boolean) : v;
  }
  return out as T;
}

function write(state: Shape, defaults: Shape, keep: string[]) {
  const p = new URLSearchParams();
  // Preserve keys owned by other views (e.g. the active tab).
  const current = new URLSearchParams(location.search);
  for (const k of keep) {
    const v = current.get(k);
    if (v != null) p.set(k, v);
  }
  for (const [k, v] of Object.entries(state)) {
    const def = defaults[k];
    if (Array.isArray(v)) {
      if (v.length && v.join(",") !== (def as string[]).join(",")) p.set(k, v.join(","));
    } else if (v !== def && v !== "") p.set(k, v);
  }
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

export function useUrlState<T extends Shape>(defaults: T, keep: string[] = []) {
  const [state, setState] = useState<T>(() => read(defaults));
  useEffect(() => write(state, defaults, keep), [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => setState(s => ({ ...s, [key]: value })), []);
  const toggle = useCallback(<K extends keyof T>(key: K, value: string) =>
    setState(s => {
      const arr = s[key] as unknown as string[];
      return { ...s, [key]: arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value] };
    }), []);
  const reset = useCallback(() => setState(defaults), [defaults]);
  return { state, set, toggle, reset, replace: setState };
}

export function useTab(): [string, (t: string) => void] {
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get("tab") ?? "funding");
  const change = useCallback((t: string) => {
    // Switching tabs starts from a clean query string for the new view.
    history.replaceState(null, "", t === "funding" ? location.pathname : `?tab=${t}`);
    setTab(t);
  }, []);
  return [tab, change];
}
