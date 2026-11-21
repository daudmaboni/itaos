/**
 * "Sawa kak", "poa", "asante sana", 👍 — the customer closing a thread, not asking for anything.
 * A chat whose last customer messages are all like this is NOT waiting for a reply.
 *
 * Keep this list in step with public.is_closing_ack() (migration 0061_closing_ack.sql),
 * which the nav badge and the backfill use.
 *
 * Deliberately left out: "ndio", "yes", "done" — those usually answer a question or say "I've paid",
 * so they still need you.
 */
const WORDS = [
  // okay / fine
  "sawa", "sawasawa", "poa", "powa", "poapoa", "fresh", "freshi", "safi", "shwari", "haya", "kabisa", "tuko", "pamoja",
  "ok", "okay", "okey", "oky", "k", "alright", "alrt", "fine", "nice", "good", "great", "cool", "noted",
  // thanks / blessings
  "asante", "asanteni", "ahsante", "aksante", "asnt", "shukran", "shukrani", "nashukuru", "nashkuru",
  "thanks", "thank", "thnks", "thx", "tnx", "you", "u", "sana", "much",
  "barikiwa", "ubarikiwe", "mungu", "akubariki", "akubarikie",
  // got it
  "nimeona", "nimeelewa", "nimepokea", "nimepata", "tumeelewana",
  // how people address you
  "kak", "kaka", "bro", "dada", "sis", "boss", "bosi", "mkuu", "chief", "mzee", "ndugu",
];

/** Lower-case and squash repeated letters, so "Sawaaa", "pooa" and "okk" match. */
const squash = (w: string) => w.toLowerCase().replace(/(.)\1+/g, "$1");
const SET = new Set(WORDS.map(squash));

export function isClosingAck(body: string | null | undefined): boolean {
  const s = (body ?? "").toLowerCase();
  if (!s.trim() || s.includes("?")) return false;
  const toks = s.replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean).map(squash);
  if (toks.length > 6) return false;
  return toks.every((t) => SET.has(t));   // emoji-only (👍🙏) has no words → closing
}

type M = { direction: "in" | "out"; body: string | null; type: string };

/** True when everything the customer sent after your last message is a closing word (or a sticker). */
export function lastInClosing(msgs: M[]): boolean {
  let i = msgs.length - 1;
  let n = 0;
  while (i >= 0 && msgs[i].direction === "in") {
    const m = msgs[i];
    const ok = m.type === "sticker" || ((m.type === "text" || !m.type) && isClosingAck(m.body));
    if (!ok) return false;
    n++; i--;
  }
  return n > 0 && i >= 0;   // a chat that is only "ok" from a stranger still gets looked at
}
