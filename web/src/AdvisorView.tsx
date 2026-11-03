import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SignInCta, startSubscription, useAccount, type Me } from "./account";
import { Modal } from "./components";
import { api, type MatchResult, type PublicOpportunity, type Stats } from "./data";
import { amountLabel, deadlineLabel } from "./format";
import { OppDetail } from "./FundingView";
import { FOUNDER, label, PROGRAM_TYPE, SECTOR, STAGE, STATES } from "./labels";
import type { StartupProfile } from "./match";

// ---------- protocol (mirrors agent/src/agent.ts AgentEvent) ----------
interface MatchSummary {
  id: string;
  score: number;
  reasons: string[];
  cautions: string[];
  program: PublicOpportunity;
}
type AgentEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "tool"; label: string }
  | { type: "matches"; items: MatchSummary[] }
  | { type: "done"; model: string }
  | { type: "error"; message: string; code: string };

interface Turn {
  role: "user" | "assistant";
  text: string;
  tools?: string[];
  matches?: MatchSummary[];
  error?: string;
  /** Server error code: "upgrade" and "auth" get a call to action. */
  errorCode?: string;
  pending?: boolean;
}

const STARTERS = [
  "We build counter-drone radar for the Army. Working prototype, Pvt Ltd in Bengaluru, DPIIT recognised. Which iDEX or defence grants fit?",
  "Hardware IoT idea for water quality, two student founders in Tamil Nadu, no company yet. Need about ₹10 lakh to build a prototype.",
  "Woman-led agritech in Maharashtra with early revenue. Want only non-dilutive money.",
  "Biotech point-of-care diagnostics, prototype stage. Compare BIRAC BIG and NIDHI options.",
];

// ---------- SSE over fetch ----------
async function streamChat(messages: Array<{ role: string; content: string }>, headers: Record<string, string>, onEvent: (e: AgentEvent) => void, signal: AbortSignal) {
  const res = await fetch("api/chat", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ messages }), signal });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    onEvent({ type: "error", code: body.code ?? String(res.status), message: body.error ?? `Advisor unavailable (HTTP ${res.status}).` });
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = frame.split("\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6)).join("\n");
      if (data) onEvent(JSON.parse(data) as AgentEvent);
    }
  }
}

// ---------- tiny, safe markdown: **bold**, lists, paragraphs, [[program-id]] chips ----------
function Inline({ text, byId, onOpen }: { text: string; byId: Map<string, PublicOpportunity>; onOpen: (id: string) => void }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("[[") && p.endsWith("]]")) {
          const id = p.slice(2, -2).trim();
          const o = byId.get(id);
          return o ? (
            <button key={i} className="ref-chip" onClick={() => onOpen(id)} title="Open programme details">
              details ↗
            </button>
          ) : null; // unknown id: never show a dead reference
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function RichText({ text, byId, onOpen }: { text: string; byId: Map<string, PublicOpportunity>; onOpen: (id: string) => void }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((t, i) => (
      <li key={i}>
        <Inline text={t} byId={byId} onOpen={onOpen} />
      </li>
    ));
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      heading ? (
        <p key={blocks.length} className="rt-h">
          <Inline text={heading[1]!} byId={byId} onOpen={onOpen} />
        </p>
      ) : (
        <p key={blocks.length}>
          <Inline text={line} byId={byId} onOpen={onOpen} />
        </p>
      ),
    );
  }
  flush();
  return <div className="rich">{blocks}</div>;
}

function MatchCard({ o, m, today, onOpen }: { o: PublicOpportunity; m?: { reasons: string[]; cautions: string[] }; today: string; onOpen: () => void }) {
  const dl = deadlineLabel(o, today);
  return (
    <li className="mcard">
      <button className="card-hit" onClick={onOpen} aria-label={`Open ${o.title}`} />
      <div className="mcard-top">
        <span className="pill pill-type">{PROGRAM_TYPE[o.programType]}</span>
        <span className={`deadline tone-${dl.tone}`}>{dl.text}</span>
      </div>
      <b className="mcard-title">{o.title}</b>
      {o.provider && <span className="mcard-by">{o.provider}</span>}
      <span className="mcard-amt">{amountLabel(o) || "Amount not stated"}</span>
      {m && m.reasons.length > 0 && <span className="mcard-why">✓ {m.reasons.slice(0, 3).join(" · ")}</span>}
      {m && m.cautions.length > 0 && <span className="mcard-check">! {m.cautions.slice(0, 2).join(" · ")}</span>}
    </li>
  );
}

