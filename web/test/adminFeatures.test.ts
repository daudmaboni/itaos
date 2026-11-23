import { describe, it, expect } from "vitest";
import { featureRows, adoption, type FeatureUse } from "../src/adminFeatures";

// Kayani's real numbers on 23 Nov (admin_feature_use)
const kayani: FeatureUse = {
  id: "k", name: "Kayani Herbs", followups_30d: 10, sales_after_followup_30d: 1, promises: { proposed: 90, open: 24, overdue: 23 },
  reorder_on: false, reorder_marks_30d: 0, send_on: false, itaos_sent_30d: 5, templates: {},
  products: { active: 6, priced: 0, costed: 6 }, unit_cost_set: true, receipt_links: 13, receipt_scans_30d: 3,
  wallet: { lines: 0, last_upload: null, not_recorded: 0 }, ads: { running: 1, all: 374 }, ad_spend_14d: 495.61, ad_last_day: "2026-11-23",
  pay_receivers: 0, screenshots_30d: 17, payments_to_check: 3, fakes_caught: 0, team: 1, assigned_30d: 0,
  push_devices: 3, alerts_open: 0, voice_30d: 636, kito_read_30d: 3124, rules_reviewed_at: "2026-11-21T18:08:29Z", branded: true, proof_test: 10,
};
const now = Date.parse("2026-11-23T12:00:00Z");
const by = (k: string) => featureRows(kayani, now).find((r) => r.key === k)!;

describe("admin feature rows", () => {
  it("flags what Kayani hasn't finished setting up", () => {
    expect(by("send").state).toBe("off");
    expect(by("templates").state).toBe("off");
    expect(by("products").state).toBe("warn");          // no prices
    expect(by("products").hint).toMatch(/price/);
    expect(by("promises").state).toBe("warn");          // 23 overdue
    expect(by("fakes").hint).toMatch(/Lipa namba/);     // payment numbers not set
    expect(by("ads").hint).toMatch(/second ad/);
    expect(by("wallet").state).toBe("off");
  });
  it("marks what works as in use", () => {
    expect(by("kito").state).toBe("ok");
    expect(by("push").state).toBe("ok");
    expect(by("rules").state).toBe("ok");
    expect(by("receipts").state).toBe("ok");
  });
  it("treats an old M-Pesa paste as needing a nudge", () => {
    const r = featureRows({ ...kayani, wallet: { lines: 40, last_upload: "2026-10-01T00:00:00Z", not_recorded: 2 } }, now).find((x) => x.key === "wallet")!;
    expect(r.state).toBe("warn");
    expect(r.text).toMatch(/53 days ago/);
  });
  it("scores adoption between 0 and 100", () => {
    const s = adoption(featureRows(kayani, now));
    expect(s).toBeGreaterThan(30);
    expect(s).toBeLessThan(80);
    const empty = featureRows({ ...kayani, followups_30d: 0, promises: null, products: null, wallet: null, ads: null, receipt_links: 0, screenshots_30d: 0, kito_read_30d: 0, push_devices: 0, voice_30d: 0, rules_reviewed_at: null, branded: false, alerts_open: 0 }, now);
    expect(adoption(empty)).toBeLessThan(20);
  });
});
