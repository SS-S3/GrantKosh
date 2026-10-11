import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { label } from "./labels";

export function FilterGroup(props: {
  title: string;
  options: Array<[string, number]>;
  selected: string[];
  labels: Record<string, string>;
  onToggle: (value: string) => void;
  onClear: () => void;
  searchable?: boolean;
  hint?: string;
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  const { title, options, selected, labels, onToggle, onClear, searchable, hint, defaultOpen, children } = props;
  const [expanded, setExpanded] = useState(false);
  const [find, setFind] = useState("");
  const visible = useMemo(() => {
    const f = find.trim().toLowerCase();
    return f ? options.filter(([v]) => label(labels, v).toLowerCase().includes(f)) : options;
  }, [options, find, labels]);
  const LIMIT = 7;
  const shown = expanded || find ? visible : visible.slice(0, LIMIT);
  const open = defaultOpen || selected.length > 0;

  return (
    <details className="fgroup" open={open || undefined}>
      <summary>
        <span>{title}</span>
        {selected.length > 0 && <span className="badge">{selected.length}</span>}
      </summary>
      <div className="fgroup-body">
        {hint && <p className="fhint">{hint}</p>}
        {searchable && options.length > LIMIT && (
          <input className="fsearch" type="search" placeholder={`Find ${title.toLowerCase()}…`} value={find} onChange={e => setFind(e.target.value)} />
        )}
        {children}
        {shown.map(([value, count]) => (
          <label key={value} className={`fopt${count === 0 && !selected.includes(value) ? " zero" : ""}`}>
            <input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} />
            <span className="fopt-label">{label(labels, value)}</span>
            <span className="fopt-count">{count.toLocaleString("en-IN")}</span>
          </label>
        ))}
        {!find && visible.length > LIMIT && (
          <button className="link-btn" onClick={() => setExpanded(x => !x)}>
            {expanded ? "Show fewer" : `Show all ${visible.length}`}
          </button>
        )}
        {selected.length > 0 && (
          <button className="link-btn" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </details>
  );
}

export function Modal(props: { open: boolean; onClose: () => void; children: ReactNode; labelledBy: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={props.labelledBy}
      onClose={props.onClose}
      onClick={e => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      <button className="modal-close" aria-label="Close" onClick={props.onClose}>
        ×
      </button>
      <div className="modal-body">{props.children}</div>
    </dialog>
  );
}

export function SearchBox(props: { value: string; onChange: (v: string) => void; placeholder: string }) {
  // Debounce so typing stays smooth over thousands of records.
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  useEffect(() => {
    if (draft === props.value) return;
    const t = setTimeout(() => props.onChange(draft), 160);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="searchbox">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
        <path fill="currentColor" d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.39A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" />
      </svg>
      <input type="search" value={draft} placeholder={props.placeholder} onChange={e => setDraft(e.target.value)} aria-label={props.placeholder} />
    </div>
  );
}

export function useShowMore<T>(rows: T[], step: number, resetKey: unknown) {
  const [n, setN] = useState(step);
  useEffect(() => setN(step), [resetKey, step]);
  return { visible: rows.slice(0, n), more: rows.length > n, showMore: () => setN(x => x + step), remaining: Math.max(0, rows.length - n) };
}
