// Reads incoming mobile-money payments from what an owner can easily give us (pure, tested):
//  - pasted payment SMS messages (M-Pesa, Mixx by Yas / Tigo Pesa, Airtel Money, HaloPesa; Swahili or English)
//  - a statement exported as CSV (M-Pesa business statement columns like "Receipt No.", "Completion Time",
//    "Paid In", "Details" / "Other Party Info", or similar)
// Only money RECEIVED is kept. Only the last 4 digits of the sender's number are kept.

export type WalletLine = {
  txn_id: string; at: string; amount: number; currency: string;
  sender_name: string | null; phone_tail: string | null; provider: string | null;
  source: "sms" | "csv"; date_guessed?: boolean;
};

const RECEIVED = /(umepokea|you have received|received from|\breceived\b|imepokelewa|pesa imeingia|deposit(ed)? from)/i;
const OUTGOING = /(umetuma|umelipa|sent to|paid to|umetoa|withdrawn|withdraw|imetumwa kwa|you have sent|you have paid)/i;
const PHONE = /(?:\+?255|\b0)[\s-]?[67]\d(?:[\s-]?[\d*xX]){7}/;

function provider(t: string): string | null {
  if (/m-?pesa|vodacom/i.test(t)) return "mpesa";
  if (/mixx|tigo ?pesa|\byas\b/i.test(t)) return "mixx";
  if (/airtel/i.test(t)) return "airtel";
  if (/halo ?pesa|halotel/i.test(t)) return "halopesa";
  return null;
}

function money(s: string): number | null {
  const n = Number(s.replace(/,/g, ""));
  return isFinite(n) && n > 0 ? n : null;
}

function tailOf(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/[^\d*xX]/g, "");
  const last = d.slice(-4);
  return /^\d{4}$/.test(last) ? last : null;
}

/** "Mr john  DOE" → "John Doe" */
function cleanName(s: string | null | undefined): string | null {
  const w = String(s ?? "").replace(/[^\p{L}' .-]/gu, " ").split(/\s+/).filter((x) => /^\p{L}[\p{L}'.-]*$/u.test(x) && !/^(kwa|from|na|ya|the|to|acc|account)$/i.test(x));
  if (!w.length) return null;
  return w.slice(0, 4).map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(" ");
}

/** dd/mm/yy(yy) or yyyy-mm-dd, with an optional time (24 h or AM/PM). Local time with the given UTC offset. */
export function parseWhen(s: string, offset = "+03:00"): string | null {
  let y: number, mo: number, d: number;
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const dmy = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (iso) { y = +iso[1]; mo = +iso[2]; d = +iso[3]; }
  else if (dmy) { d = +dmy[1]; mo = +dmy[2]; y = +dmy[3]; if (y < 100) y += 2000; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const rest = s.slice((iso ?? dmy)!.index + (iso ?? dmy)![0].length);
  const tm = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|asubuhi|mchana|jioni|usiku)?/i.exec(rest) ?? /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s);
  let h = tm ? +tm[1] : 12, mi = tm ? +tm[2] : 0;
  const ap = tm?.[4]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  const p = (n: number) => String(n).padStart(2, "0");
  const out = `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(tm?.[3] ? +tm[3] : 0)}${offset}`;
  return isNaN(Date.parse(out)) ? null : new Date(out).toISOString();
}

function txnIdOf(t: string): string | null {
  const head = /^\s*([A-Z0-9]{8,14})\s+(?:confirmed|imethibitishwa|imekamilika)/i.exec(t);
  if (head && /\d/.test(head[1]) && /[A-Z]/i.test(head[1])) return head[1].toUpperCase();
  const lab = /(?:muamala|kumbukumbu(?: ya muamala| no\.?)?|tid|trans(?:action)?\.?\s*id|txn\s*id|ref(?:erence)?(?: no\.?)?|receipt(?: no\.?)?)\s*[:#.]?\s*([A-Z0-9][A-Z0-9.]{5,})/i.exec(t);
  if (lab) return lab[1].replace(/\.$/, "").toUpperCase();
  const any = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}\b/.exec(t);
  return any ? any[0] : null;
}

