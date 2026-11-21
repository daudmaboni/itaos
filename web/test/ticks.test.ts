import { describe, it, expect } from "vitest";
import { bareTick, sawCustomer, tickAmount, isPaidTick, phonesIn, priceIn, findTicks, evidence, lastPriceBefore, goodsPriceIn } from "../../supabase/functions/_shared/ticks";

const out = (id: string, body: string, at = "2026-11-18T10:00:00Z") => ({ id, direction: "out" as const, sent_at: at, body, type: "text" });
const inn = (id: string, body: string, at = "2026-11-18T09:00:00Z", media?: any) => ({ id, direction: "in" as const, sent_at: at, body, type: media ? "image" : "text", media });

describe("owner ✅ messages", () => {
  it("knows a bare price ✅ from a price quote", () => {
    for (const b of ["TZS 205,000✅", "175,000✅", "Tsh 175,000 ✅", "175000/= ✅", " 205,000 ✅✅ "]) expect(bareTick(b), b).toBe(true);
    for (const b of ["175,000✅ ndio bei yetu", "Bei ni 175,000✅", "Umelipiwa✅", "Hallo Kwema Ndugu", "✅"]) expect(bareTick(b), b).toBe(false);
  });
  it("checks whether the customer wrote in the 3 days before", () => {
    expect(sawCustomer([], "2026-11-20T16:02:24Z")).toBe(false);
    expect(sawCustomer([out("a", "Hallo Kwema Ndugu", "2026-11-20T16:02:13Z")], "2026-11-20T16:02:24Z")).toBe(false);
    expect(sawCustomer([inn("a", "bei gani", "2026-11-19T10:00:00Z")], "2026-11-20T16:02:24Z")).toBe(true);
    expect(sawCustomer([inn("a", "bei gani", "2026-11-10T10:00:00Z")], "2026-11-20T16:02:24Z")).toBe(false);
  });
  it("reads a price followed by a tick", () => {
    expect(tickAmount("175,000✅")).toBe(175000);
    expect(tickAmount("Tsh 175,000 ✅")).toBe(175000);
    expect(tickAmount("175000/= ✅")).toBe(175000);
    expect(tickAmount("Imepokelewa 150.000✔️")).toBe(150000);
    expect(tickAmount("Nimeiona✅")).toBeNull();
    expect(tickAmount("Babati✅")).toBeNull();
    expect(tickAmount("Bei ni Tsh 175,000\n✅ Kusaidia mzunguko")).toBeNull();
    expect(tickAmount("✅ Cleanser — 113\n✅ Super Kongwe — 94")).toBeNull();
  });
  it("recognises payment words with a tick, not other ticks", () => {
    for (const s of ["Umelipiwa✅", "Imelipiwa ✅", "Amelipia✅✅✅", "Kalipia✅", "Huu Umelipiwa ✅", "Imelipiwa, ✅", "Paid✅", "Ameulipia Huyu✅", "Umelipiwa Jana Usiku✅"]) expect(isPaidTick(s), s).toBe(true);
    for (const s of ["Nimeiona✅", "Mamlaka Ya Tiba Asili Na Tiba Mbadala ✅", "Imetoka ✅", "Maji✅, Soda❌", "✅", "Lipa namba ✅ 123456", "Umelipiwa usafiri✅✅✅"]) expect(isPaidTick(s), s).toBe(false);
  });
  it("finds customer phone numbers and ignores them as prices", () => {
    const body = "Juma samwel kondoa pahi nmba 0788263445 0613203445\n\nCleanser, sk, jd, tobito \n\nUmelipiwa✅";
    expect(phonesIn(body)).toEqual(["255788263445", "255613203445"]);
    expect(phonesIn("Ramadhani Omar\n+255 772 390 463\nZanzibar")).toEqual(["255772390463"]);
    expect(phonesIn("0715 380 078 Cleanser")).toEqual(["255715380078"]);
    expect(priceIn(body)).toBeNull();
    const t = findTicks([out("a", body)]);
    expect(t).toMatchObject([{ kind: "paid", amount: null, phones: ["255788263445", "255613203445"] }]);
  });
  it("ignores customer messages and plain ticks", () => {
    expect(findTicks([inn("a", "175,000✅"), out("b", "✅"), out("c", "Nimeiona✅")])).toEqual([]);
  });
  it("uses the receipt as evidence and as the reference", () => {
    const r = { is_receipt: true, amount: 175000, txn_code: "qk41abc9xy", provider: "M-Pesa" };
    const ev = evidence([inn("r", "[picha ya malipo]", "2026-11-18T09:00:00Z", { receipt: r })], "2026-11-18T10:00:00Z", 175000, "TZS");
    expect(ev).toMatchObject({ txn: "QK41ABC9XY", receiptAmount: 175000 });
    expect(ev.note).toMatch(/matches/);
    expect(evidence([inn("r", "x", "2026-11-18T09:00:00Z", { receipt: { ...r, amount: 150000 } })], "2026-11-18T10:00:00Z", 175000, "TZS").note).toMatch(/⚠.*150,000/);
    expect(evidence([inn("p", "nimetuma")], "2026-11-18T10:00:00Z", 175000, "TZS").note).toMatch(/said they paid/);
    expect(evidence([inn("o", "habari", "2026-11-10T09:00:00Z")], "2026-11-18T10:00:00Z", 175000, "TZS").note).toMatch(/⚠ No payment/);
  });
  it("falls back to the last price sent in the last 30 days", () => {
    const msgs = [out("p", "Kayapower ni Tsh 175,000 tu", "2026-11-10T10:00:00Z"), inn("q", "sawa", "2026-11-11T10:00:00Z")];
    expect(lastPriceBefore(msgs, "2026-11-18T10:00:00Z")).toBe(175000);
    expect(lastPriceBefore(msgs, "2026-12-15T10:00:00Z")).toBeNull();
  });
  it("ignores transport costs when picking the price", () => {
    expect(goodsPriceIn("Unalipia Usafiri Kwanza 15,000 10,000 Ya Bus 5,000 Ya Boda Anayepeleka Mzigo")).toBeNull();
    expect(goodsPriceIn("Lipia TZS 180,000 , Hapo 10,000 Ya Usafiri")).toBe(180000);
    expect(goodsPriceIn("Lipa 105,000 Pamoja Na Gharama Za Usafirishaji Wa Dawa.")).toBe(105000);
    const msgs = [out("a", "Offer Ya Kufunga Mwezi Leo Kwa TZS 150,000", "2026-09-30T08:00:00Z"), out("b", "Unalipia Usafiri Kwanza 15,000 10,000 Ya Bus 5,000 Ya Boda", "2026-09-30T09:00:00Z")];
    expect(lastPriceBefore(msgs, "2026-10-04T10:00:00Z")).toBe(150000);
  });
});

