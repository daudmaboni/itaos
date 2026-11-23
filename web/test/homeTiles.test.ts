import { describe, it, expect } from "vitest";
import { buildTiles, pickLook, LOOKS } from "../src/homeTiles";

const T = (en: string) => en;
const kayani = { roas: 3.0, spend: "TZS 44,804", adTodo: 1, lost: 2057, sold: 26, topReason: "Went quiet before the price", checked: 9, toCheck: 0, toCheckRed: 0, leaks: 0, messages: 11856 };

describe("home tiles", () => {
  it("draws Kayani's numbers", () => {
    const t = buildTiles(kayani, T);
    expect(t.ads.value).toBe("3.0×");
    expect(t.ads.fill).toBeCloseTo(0.6);      // 3× on a 0–5× scale
    expect(t.ads.mark).toBeCloseTo(0.2);      // break-even at 1×
    expect(t.pay.value).toBe("9 / 9");
    expect(t.pay.needs).toBe(false);
    expect(t.why.bought).toBe("26");
    expect(t.why.boughtShare).toBeCloseTo(26 / 2083);
    expect(t.leak.sub).toBe("of 11,856 messages");
    expect(t.next?.key).toBe("ads");           // the ad to-do is the most urgent here
  });
  it("a suspicious payment beats everything for the one button", () => {
    const t = buildTiles({ ...kayani, toCheck: 2, toCheckRed: 1 }, T);
    expect(t.next).toEqual({ key: "pay", href: "#payments" });
    expect(t.pay.value).toBe("7 / 9");
    expect(t.pay.red).toBe(true);
  });
  it("a losing ad needs you even with no to-do, and no ad data shows the spend", () => {
    expect(buildTiles({ ...kayani, roas: 0.6, adTodo: 0 }, T).ads.needs).toBe(true);
    const t = buildTiles({ ...kayani, roas: null }, T);
    expect(t.ads.value).toBe("TZS 44,804");
    expect(t.ads.fill).toBe(0);
  });
  it("picks another look each time", () => {
    for (let i = 0; i < 20; i++) { const cur = LOOKS[i % 4]!; expect(pickLook(cur)).not.toBe(cur); }
    expect(LOOKS).toContain(pickLook(null, () => 0.99));
  });
});
