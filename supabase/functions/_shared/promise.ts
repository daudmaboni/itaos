// Ahadi: turn the promise Kito found in a chat into a dated reminder.
// Pure functions (no database, no AI) so they can be tested and shared.

export const PROMISE_KINDS = ["pay", "call", "collect", "come_back", "other"] as const;
export type PromiseKind = typeof PROMISE_KINDS[number];

/** What Kito returns for a chat ("promise" in the label_chat tool), or null. */
export type RawPromise = { kind?: unknown; quote?: unknown; when_text?: unknown; due_date?: unknown; due_time?: unknown } | null | undefined;

export type Msg = { id?: string; direction: string; sent_at: string; body: string | null; type?: string };

export type Planned = {
  kind: PromiseKind;
  promise_text: string;
  when_text: string;
  promise_key: string;
  promise_at: string;
  due_at: string | null;   // null = the owner must pick a date ("nikipata mshahara", "baadae")
  /** The customer named the day plainly ("tar 3", "kesho", "Ijumaa"): itaOS sets the reminder itself. */
  clear: boolean;
};

/** Promises older than this (when the customer said them) are not turned into reminders. */
export const MAX_PROMISE_AGE_DAYS = 21;
/** A due time that passed more than this long ago is too stale to propose. */
export const MAX_OVERDUE_DAYS = 7;

const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Local wall-clock date + time in an IANA time zone → UTC ISO string. */
export function zonedToUtc(date: string, time: string, tz = "Africa/Dar_es_Salaam"): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const check = new Date(guess);
  if (check.getUTCDate() !== da) return null; // 2026-02-31 and the like
  let offset = 0;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(check).map((p) => [p.type, p.value]));
    const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
    offset = asLocal - guess;
  } catch { offset = 3 * 3600e3; } // unknown zone: East Africa Time
  return new Date(guess - offset).toISOString();
}

