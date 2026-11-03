import { useCallback, useEffect, useState } from "react";
import { parseQuery, toQuery, type Shape } from "./query";

/**
 * Filter state that lives in the URL query string, so any filtered view can be bookmarked or
 * shared. The same query string is sent to the API.
 */
function write(state: Shape, defaults: Shape, keep: string[]) {
  const p = new URLSearchParams();
  // Preserve keys owned by other views (e.g. the active tab).
  const current = new URLSearchParams(location.search);
  for (const k of keep) {
    const v = current.get(k);
    if (v != null) p.set(k, v);
  }
  const qs = toQuery(state, defaults, p).toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

export function useUrlState<T extends Shape>(defaults: T, keep: string[] = []) {
  const [state, setState] = useState<T>(() => parseQuery(defaults, new URLSearchParams(location.search)));
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
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return t === "advisor" || t === "investors" ? t : "funding";
  });
  const change = useCallback((t: string) => {
    // Switching tabs starts from a clean query string for the new view.
    history.replaceState(null, "", t === "funding" ? location.pathname : `?tab=${t}`);
    setTab(t);
  }, []);
  return [tab, change];
}
