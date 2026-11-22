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
  /** "Nasubiri hela", "nikipata mshahara": a soft check-in a few days later, never a push to pay (0073). */
  gentle: boolean;
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

// Includes the short forms people type: jpl, j2, jtatu, j3, jnne, j4, jtano, j5, alhms, ijmaa, jmosi, j1 is not used.
const WEEKDAYS: [RegExp, number][] = [
  [/\bjumapili\b|\bjuma\s*pili\b|\bj\.?pili\b|\bjpl\b|\bsunday\b/, 0], [/\bjumatatu\b|\bjuma\s*tatu\b|\bj\.?tatu\b|\bj3\b|\bmonday\b/, 1],
  [/\bjumanne\b|\bjuma\s*nne\b|\bj\.?nne\b|\bj4\b|\btuesday\b/, 2], [/\bjumatano\b|\bjuma\s*tano\b|\bj\.?tano\b|\bj5\b|\bwednesday\b/, 3],
  [/\balhamisi\b|\balhamis\b|\balhms\b|\bthursday\b/, 4], [/\bijumaa\b|\bijmaa\b|\bfriday\b/, 5], [/\bjumamosi\b|\bjuma\s*mosi\b|\bj\.?mosi\b|\bsaturday\b/, 6],
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
  if (/mwisho\w*\s+(wa|mwa)\s+(huu\s+)?mwez\w*|end of (the |this )?month/.test(w)) {
    let last = Date.UTC(+m[1], +m[2], 0);
    if (last === base) last = Date.UTC(+m[1], +m[2] + 1, 0); // said on the last day: next month's end
    return ymd(last);
  }
  const hitsW = WEEKDAYS.filter(([re]) => re.test(w));
  if (/wiki\s+ijayo|next week/.test(w)) {
    if (hitsW.length === 1) {
      // "Jumanne wiki ijayo" / "next Tuesday week": that weekday in the week after this one (weeks start Monday)
      const dow = new Date(base).getUTCDay() || 7;           // Mon=1 … Sun=7
      const target = hitsW[0][1] || 7;
      return plus(8 - dow + target - 1);
    }
    return plus(7);
  }
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

// ---------------- Times: "baada ya saa moja", "lisaa limoja", "saa 11 jioni", "17:00", "5pm", "in 2 hours" ----------------
const NUMW: [RegExp, number][] = [
  [/^kumi\s+na\s+(li)?moj\w*/, 11], [/^kumi\s+na\s+mbil\w*/, 12], [/^kumi\b/, 10],
  [/^(li)?moj\w*/, 1], [/^(m)?bil\w*|^mawili\b/, 2], [/^tatu\b|^matatu\b/, 3], [/^nne\b|^manne\b/, 4], [/^tano\b|^matano\b/, 5],
  [/^sita\b/, 6], [/^saba\b/, 7], [/^nane\b/, 8], [/^tisa\b/, 9],
  [/^ishirini\b/, 20], [/^thelathini\b/, 30], [/^arobaini\b/, 40], [/^hamsini\b/, 50],
  [/^(one|an?)\b/, 1], [/^two\b/, 2], [/^three\b/, 3], [/^four\b/, 4], [/^five\b/, 5], [/^six\b/, 6], [/^ten\b/, 10], [/^fifteen\b/, 15], [/^twenty\b/, 20], [/^thirty\b/, 30], [/^forty\b/, 40],
];
/** A number written as digits or a Swahili/English word at the start of s. */
function numAt(s: string): number | null {
  const d = /^(\d{1,3})\b/.exec(s);
  if (d) return +d[1];
  for (const [re, n] of NUMW) if (re.test(s)) return n;
  return null;
}

/** Minutes from when it was said, for "after an hour" kinds of phrases; null when there is none. */
export function ruleOffset(whenText: string): number | null {
  const w = " " + whenText.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}:.]+/gu, " ") + " ";
  // English: in/after 2 hours, in 30 mins, in an hour, in half an hour
  let m = /\b(?:in|after|within)\s+half\s+an?\s+hour/.exec(w);
  if (m) return 30;
  m = /\b(?:in|after)\s+(\S+)\s*(hours?|hrs?|h|minutes?|mins?)\b/.exec(w);
  if (m) { const n = numAt(m[1]); if (n != null) return /^h/.test(m[2]) ? n * 60 : n; }
  m = /\b(\d{1,2})\s*(hrs?|hours?)\b/.exec(w);
  if (m && /\b(in|after|baada)\b/.test(w)) return +m[1] * 60;
  // Swahili durations: nusu saa, robo saa, lisaa limoja, masaa mawili, baada ya saa moja, dakika 30
  if (/\bnusu\s+(li)?saa\b/.test(w)) return 30;
  if (/\brobo\s+(li)?saa\b/.test(w)) return 15;
  m = /\b(?:li)saa\s+(\S+(?:\s+na\s+\S+)?)/.exec(w) ?? /\bmasaa\s+(\S+(?:\s+na\s+\S+)?)/.exec(w);
  if (m) { const n = numAt(m[1]); return (n ?? 1) * 60; }
  m = /\b(?:baada|bada|baad|bad)\s+(?:ya\s+)?(?:li)?saa\s+(\S+(?:\s+na\s+\S+)?)/.exec(w);
  if (m) { const n = numAt(m[1]); if (n != null && n <= 12) return n * 60; }
  if (!/\bsaa\s+\S+\s+na\s+(?:dakika|dk)/.test(w)) {
    m = /\b(?:dakika|dk|dak|dakka)\s+(\S+)/.exec(w) ?? /\b(\d{1,3})\s*(?:dakika|dk|dak)\b/.exec(w);
    if (m) { const n = numAt(m[1]); if (n != null && n > 0 && n <= 600) return n; }
  }
  return null;
}

