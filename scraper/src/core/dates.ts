// Date parsing for the many formats Indian and international portals use.
// Everything normalises to ISO calendar dates (YYYY-MM-DD); times and zones are dropped.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAY_RE = "(\\d{1,2})(?:st|nd|rd|th)?";

export type DayOrder = "dmy" | "mdy";

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // e.g. 31 June
  return dt.toISOString().slice(0, 10);
}

interface Pattern {
  re: RegExp;
  build: (m: RegExpExecArray, order: DayOrder) => string | null;
}

const PATTERNS: Pattern[] = [
  // 2026-10-31, 2026/10/31, 2026-10-31T05:30:00Z
  { re: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b/, build: m => iso(+m[1]!, +m[2]!, +m[3]!) },
  // 31-10-2026, 31/10/2026, 31.10.2026 (or month-first for US sources)
  {
    re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/,
    build: (m, order) => {
      const a = +m[1]!, b = +m[2]!, y = +m[3]!;
      if (a > 12) return iso(y, b, a);
      if (b > 12) return iso(y, a, b);
      return order === "mdy" ? iso(y, a, b) : iso(y, b, a);
    },
  },
  // 15-Jul-2026, 15 Jul 2026, 04 May, 2026, 01st October 2026
  { re: new RegExp(`\\b${DAY_RE}[\\s-]*(?:of\\s+)?${MONTH_RE}\\.?[\\s,-]*(\\d{4})\\b`, "i"), build: m => iso(+m[3]!, MONTHS[m[2]!.toLowerCase()]!, +m[1]!) },
  // July 15, 2026 / Jul 23, 2025
  { re: new RegExp(`\\b${MONTH_RE}\\.?\\s+${DAY_RE},?\\s+(\\d{4})\\b`, "i"), build: m => iso(+m[3]!, MONTHS[m[1]!.toLowerCase()]!, +m[2]!) },
];

/** Parse the first recognisable date in a string. */
export function parseDate(input: string | null | undefined, order: DayOrder = "dmy"): string | null {
  if (!input) return null;
  const s = String(input).trim();
  let best: { index: number; value: string } | null = null;
  for (const p of PATTERNS) {
    const m = p.re.exec(s);
    if (!m) continue;
    const v = p.build(m, order);
    if (v && (!best || m.index < best.index)) best = { index: m.index, value: v };
  }
  return best?.value ?? null;
}

export interface FoundDate {
  date: string;
  index: number;
  raw: string;
}

/** Every date mentioned in free text, in reading order. */
export function findDates(text: string, order: DayOrder = "dmy"): FoundDate[] {
  const out: FoundDate[] = [];
  const taken: Array<[number, number]> = [];
  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index, end = m.index + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      const v = p.build(m, order);
      if (!v) continue;
      taken.push([start, end]);
      out.push({ date: v, index: start, raw: m[0] });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

const DEADLINE_CUE = /(last\s+date|deadline|apply\s+(?:by|before)|closing\s+date|closes?\s+on|close\s+date|due\s+date|submission\s+(?:date|deadline|closes)|applications?\s+close|end\s+date|till|until)/gi;
const OPEN_CUE = /(opens?\s+on|opening\s+date|start\s+date|launch(?:ed)?\s+on|applications?\s+open)/gi;

function dateAfterCue(text: string, cue: RegExp, order: DayOrder, window = 90): string | null {
  const dates = findDates(text, order);
  if (!dates.length) return null;
  const re = new RegExp(cue.source, cue.flags);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + m[0].length;
    const hit = dates.find(d => d.index >= end && d.index - end <= window);
    if (hit) return hit.date;
  }
  return null;
}

/** Best-effort deadline extraction from free text (e.g. an official page). */
export function findDeadline(text: string, order: DayOrder = "dmy"): string | null {
  return dateAfterCue(text, DEADLINE_CUE, order);
}

export function findOpening(text: string, order: DayOrder = "dmy"): string | null {
  return dateAfterCue(text, OPEN_CUE, order);
}

/** Today's calendar date in the machine's local time zone (IST for most runs). */
export function todayIso(now = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
