import { describe, it, expect } from "vitest";
import { receiverSuggestions, worth, trendOk, prettyNum, openLeaks, flagText, type LostRes, type LeakRes, type PayItem } from "../src/guards";

const T = (en: string) => en;

describe("receiverSuggestions", () => {
  // what Kayani's customers' screenshots actually showed
  const seen = [
    { paid_to: "LIPA KAYANI HERBS 36030266", n: 3 },
    { paid_to: "LIPA KAYANI HERBS 0774587", n: 2 },
    { paid_to: "LIPA KAYANI HERBS ****0266 (via MPESA)", n: 1 },
    { paid_to: "TNQR.LIPA KAYANI HER. 36030266", n: 1 },
    { paid_to: "Daudi Maboni 0745160572 (Mobile Transfer, Vodacom)", n: 1 },
    { paid_to: "Lipa Kayani Herbs 36030266", n: 1 },
  ];
  it("pulls out each number once, most seen first, and skips masked ones", () => {
    const s = receiverSuggestions(seen, []);
    expect(s.map((x) => x.num)).toEqual(["36030266", "0774587", "0745160572"]);
    expect(s[0]!.n).toBe(5);
    expect(s[0]!.label).toMatch(/KAYANI/);
    expect(s[2]!.label).toBe("Daudi Maboni");
  });
  it("leaves out numbers already listed, whatever their format", () => {
    expect(receiverSuggestions(seen, ["36030266", "+255 774 587"]).map((x) => x.num)).toEqual(["0745160572"]);
  });
  it("ignores receivers with no number", () => {
    expect(receiverSuggestions([{ paid_to: "LIPA KAYANI HERBS", n: 4 }], [])).toEqual([]);
  });
});

describe("worth", () => {
  it("is 1 in 10 back × the average sale, rounded to whole customers", () => {
    expect(worth(125, 152000)).toBe(2_000_000);   // 13 × 152,000 = 1,976,000, shown as an estimate
    expect(worth(4, 152000)).toBeNull();   // rounds to 0 customers
    expect(worth(50, null)).toBeNull();
  });
});

describe("trendOk", () => {
  const base = (lost: number, prev: number[]): LostRes => ({
    days: 30, chats: 0, lost, sold: 0, avg_sale: null, close_rate: null, by_ad: [],
    reasons: prev.map((p, i) => ({ reason: (["price", "money"] as const)[i]!, n: 1, after_price: 0, from_ads: 0, prev: p, examples: null, ids: null })),
  });
  it("hides the comparison when the earlier period was barely read by Kito", () => {
    expect(trendOk(base(2062, [58, 43]))).toBe(false);
    expect(trendOk(base(100, [40, 30]))).toBe(true);
  });
});

describe("leak helpers", () => {
  it("formats phone numbers and leaves tills alone", () => {
    expect(prettyNum("652729457")).toBe("0652 729 457");
    expect(prettyNum("36030266")).toBe("36030266");
  });
  it("counts open problems only", () => {
    const r: LeakRes = {
      days: 30, receivers_set: true, team: 1, phone_messages: 0, people: [], unrecorded_items: [], unrecorded: 2, unrecorded_amount: 0,
      paid_elsewhere: [{ paid_to: "X 0745", n: 1, amount: 1, conv_ids: [], last_at: "" }],
      numbers: [
        { flag: "pay_number", num: "1", n: 1, chats: 1, first_at: "", last_at: "", conv_ids: [], sample: "", senders: null, verdict: null },
        { flag: "personal_number", num: "2", n: 1, chats: 1, first_at: "", last_at: "", conv_ids: [], sample: "", senders: null, verdict: "ok" },
      ],
    };
    expect(openLeaks(r)).toBe(4);
  });
});

describe("flagText", () => {
  const it0: PayItem = {
    message_id: "m", conversation_id: "c", contact_name: "A", sent_at: "", amount: 55000, txn_code: null, provider: null, paid_to: "Juma 0712",
    paid_at_text: "1/1/2025", confidence: "high", notes: null, flags: ["amount"], severity: "amber", expected: 175000, other_conversation_id: null, verdict: null, reviewed_at: null,
  };
  const M = (n: number | null | undefined) => "TZS " + n;
  it("names the numbers involved", () => {
    expect(flagText("amount", it0, T, M)).toContain("TZS 175000");
    expect(flagText("receiver", it0, T, M)).toContain("Juma 0712");
  });
});