/** "HH:MM" (24 h, business time) named in the phrase, or null. Swahili hours count from 7 in the morning. */
export function ruleClock(whenText: string): string | null {
  const w = " " + whenText.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}:.]+/gu, " ") + " ";
  const hm = (h: number, mi = 0) => (h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` : null);
  const part = /\b(asubuhi|alfajiri)\b/.test(w) ? "am" : /\bmchana\b/.test(w) ? "noon" : /\bjioni\b/.test(w) ? "eve" : /\busiku\b/.test(w) ? "night" : null;
  let m = /\b(\d{1,2})\s*(am|pm)\b/.exec(w) ?? /\b(\d{1,2})[:.](\d{2})\s*(am|pm)\b/.exec(w);
  if (m) {
    const h = +m[1], mi = m[3] ? +m[2] : 0, ap = (m[3] ?? m[2]);
    if (h < 1 || h > 12) return null;
    return hm(ap === "pm" ? (h % 12) + 12 : h % 12, mi);
  }
  m = /\b(\d{1,2})[:.](\d{2})\b/.exec(w);
  if (m && !/\bsaa\b/.test(w.slice(0, m.index))) {
    const h = +m[1];
    if (h >= 13 || h === 0) return hm(h, +m[2]);
    return hm(h <= 7 ? h + 12 : h, +m[2]);               // 5:30 → 17:30; 9:30 → 09:30 (business hours)
  }
  m = /\bsaa\s+(\S+(?:\s+na\s+(?:moj\w*|mbil\w*))?)(?:[:.](\d{2}))?(?:\s+(na\s+nusu|na\s+robo|kasoro\s+robo|na\s+dakika\s+\S+|na\s+dk\s+\S+))?/.exec(w);
  if (m) {
    const n = numAt(m[1]);
    if (n == null || n < 1) return null;
    let mi = m[2] ? +m[2] : 0;
    const extra = m[3] ?? "";
    if (/nusu/.test(extra)) mi = 30; else if (/na\s+robo/.test(extra)) mi = 15;
    else if (/kasoro/.test(extra)) mi = -15; else { const dm = /(?:dakika|dk)\s+(\S+)/.exec(extra); if (dm) mi = numAt(dm[1]) ?? 0; }
    let h: number;
    if (n >= 13 && n <= 23) h = n;                         // "saa 17" written the Western way
    else if (n > 12) return null;
    else {
      const h12 = (n + 6) % 12;                            // saa 1 → 7, saa 6 → 0 (12), saa 7 → 1
      if (part === "am") h = h12 === 0 ? 12 : h12;
      else if (part === "noon") h = h12 === 0 ? 12 : h12 < 6 ? h12 + 12 : h12;
      else if (part === "eve") h = h12 + 12;
      else if (part === "night") h = h12 >= 7 ? h12 + 12 : h12;
      else h = h12 === 0 ? 12 : h12 < 7 ? h12 + 12 : h12;  // no word: daytime, saa 1–6 = 7–12, saa 7–12 = 13–18
      if (h >= 24) h -= 12;
    }
    if (mi < 0) { h = (h + 23) % 24; mi += 60; }
    return hm(h, mi);
  }
  m = /\b(?:at|by|around)\s+(\d{1,2})\b/.exec(w);
  if (m) { const h = +m[1]; if (h >= 13 && h <= 23) return hm(h); if (h >= 1 && h <= 12) return hm(h <= 7 ? h + 12 : h); }
  return null;
}

/** When no hour was said: one of 09:00, 10:00, 11:00 or 12:00, spread evenly so reminders don't all ring at once. */
export function morningSlot(key: string): string {
  return ["09:00", "10:00", "11:00", "12:00"][parseInt(hash(key), 36) % 4];
}

/**
 * The reminder time itaOS can set by itself, from fixed rules only (never Kito's guesses), or null when the
 * customer gave no clear time ("nitakujulisha", "nikipata mshahara", "baadae").
 *  - "after an hour", "dakika 30", "in 2 hours": that long after the message.
 *  - a day ("kesho", "Jumanne wiki ijayo", "tar 3") with an hour ("saa 4", "17:00"): that day at that hour.
 *  - a day without an hour: that day, 09:00–12:00.
 *  - an hour without a day ("saa 11 jioni", "at 5pm"): the next time that hour comes after the message.
 *  - today without an hour, said after the morning: two hours after the message (by 20:00, else tomorrow morning).
 */
export function ruleDue(whenText: string | null | undefined, promiseAt: string | number, key: string, tz = "Africa/Dar_es_Salaam"): string | null {
  const said = typeof promiseAt === "number" ? promiseAt : Date.parse(promiseAt);
  if (!whenText || !whenText.trim() || !Number.isFinite(said)) return null;
  const off = ruleOffset(whenText);
  if (off != null) return new Date(said + off * 60e3).toISOString();
  const stamp = localStamp(said, tz);                     // "Fri 2026-11-20 14:05"
  const saidDay = stamp.slice(4, 14), saidHm = stamp.slice(15, 20);
  const day = ruleDate(whenText, saidDay);
  const clock = ruleClock(whenText);
  const w = whenText.toLowerCase();
  const todayWord = /\b(jioni|usiku|mchana|asubuhi|tonight|this evening|this afternoon)\b/.test(w);
  if (!day && !clock && !todayWord) return null;
  const at = (d: string, hhmm: string) => zonedToUtc(d, hhmm, tz);
  const nextDay = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
  if (clock) {
    if (day) return at(day, clock);
    // an hour alone: today if still ahead, otherwise tomorrow
    return clock > saidHm ? at(saidDay, clock) : at(nextDay(saidDay), clock);
  }
  const d = day ?? saidDay;
  const slot = morningSlot(key);
  if (d !== saidDay || slot > saidHm) return at(d, slot);
  // today, the morning slot already gone: two hours after it was said, by 20:00; otherwise tomorrow morning
  const later = said + 2 * 3600e3;
  const laterHm = localStamp(later, tz).slice(15, 20);
  if (localStamp(later, tz).slice(4, 14) === saidDay && laterHm <= "20:00") return new Date(later).toISOString();
  return at(nextDay(saidDay), slot);
}

// ---------------- Waiting for money: a soft check-in, never a push ----------------
/** Days after the message for the soft check-in when a customer is waiting for money. */
export const GENTLE_DAYS = 3;
const WAIT_MONEY = /\b(na?subi\w*|nangoja\w*|nasubr\w*|natafuta)\b[^.!?]{0,30}\b(hela|ela|pesa|mshahara|salary|malipo|mkwanja|fedha)\b|\b(nikipata|nkipata|nikipta|nikishapata|nitakapopata|ntakapopata|ikipatikana)\s+(hela|ela|pesa|mshahara|salary|fedha|mkwanja)\b|\b(hela|ela|pesa|mshahara|fedha)\s+(ikiingia|ikitoka|ikija|ikifika|ikikaa\s+sawa|ikitoka)\b|\bnikilipwa\b|\bwaiting\s+(for|on)\s+(money|my\s+salary|payment|my\s+pay)\b|\bwhen\s+i\s+get\s+(paid|money|my\s+salary)\b/;
const SALARY = /\b(mshahara|salary|nikilipwa|my pay|get paid)\b/;
/** "Nasubiri hela", "nikipata mshahara", "hela ikiingia": the customer means to pay but the money isn't there yet. */
export function waitingForMoney(text: string | null | undefined) {
  return WAIT_MONEY.test(String(text ?? "").toLowerCase().normalize("NFKC"));
}
/** The soft check-in time: 3 days on (09:00–12:00); for salary, the 1st of next month if that's later. */
export function gentleDue(text: string, promiseAt: string | number, key: string, tz = "Africa/Dar_es_Salaam"): string | null {
  const said = typeof promiseAt === "number" ? promiseAt : Date.parse(promiseAt);
  if (!Number.isFinite(said)) return null;
  const slot = morningSlot(key);
  let day = localStamp(said + GENTLE_DAYS * 864e5, tz).slice(4, 14);
  if (SALARY.test(text.toLowerCase())) {
    const [y, m] = localStamp(said, tz).slice(4, 14).split("-").map(Number);
    const first = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);   // 1st of next month
    if (first > day) day = first;
  }
  return zonedToUtc(day, slot, tz);
}
/** The business already sent how to pay (Lipa Namba, account, M-Pesa…): a customer who then promises to pay is about to buy. */
export function sentPayDetails(msgs: Msg[]) {
  return msgs.some((m) => m.direction === "out" && /\blipa\s*(namba|no\.?|number)\b|\bnamba\s+ya\s+malipo\b|\bfanya\s+malipo\b|\bakaunti\b|\baccount\s*(no|number|name)\b|\b(m-?pesa|mpesa|tigo\s*pesa|mixx|airtel\s*money|halo\s*pesa|nmb|crdb|nbc)\b|\bpaybill\b|\btill\s*(no|number)\b/i.test(m.body ?? ""));
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

  const key = src?.id ? `m:${src.id}:${kind}` : `q:${hash(norm(quote))}:${kind}`;
  let due: string | null = null;
  const whenText = String(raw.when_text ?? "");
  // Fixed rules first (a clear time: itaOS sets the reminder itself); Kito's own date only as a suggestion.
  const ruled = ruleDue(whenText, promiseAt, key, tz);
  const date = typeof raw.due_date === "string" ? raw.due_date.trim() : "";
  const gentle = !ruled && waitingForMoney(`${whenText} ${quote}`);
  const soft = gentle ? gentleDue(`${whenText} ${quote}`, promiseAt, key, tz) : null;
  if (ruled) due = ruled;
  else if (soft) due = soft;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const tm = typeof raw.due_time === "string" && /^\d{1,2}:\d{2}$/.test(raw.due_time.trim()) ? raw.due_time.trim() : morningSlot(key);
    due = zonedToUtc(date, tm, tz);
    // Nonsense dates (before the promise, or months away) become "pick a date".
    if (due) {
      const d = Date.parse(due);
      if (d < promiseAt - 864e5 || d > promiseAt + 120 * 864e5) due = null;
    }
  }
  if (due && now - Date.parse(due) > MAX_OVERDUE_DAYS * 864e5) return null;

  return {
    kind,
    promise_text: quote,
    when_text: String(raw.when_text ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
    promise_key: key,
    promise_at: new Date(promiseAt).toISOString(),
    due_at: due,
    clear: (!!ruled && due === ruled) || (!!soft && due === soft), // only fixed rules count: Kito's own date guesses still need a yes
    gentle: !!soft && due === soft,
  };
}

/**
 * For a promise saved earlier and still waiting for the owner: the time itaOS can set by itself (same rules as
 * new promises), or null when the customer gave no clear time.
 */
export function clearDue(whenText: string | null, promiseAt: string, key: string, tz = "Africa/Dar_es_Salaam"): string | null {
  return ruleDue(whenText, promiseAt, key, tz);
}
/** Same, also for a customer waiting for money (reads what they said, not only the time words). */
export function clearPlan(whenText: string | null, quote: string | null, promiseAt: string, key: string, tz = "Africa/Dar_es_Salaam"): { due: string; gentle: boolean } | null {
  const due = ruleDue(whenText, promiseAt, key, tz);
  if (due) return { due, gentle: false };
  const text = `${whenText ?? ""} ${quote ?? ""}`;
  if (!waitingForMoney(text)) return null;
  const g = gentleDue(text, promiseAt, key, tz);
  return g ? { due: g, gentle: true } : null;
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