// ---------- guided matcher (no AI needed) ----------
const GUIDED_SECTORS = ["ai", "it-software", "electronics", "semiconductors", "deeptech", "defence", "drones", "space", "biotech", "healthtech", "medtech", "agritech", "food-processing", "cleantech", "climate", "ev-mobility", "fintech", "edtech", "manufacturing", "textiles", "social-impact", "tourism", "media-creative", "logistics"];
const NEEDS = [
  { v: "", l: "Not sure" }, { v: "500000", l: "Up to ₹5L" }, { v: "2500000", l: "₹5L–25L" }, { v: "10000000", l: "₹25L–1Cr" }, { v: "50000000", l: "₹1Cr+" },
];

function GuidedMatcher({ today, onOpen }: { today: string; onOpen: (o: PublicOpportunity) => void }) {
  const [p, setP] = useState<StartupProfile & { text: string }>({ sectors: [], founderTypes: [], text: "" });
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = <K extends "sectors" | "founderTypes">(k: K, v: string) =>
    setP(s => ({ ...s, [k]: (s[k] as string[]).includes(v) ? (s[k] as string[]).filter(x => x !== v) : [...(s[k] as string[]), v] }));
  const run = async () => {
    const { text, ...profile } = p;
    setBusy(true);
    setError("");
    try {
      const res = await api<{ items: MatchResult[] }>("match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, profile }) });
      setResults(res.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="guided">
      <div className="g-row">
        <span className="g-label">What do you build?</span>
        <input className="g-input" placeholder="e.g. AI crop disease detection app" value={p.text} onChange={e => setP(s => ({ ...s, text: e.target.value }))} />
      </div>
      <div className="g-row">
        <span className="g-label">Sectors</span>
        <div className="chips chips-wrap">
          {GUIDED_SECTORS.map(s => (
            <button key={s} className="chip" aria-pressed={p.sectors!.includes(s)} onClick={() => toggle("sectors", s)}>
              {label(SECTOR, s)}
            </button>
          ))}
        </div>
      </div>
      <div className="g-grid">
        <label>
          <span className="g-label">Stage</span>
          <select value={p.stage ?? ""} onChange={e => setP(s => ({ ...s, stage: (e.target.value || undefined) as StartupProfile["stage"] }))}>
            <option value="">Any</option>
            {Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          <span className="g-label">State</span>
          <select value={p.state ?? ""} onChange={e => setP(s => ({ ...s, state: e.target.value || undefined }))}>
            <option value="">Any / not in India</option>
            {Object.entries(STATES).filter(([k]) => k !== "pan-india").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          <span className="g-label">DPIIT recognised?</span>
          <select value={p.dpiit === undefined ? "" : String(p.dpiit)} onChange={e => setP(s => ({ ...s, dpiit: e.target.value === "" ? undefined : e.target.value === "true" }))}>
            <option value="">Not sure</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <label>
          <span className="g-label">Funding need</span>
          <select value={p.needInr ? String(p.needInr) : ""} onChange={e => setP(s => ({ ...s, needInr: e.target.value ? Number(e.target.value) : undefined }))}>
            {NEEDS.map(n => <option key={n.v} value={n.v}>{n.l}</option>)}
          </select>
        </label>
      </div>
      <div className="g-row">
        <span className="g-label">Founders are</span>
        <div className="chips chips-wrap">
          {(["women", "sc-st", "student", "researcher", "youth", "divyang", "minority"] as const).map(f => (
            <button key={f} className="chip" aria-pressed={p.founderTypes!.includes(f)} onClick={() => toggle("founderTypes", f)}>
              {FOUNDER[f]}
            </button>
          ))}
        </div>
      </div>
      <div className="g-row g-switches">
        <label className="fopt"><input type="checkbox" checked={p.equityOk === false} onChange={e => setP(s => ({ ...s, equityOk: e.target.checked ? false : undefined }))} /> Non-dilutive only</label>
        <label className="fopt"><input type="checkbox" checked={!!p.international} onChange={e => setP(s => ({ ...s, international: e.target.checked }))} /> Include international</label>
        <button className="btn btn-primary" onClick={() => void run()} disabled={busy}>{busy ? "Matching…" : "Find my matches"}</button>
      </div>
      {error && <p className="chat-error">{error}</p>}
      {results && (
        results.length ? (
          <>
            <p className="result-meta"><b>{results.length}</b> best matches, ranked on your profile</p>
            <ul className="mcards">
              {results.map(m => <MatchCard key={m.program.id} o={m.program} m={m} today={today} onOpen={() => onOpen(m.program)} />)}
            </ul>
          </>
        ) : <p className="empty">No open programmes match yet. Try fewer filters.</p>
      )}
    </div>
  );
}

// ---------- plan and subscription ----------
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function SubscribeForm({ me }: { me: Me }) {
  const { authHeaders } = useAccount();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!me.canSubscribe) return null;
  if (!open) {
    return (
      <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        Subscribe · ₹{me.priceInr}/month
      </button>
    );
  }
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await startSubscription(phone.replace(/\D/g, "").slice(-10), await authHeaders());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form
      className="subscribe"
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <input className="g-input" inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile for UPI AutoPay" value={phone} onChange={e => setPhone(e.target.value)} aria-label="Mobile number" />
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || phone.replace(/\D/g, "").length < 10}>
        {busy ? "Opening…" : `Pay ₹${me.priceInr}/month`}
      </button>
      {error && <span className="chat-error">{error}</span>}
      <span className="fine">
        Billed monthly by Cashfree via UPI AutoPay or card{me.plan === "trial" && me.trialEndsAt ? `, first charge when your trial ends on ${dateLabel(me.trialEndsAt)}` : ""}. Cancel any time from your UPI app or bank.
      </span>
    </form>
  );
}

function TrialClaimForm({ me }: { me: Me }) {
  const { authHeaders, refresh, openProfile } = useAccount();
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!me.phoneVerified) {
    return (
      <div className="subscribe">
        <span className="fine">To start your free {me.trialDays}-day trial, first add and verify your mobile number.</span>
        {openProfile && (
          <button className="btn btn-primary btn-sm" onClick={openProfile}>
            Verify mobile number
          </button>
        )}
      </div>
    );
  }
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("api/trial/claim", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ companyId }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Couldn't start the trial (HTTP ${res.status}).`);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="subscribe"
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <input className="g-input" autoComplete="off" placeholder="Company CIN, LLPIN or PAN" value={companyId} onChange={e => setCompanyId(e.target.value)} aria-label="Company CIN, LLPIN or PAN" />
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || companyId.trim().length < 8}>
        {busy ? "Starting…" : `Start ${me.trialDays}-day free trial`}
      </button>
      {error && <span className="chat-error">{error}</span>}
      <span className="fine">One free trial per company and mobile number. We keep only the last 4 characters of the ID.</span>
    </form>
  );
}