import { isMoneyMoment } from "../../supabase/functions/_shared/money";
describe("isMoneyMoment (Kito reads these chats at once)", () => {
  it("customer payment words, M-Pesa SMS and read receipts", () => {
    for (const t of ["Nimelipa tayari", "nimetuma pesa", "nimetuma", "QK41ABC9XY Imethibitishwa. Umelipa Tsh155,000", "[picha ya malipo] M-Pesa · TSh 155,000", "I've paid"])
      expect(isMoneyMoment(t, "in"), t).toBe(true);
  });
  it("ordinary customer messages wait for the quiet window", () => {
    for (const t of ["Habari", "bei gani?", "nipo Mbeya", "mnaleta mikoani?", null])
      expect(isMoneyMoment(t as string | null, "in"), String(t)).toBe(false);
    expect(isMoneyMoment("[picha] product photo", "in", [], "image")).toBe(false);
  });
  it("receipt photos, and photos that couldn't be read, are read at once", () => {
    expect(isMoneyMoment("[picha ya malipo] M-Pesa · TSh 155,000", "in", [], "image")).toBe(true);
    expect(isMoneyMoment("[image]", "in", [], "image")).toBe(true);
  });
  it("business confirms, ships, or sends its own paid / delivered text", () => {
    expect(isMoneyMoment("Tumepokea malipo yako, asante", "out")).toBe(true);
    expect(isMoneyMoment("Mzigo wako umetumwa leo", "out")).toBe(true);
    // Usage wording is each business's own (Settings), never built in.
    expect(isMoneyMoment("Matumizi ya KayaTox: kunywa asubuhi", "out")).toBe(false);
    expect(isMoneyMoment("Matumizi ya KayaTox: kunywa asubuhi", "out", [], "text", ["Matumizi ya"])).toBe(true);
    expect(isMoneyMoment("Jinsi  ya KUTUMIA: paka usiku", "out", [], "text", ["jinsi ya kutumia"])).toBe(true);
    expect(isMoneyMoment("Karibu KAYANI, special pack imefika", "out", ["special pack imefika"])).toBe(true);
    expect(isMoneyMoment("Bei ni 75,000", "out")).toBe(false);
  });
});

import { analyze } from "../../supabase/functions/_shared/signals";
describe("per-business delivered texts in analyze", () => {
  const msgs = [
    { direction: "out" as const, sent_at: "2026-11-20T08:00:00Z", body: "Lipa namba 123456", type: "text" },
    { direction: "out" as const, sent_at: "2026-11-20T09:00:00Z", body: "Matumizi ya KayaTox: kunywa asubuhi", type: "text" },
  ];
  it("a business without the wording gets no sale from it", () => {
    expect(analyze(msgs, Date.parse("2026-11-20T10:00:00Z")).payment_signal).toBe(false);
  });
  it("a business with the wording gets the same result as before", () => {
    const a = analyze(msgs, Date.parse("2026-11-20T10:00:00Z"), { delivered: ["Matumizi ya"] });
    expect(a.payment_signal).toBe(true);
    expect(a.label).toBe("using");
  });
});
