// "Do this now" on the Dashboard: the 3 most urgent things across itaOS, each linking to where it's done.
// Pure (no React, no Supabase) so the order is tested.
import type { Advice } from "./adMoney";

export type Signals = {
  payRed: number;          // payment screenshots that look fake/wrong (red), undecided
  payAmber: number;        // need a quick look (amber), undecided
  waiting: number;         // customers whose last message is unanswered (last 3 days)
  overdue: number;         // confirmed promises past their day
  proposed: number;        // promises Kito suggested, not yet confirmed
  ad: Advice | null;       // the Ad money manager's first to-do
  adName: (a: Advice) => string | null;
  leaks: number;           // open staff-leak items (other numbers, paid elsewhere)
  unrecorded: number;      // paid but no sale recorded
  unrecordedAmount: string;
};
export type DoItem = { key: string; tone: "bad" | "warn" | "info"; text: string; href: string; cta: string };
type TT = (en: string, sw: string) => string;

export function pickDoNow(x: Signals, T: TT, max = 3): DoItem[] {
  const out: (DoItem & { rank: number })[] = [];
  const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (x.payRed > 0) out.push({ rank: 0, key: "pay", tone: "bad", href: "#payments", cta: T("Check", "Kagua"),
    text: T(`${pl(x.payRed, "payment looks", "payments look")} fake or wrong. Check before sending anything.`, `Malipo ${x.payRed} yanaonekana feki au si sahihi. Kagua kabla ya kutuma chochote.`) });
  if (x.waiting > 0) out.push({ rank: 1, key: "reply", tone: x.waiting >= 5 ? "bad" : "warn", href: "#actions", cta: T("Reply", "Jibu"),
    text: T(`${pl(x.waiting, "customer is", "customers are")} waiting for your reply.`, `Wateja ${x.waiting} wanasubiri jibu lako.`) });
  if (x.overdue > 0) out.push({ rank: 2, key: "promise", tone: "warn", href: "#actions", cta: T("Open", "Fungua"),
    text: T(`${pl(x.overdue, "promise is", "promises are")} past the day the customer gave.`, `Ahadi ${x.overdue} zimepita siku aliyosema mteja.`) });
  if (x.unrecorded > 0) out.push({ rank: 3, key: "unrec", tone: "warn", href: "#leaks", cta: T("Record", "Rekodi"),
    text: T(`${pl(x.unrecorded, "customer", "customers")} paid (${x.unrecordedAmount}) but no sale is recorded.`, `Wateja ${x.unrecorded} walilipa (${x.unrecordedAmount}) lakini mauzo hayajarekodiwa.`) });
  if (x.ad) {
    const a = x.ad, n = x.adName(a);
    const t = a.k === "stop" ? T(`Ads: stop “${n}”, it costs more than a sale leaves you.`, `Matangazo: zima “${n}”, linagharimu zaidi ya unachobaki nacho.`)
      : a.k === "move" ? T(`Ads: move money from “${n}” to a better ad.`, `Matangazo: hamisha pesa kutoka “${n}” kwenda tangazo bora.`)
      : a.k === "scale" ? T(`Ads: “${n}” is making you money. Add up to 20%.`, `Matangazo: “${n}” linakuingizia pesa. Ongeza hadi 20%.`)
      : a.k === "fix" ? T(`Ads: “${n}” is getting costly. Try a new video or picture.`, `Matangazo: “${n}” linakuwa ghali. Jaribu video au picha mpya.`)
      : a.k === "second_ad" ? T("Ads: only one ad is running. Start a second one to compare.", "Matangazo: tangazo moja tu linaendelea. Anzisha la pili ulinganishe.")
      : null;
    if (t) out.push({ rank: a.k === "stop" ? 1.5 : 4, key: "ad", tone: a.k === "stop" ? "bad" : "info", href: "#ads", cta: T("Open", "Fungua"), text: t });
  }
  if (x.leaks > 0) out.push({ rank: 5, key: "leak", tone: "warn", href: "#leaks", cta: T("Look", "Angalia"),
    text: T(`${pl(x.leaks, "possible leak", "possible leaks")}: money that may not reach your account.`, `Uvujaji ${x.leaks} unaowezekana: pesa ambazo huenda hazifiki kwenye akaunti yako.`) });
  if (x.payAmber > 0) out.push({ rank: 6, key: "pay2", tone: "info", href: "#payments", cta: T("Check", "Kagua"),
    text: T(`${pl(x.payAmber, "payment screenshot needs", "payment screenshots need")} a quick look.`, `Picha ${x.payAmber} za malipo zinahitaji kuangaliwa.`) });
  if (x.proposed >= 10) out.push({ rank: 7, key: "proposed", tone: "info", href: "#actions", cta: T("Confirm", "Thibitisha"),
    text: T(`Kito found ${x.proposed} promises customers made. Confirm the real ones.`, `Kito ameona ahadi ${x.proposed} za wateja. Thibitisha zile za kweli.`) });
  return out.sort((a, b) => a.rank - b.rank).slice(0, max).map(({ rank: _r, ...i }) => i);
}