function PlanBar({ me, required }: { me: Me | null; required: boolean }) {
  const { signedIn } = useAccount();
  if (!required || !me) return null;
  const trialOpen = Date.now() < Date.parse(me.trialSignupDeadline);
  if (!signedIn || !me.signedIn) {
    return (
      <div className="planbar">
        <span>
          {trialOpen
            ? <>Sign up before {dateLabel(me.trialSignupDeadline)} for a <b>free {me.trialDays}-day trial</b> (one per company), then ₹{me.priceInr}/month. Free accounts get {me.freeDaily} chats a day.</>
            : <>Sign in to chat with the advisor: {me.freeDaily} free chats a day, or up to {me.paidDaily} a day for ₹{me.priceInr}/month.</>}
        </span>
        <SignInCta label={trialOpen ? "Start free trial" : "Sign in"} />
      </div>
    );
  }
  const left = Math.max(0, (me.dailyLimit ?? 0) - (me.usedToday ?? 0));
  const p = me.period;
  const periodLeft = p ? Math.max(0, p.limit - p.used) : null;
  const usage = `${p ? Math.min(left, periodLeft!) : left} of ${me.dailyLimit} chats left today${p ? ` · ${periodLeft} of ${p.limit} left ${p.kind === "trial" ? "in your trial" : "this month"}` : ""}`;
  return (
    <div className="planbar">
      <span>
        {me.plan === "paid" && <><b>Subscribed</b> · {usage}</>}
        {me.plan === "trial" && <><b>Free trial</b> until {dateLabel(me.trialEndsAt!)} · {usage}</>}
        {me.plan === "free" && <><b>Free plan</b> · {usage}</>}
      </span>
      {me.plan === "free" && me.trialClaimable ? <TrialClaimForm me={me} /> : me.plan !== "paid" && <SubscribeForm me={me} />}
    </div>
  );
}