/** "Fri 2026-11-20 14:05" in the business's time zone, for transcripts and prompts. */
export function localStamp(iso: string | number | Date, tz = "Africa/Dar_es_Salaam"): string {
  const dt = new Date(iso);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(dt).map((x) => [x.type, x.value]));
    return `${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  } catch {
    return dt.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}

const WEEKDAYS: [RegExp, number][] = [
  [/\bjumapili\b|\bjuma\s*pili\b|\bsunday\b/, 0], [/\bjumatatu\b|\bjuma\s*tatu\b|\bmonday\b/, 1],
  [/\bjumanne\b|\bjuma\s*nne\b|\btuesday\b/, 2], [/\bjumatano\b|\bjuma\s*tano\b|\bwednesday\b/, 3],
  [/\balhamisi\b|\bthursday\b/, 4], [/\bijumaa\b|\bfriday\b/, 5], [/\bjumamosi\b|\bjuma\s*mosi\b|\bsaturday\b/, 6],
];
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * The day a time phrase points to, counted from the local day the customer said it ("YYYY-MM-DD").
 * Fixed rules beat the AI's date arithmetic for the common phrases; null = leave it to Kito.
 */
export function ruleDate(whenText: string, saidDay: string): string | null {
  const w = whenText.toLowerCase().normalize("NFKC");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(saidDay);
  if (!m || !w.trim()) return null;
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const plus = (n: number) => ymd(base + n * 864e5);
  if (/mwisho\s+wa\s+mwezi|end of (the )?month/.test(w)) {
    let last = Date.UTC(+m[1], +m[2], 0);
    if (last === base) last = Date.UTC(+m[1], +m[2] + 1, 0); // said on the last day: next month's end
    return ymd(last);
  }
  if (/wiki\s+ijayo|next week/.test(w)) return plus(7);
  if (/keshokutwa|kesho\s*kutwa|day after tomorrow/.test(w)) return plus(2);
  if (/\bkesho\b|\btomorrow\b/.test(w)) return plus(1);
  const hits = WEEKDAYS.filter(([re]) => re.test(w));
  if (hits.length === 1) {
    const today = new Date(base).getUTCDay();
    const diff = (hits[0][1] - today + 7) % 7 || 7; // the next such day, never the same day
    return plus(diff);
  }
  if (/\bleo\b|\btoday\b/.test(w)) return plus(0);
  // A day of the month: "tar 3", "tarehe 3", "tr 15", "3 tarehe", "the 3rd", "on 3rd".
  // The next such date on or after the day it was said; past days roll to next month.
  const dm = /\b(?:tarehe|tar|tr|trh)\.?\s*(\d{1,2})\b/.exec(w)
    ?? /\b(\d{1,2})\s*(?:tarehe|tar)\b/.exec(w)
    ?? /\b(\d{1,2})(?:st|nd|rd|th)\b/.exec(w);
  if (dm) {
    const day = +dm[1];
    if (day < 1 || day > 31) return null;
    const y = +m[1], mo = +m[2] - 1, today = +m[3];
    for (let add = day >= today ? 0 : 1; add < 3; add++) {
      const t = Date.UTC(y, mo + add, day);
      if (new Date(t).getUTCDate() === day) return ymd(t); // skips months without a 31st
    }
    return null;
  }
  return null;
}

/** The customer message the quote came from: the latest one that contains it. */
export function findSource(msgs: Msg[], quote: string): Msg | null {
  const q = norm(quote);
  if (q.length < 3) return null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.direction !== "in" || !m.body) continue;
    const b = norm(m.body);
    if (b.includes(q) || (q.length > 20 && q.includes(b) && b.length > 12)) return m;
  }
  return null;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/**
 * Decide whether Kito's promise becomes a proposed reminder, and when it is due.
 * Returns null when there is nothing worth proposing.
 */
export function planPromise(raw: RawPromise, msgs: Msg[], opts: { tz?: string; now?: number } = {}): Planned | null {
  if (!raw || typeof raw !== "object") return null;
  const tz = opts.tz || "Africa/Dar_es_Salaam";
  const now = opts.now ?? Date.now();
  const kind = (PROMISE_KINDS as readonly string[]).includes(String(raw.kind)) ? raw.kind as PromiseKind : "other";
  const quote = String(raw.quote ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (quote.length < 3) return null;
  const src = findSource(msgs, quote);
  const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
  const said = src ?? lastIn;
  if (!said) return null;
  const promiseAt = Date.parse(said.sent_at);
  if (!Number.isFinite(promiseAt) || now - promiseAt > MAX_PROMISE_AGE_DAYS * 864e5) return null;

  let due: string | null = null;
  const whenText = String(raw.when_text ?? "");
  const saidDay = localStamp(promiseAt, tz).slice(4, 14);
  const ruled = ruleDate(whenText, saidDay);
  const date = ruled ?? (typeof raw.due_date === "string" ? raw.due_date.trim() : "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const tm = typeof raw.due_time === "string" && /^\d{1,2}:\d{2}$/.test(raw.due_time.trim()) ? raw.due_time.trim() : (kind === "call" ? "10:00" : "09:00");
    due = zonedToUtc(date, tm, tz);
    // Nonsense dates (before the promise, or months away) become "pick a date".
    if (due) {
      const d = Date.parse(due);
      if (d < promiseAt - 864e5 || d > promiseAt + 120 * 864e5) due = null;
    }
  }
  if (due && now - Date.parse(due) > MAX_OVERDUE_DAYS * 864e5) return null;

  const key = src?.id ? `m:${src.id}:${kind}` : `q:${hash(norm(quote))}:${kind}`;
  return {
    kind,
    promise_text: quote,
    when_text: String(raw.when_text ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
    promise_key: key,
    promise_at: new Date(promiseAt).toISOString(),
    due_at: due,
    clear: !!ruled && !!due, // only fixed rules count: Kito's own date guesses still need a yes
  };
}

export function promiseTitle(kind: PromiseKind, lang: string) {
  const sw = lang === "sw";
  switch (kind) {
    case "pay": return sw ? "Ameahidi kulipa" : "Promised to pay";
    case "call": return sw ? "Ameomba apigiwe simu" : "Asked for a call";
    case "collect": return sw ? "Atachukua / atapita" : "Will collect or come by";
    case "come_back": return sw ? "Amesema atarudi" : "Said they'll come back";
    default: return sw ? "Ahadi ya mteja" : "Customer promise";
  }
}