/** One SMS → one payment, or null when it isn't money received. */
export function parseSms(t: string, offset = "+03:00", now = new Date()): WalletLine | null {
  if (!RECEIVED.test(t)) return null;
  const pre = t.slice(0, t.search(RECEIVED));
  if (OUTGOING.test(pre) && !/umepokea|received/i.test(pre)) return null;
  const after = t.slice(t.search(RECEIVED));
  // First amount in the message that isn't the balance ("New balance is…", "Salio jipya…") or a fee.
  const amts = [...t.matchAll(/(?:tsh|tzs|sh)\.?\s*([\d,]+(?:\.\d{1,2})?)|([\d,]{4,}(?:\.\d{1,2})?)\s*(?:tsh|tzs|\/=)/gi)]
    .filter((m) => !/(balance|salio|ada|fee|charge|makato)[^.]{0,25}$/i.test(t.slice(Math.max(0, m.index! - 30), m.index)));
  const amt = amts.length ? [amts[0][0], amts[0][1] ?? amts[0][2]] : null;
  const amount = amt ? money(amt[1]) : null;
  const txn = txnIdOf(t);
  if (!amount || !txn) return null;
  const phone = PHONE.exec(after)?.[0] ?? PHONE.exec(t)?.[0] ?? null;
  // Name: "… 2557XXXXXXXX - JOHN DOE", "kutoka (kwa) JOHN DOE", "from JOHN DOE", "JOHN DOE - 2557…"
  let name: string | null = null;
  const afterPhone = phone ? after.slice(after.indexOf(phone) + phone.length) : "";
  const m1 = /^\s*[-,]\s*([A-Za-z][A-Za-z' .]{2,40}?)(?=[.,;]|\s+(?:tarehe|on|at|saa|salio|new|kumbukumbu|muamala|tid)\b|\s*$)/i.exec(afterPhone);
  const m2 = /(?:kutoka(?:\s+kwa)?|from)\s+(?!\+?\d)([A-Za-z][A-Za-z' .]{2,40}?)(?=\s*[-,(]|\s+\+?\d|[.;]|\s+(?:tarehe|on|at|saa|salio|new)\b)/i.exec(after);
  name = cleanName(m1?.[1] ?? m2?.[1] ?? null);
  const when = parseWhen(t, offset);
  return {
    txn_id: txn, at: when ?? now.toISOString(), amount, currency: "TZS",
    sender_name: name, phone_tail: tailOf(phone), provider: provider(t), source: "sms",
    ...(when ? {} : { date_guessed: true }),
  };
}

/** Split pasted text into separate messages (blank lines, or a new "XXXX Confirmed." start). */
export function splitMessages(text: string): string[] {
  return text.replace(/\r/g, "")
    .split(/\n\s*\n|(?=\b[A-Z0-9]{8,14}\s+(?:Confirmed|Imethibitishwa)\b)/)
    .flatMap((chunk) => {
      const lines = chunk.split("\n").map((x) => x.trim()).filter(Boolean);
      // One message per line when each line is a whole message on its own.
      return lines.length > 1 && lines.filter((l) => RECEIVED.test(l)).length > 1 ? lines : [lines.join(" ")];
    })
    .map((x) => x.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- CSV
export function parseCsvRows(text: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  const delim = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((x) => x.trim()));
}

export function parseStatementCsv(text: string, offset = "+03:00"): WalletLine[] {
  const rows = parseCsvRows(text);
  const hi = rows.findIndex((r) => r.some((c) => /receipt|transaction|muamala|reference|ref\b/i.test(c)) && r.some((c) => /time|date|tarehe/i.test(c)));
  if (hi < 0) return [];
  const h = rows[hi].map((c) => c.trim().toLowerCase());
  const col = (re: RegExp, not?: RegExp) => h.findIndex((c) => re.test(c) && !(not && not.test(c)));
  const iId = col(/receipt|transaction id|trans\.? id|txn|muamala|reference|ref\b/);
  const iAt = col(/completion time|completed|date|time|tarehe/, /initiation/);
  const iIn = col(/paid in|credit|received|money in|deposit|kiasi kilichoingia|amount in/);
  const iAmt = iIn >= 0 ? iIn : col(/^amount$|kiasi|amount/);
  const iName = col(/other party|sender|from|name|jina/);
  const iDet = col(/details|description|maelezo|narration/);
  const iStatus = col(/status|hali/);
  const out: WalletLine[] = [];
  for (const r of rows.slice(hi + 1)) {
    const get = (i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
    if (iStatus >= 0 && get(iStatus) && !/complet|success|imekamilika/i.test(get(iStatus))) continue;
    const amount = money(get(iAmt).replace(/[^\d.,-]/g, ""));
    if (!amount || /^-/.test(get(iAmt))) continue;
    const det = `${get(iName)} ${get(iDet)}`;
    if (iIn < 0 && OUTGOING.test(det)) continue;
    const at = parseWhen(get(iAt), offset);
    const id = get(iId).toUpperCase();
    if (!at || !id) continue;
    const phone = PHONE.exec(det)?.[0] ?? null;
    const nameSrc = /-\s*([A-Za-z][A-Za-z' .]{2,40})/.exec(det)?.[1] ?? get(iName).replace(PHONE, "");
    out.push({ txn_id: id, at, amount, currency: "TZS", sender_name: cleanName(nameSrc), phone_tail: tailOf(phone), provider: provider(text.slice(0, 400)) ?? "mpesa", source: "csv" });
  }
  return out;
}

/** Whatever the owner gave us: CSV statement or pasted SMS. Duplicates (same code) are dropped. */
export function parseWallet(text: string, offset = "+03:00", now = new Date()): WalletLine[] {
  const looksCsv = /^[^\n]*(receipt|transaction|completion time|paid in)[^\n]*[,;][^\n]*\n/i.test(text);
  const list = looksCsv ? parseStatementCsv(text, offset) : splitMessages(text).map((m) => parseSms(m, offset, now)).filter((x): x is WalletLine => !!x);
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x.txn_id) ? false : (seen.add(x.txn_id), true)));
}