// ---------- main view ----------
export function AdvisorView({ stats }: { stats: Stats }) {
  const account = useAccount();
  const [ai, setAi] = useState<boolean | null>(null);
  /** The server wants a signed-in user for chat. */
  const [authRequired, setAuthRequired] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"chat" | "guided">("chat");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<PublicOpportunity | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Every programme the advisor has returned in this conversation, for cards and [[id]] chips.
  const byId = useMemo(() => new Map(turns.flatMap(t => t.matches ?? []).map(m => [m.id, m.program])), [turns]);
  const openId = (id: string) => setSelected(byId.get(id) ?? null);

  useEffect(() => {
    fetch("api/health")
      .then(r => (r.ok ? r.json() : { ai: false }))
      .then((h: { ai?: boolean; auth?: boolean }) => {
        setAi(!!h.ai);
        setAuthRequired(!!h.auth);
        if (!h.ai) setMode("guided");
      })
      .catch(() => {
        setAi(false);
        setMode("guided");
      });
    return () => abortRef.current?.abort();
  }, []);

  // Back from Cashfree checkout: the webhook may land a few seconds later, so re-check the plan a few times.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("billing") !== "return") return;
    params.delete("billing");
    history.replaceState(null, "", params.size ? `?${params}` : location.pathname);
    setNotice("Thanks! Your subscription is being confirmed. This page updates once Cashfree confirms the mandate.");
    let tries = 0;
    const timer = setInterval(async () => {
      const me = await account.refresh();
      if (me?.plan === "paid" || ++tries >= 10) {
        clearInterval(timer);
        setNotice(me?.plan === "paid" ? "Subscription active. Thank you for supporting GrantKosh!" : "Payment noted. If your plan hasn't updated in a few minutes, refresh the page.");
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [account.refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Braces matter: newer browsers return a Promise from scrollIntoView, which React would treat as a cleanup.
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, status]);

  const locked = authRequired && !account.signedIn;

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy || locked) return;
    setDraft("");
    const history = [...turns.filter(t => !t.error && t.text), { role: "user" as const, text: q }];
    setTurns(t => [...t, { role: "user", text: q }, { role: "assistant", text: "", tools: [], pending: true }]);
    setBusy(true);
    setStatus("Reading your profile…");
    const update = (fn: (t: Turn) => Turn) => setTurns(ts => ts.map((t, i) => (i === ts.length - 1 ? fn(t) : t)));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamChat(
        history.map(t => ({ role: t.role, content: t.text })),
        await account.authHeaders(),
        e => {
          if (e.type === "text") {
            setStatus("");
            update(t => ({ ...t, text: t.text + e.delta }));
          } else if (e.type === "tool") {
            setStatus("Searching programmes…");
            update(t => ({ ...t, tools: [...(t.tools ?? []), e.label] }));
          } else if (e.type === "matches") update(t => ({ ...t, matches: e.items }));
          else if (e.type === "status") setStatus(e.text);
          else if (e.type === "error") {
            update(t => ({ ...t, error: e.message, errorCode: e.code }));
            if (e.code === "unavailable") setAi(false);
          }
        },
        ctrl.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") update(t => ({ ...t, error: "Couldn't reach the advisor. Check your connection or use guided matching." }));
    } finally {
      update(t => ({ ...t, pending: false }));
      setBusy(false);
      setStatus("");
      void account.refresh();
    }
  };

  /** Cards to show under an answer: programmes it cited, in order; else its top matches. */
  const cardsFor = (t: Turn) => {
    const cited = [...new Set([...t.text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]!.trim()))].filter(id => byId.has(id));
    const ms = new Map((t.matches ?? []).map(m => [m.id, m]));
    const ids = cited.length ? cited : t.pending ? [] : (t.matches ?? []).slice(0, 5).map(m => m.id);
    return ids.map(id => ({ o: byId.get(id)!, m: ms.get(id) })).filter(x => x.o);
  };

  return (
    <section className="advisor">
      <div className="advisor-head">
        <div>
          <h2>Funding Advisor</h2>
          <p className="note">
            Describe your startup. The advisor searches {stats.programs.toLocaleString("en-IN")} programmes, including iDEX, NIDHI, BIRAC, SISFS, MeitY TIDE and state schemes, and explains which fit and why.
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="Advisor mode">
          <button role="tab" aria-selected={mode === "chat"} disabled={ai === false} onClick={() => setMode("chat")} title={ai === false ? "AI chat isn't configured on this deployment" : ""}>
            Chat
          </button>
          <button role="tab" aria-selected={mode === "guided"} onClick={() => setMode("guided")}>
            Guided match
          </button>
        </div>
      </div>

      {mode === "guided" ? (
        <>
          {ai === false && <p className="note">AI chat isn't available here, so the guided matcher ranks programmes with the same rules.</p>}
          <GuidedMatcher today={stats.today} onOpen={setSelected} />
        </>
      ) : (
        <div className="chat">
          {notice && <p className="planbar planbar-note">{notice}</p>}
          <PlanBar me={account.me} required={authRequired} />
          <div className="chat-log" aria-live="polite">
            {turns.length === 0 && (
              <div className="starters">
                <p className="g-label">Try one of these</p>
                {STARTERS.map(s => (
                  <button key={s} className="starter" disabled={locked} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="bubble bubble-user">
                  {t.text}
                </div>
              ) : (
                <div key={i} className="bubble bubble-ai">
                  {(t.tools ?? []).map((l, j) => (
                    <div key={j} className="tool-line">
                      {l}
                    </div>
                  ))}
                  {t.text && <RichText text={t.text} byId={byId} onOpen={openId} />}
                  {t.pending && !t.text && <div className="typing">{status || "Thinking…"}</div>}
                  {t.error && (
                    <div className="chat-error">
                      {t.error}{" "}
                      {t.errorCode === "auth" ? (
                        <SignInCta />
                      ) : (
                        <button className="link-btn" onClick={() => setMode("guided")}>
                          Use guided match
                        </button>
                      )}
                    </div>
                  )}
                  {cardsFor(t).length > 0 && (
                    <ul className="mcards">
                      {cardsFor(t).map(({ o, m }) => (
                        <MatchCard key={o.id} o={o} m={m} today={stats.today} onOpen={() => setSelected(o)} />
                      ))}
                    </ul>
                  )}
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
          <form
            className="chat-input"
            onSubmit={e => {
              e.preventDefault();
              send(draft);
            }}
          >
            <textarea
              value={draft}
              maxLength={2000}
              rows={2}
              placeholder="e.g. Drone startup in Pune, prototype ready, DPIIT recognised, need ₹50L. What can I apply for?"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              aria-label="Message the advisor"
            />
            {busy ? (
              <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={!draft.trim() || locked}>
                Ask
              </button>
            )}
          </form>
          <p className="fine">
            AI answers can be wrong. Every programme links to its official page; confirm eligibility there before applying. Runs on Google's free Gemini tier, which may use conversations to improve Google's products, so don't share confidential details.
          </p>
        </div>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} labelledBy="opp-title">
        {selected && <OppDetail o={selected} today={stats.today} />}
      </Modal>
    </section>
  );
}
