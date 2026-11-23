import { describe, it, expect } from "vitest";
import { pickDoNow, type Signals } from "../src/doNow";

const T = (en: string) => en;
const base: Signals = { payRed: 0, payAmber: 0, waiting: 0, overdue: 0, proposed: 0, ad: null, adName: () => "Ngiri Ad", leaks: 0, unrecorded: 0, unrecordedAmount: "TZS 0" };

describe("Do this now", () => {
  it("is empty when nothing needs doing", () => {
    expect(pickDoNow(base, T)).toEqual([]);
  });
  it("puts a suspicious payment first, then waiting customers, at most 3", () => {
    const r = pickDoNow({ ...base, payRed: 1, waiting: 4, overdue: 23, leaks: 2, payAmber: 2, proposed: 90 }, T);
    expect(r.map((i) => i.key)).toEqual(["pay", "reply", "promise"]);
    expect(r[0].href).toBe("#payments");
    expect(r[1].text).toBe("4 customers are waiting for your reply.");
  });
  it("a 'stop this ad' outranks promises, other ad advice does not", () => {
    const line = { ad: { name: "Ngiri Ad", ad_id: "1" } } as any;
    expect(pickDoNow({ ...base, overdue: 3, ad: { k: "stop", ad: line, perDay: 1 } }, T).map((i) => i.key)).toEqual(["ad", "promise"]);
    expect(pickDoNow({ ...base, overdue: 3, ad: { k: "second_ad", ad: line } }, T).map((i) => i.key)).toEqual(["promise", "ad"]);
  });
  it("Kayani today: waiting, overdue promises, then unrecorded payments", () => {
    const r = pickDoNow({ ...base, payAmber: 3, waiting: 12, overdue: 23, proposed: 90, unrecorded: 2, unrecordedAmount: "TZS 189,000", ad: { k: "second_ad", ad: { ad: { name: "N" } } as any } }, T);
    expect(r.map((i) => i.key)).toEqual(["reply", "promise", "unrec"]);
    expect(r[0].tone).toBe("bad");   // 5+ waiting
  });
  it("uses singular words for one", () => {
    expect(pickDoNow({ ...base, waiting: 1 }, T)[0].text).toBe("1 customer is waiting for your reply.");
  });
});
