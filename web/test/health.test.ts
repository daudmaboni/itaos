import { describe, it, expect } from "vitest";
import { waSilence, tokenProblem, message } from "../../supabase/functions/push-send/health";

const H = 3600_000;
const now = Date.parse("2026-11-21T18:00:00Z");
const ago = (h: number) => new Date(now - h * H).toISOString();

describe("waSilence", () => {
  it("ignores quiet numbers and never-linked numbers", () => {
    expect(waSilence(36, 3600, ago(72), now)).toBeNull();
    expect(waSilence(5000, 3600, null, now)).toBeNull();
  });
  it("uses 3x the usual longest gap, between 4 and 12 hours", () => {
    // Kayani: longest gap ~2h10m → limit 6.5 h
    expect(waSilence(4449, 7824, ago(6), now)).toBeNull();
    expect(waSilence(4449, 7824, ago(7), now)).toMatchObject({ hours: 7, usual: 2 });
    // very busy number: never alerts before 4 h
    expect(waSilence(9000, 600, ago(3.5), now)).toBeNull();
    expect(waSilence(9000, 600, ago(4.5), now)).not.toBeNull();
    // spiky number: never waits more than 12 h
    expect(waSilence(200, 10 * 3600, ago(13), now)).not.toBeNull();
  });
});

describe("tokenProblem", () => {
  it("treats expired/revoked tokens and lost permissions as broken", () => {
    expect(tokenProblem(400, { code: 190 })).toBe(true);
    expect(tokenProblem(403, { code: 200 })).toBe(true);
    expect(tokenProblem(400, { code: 100, error_subcode: 33 })).toBe(true);
  });
  it("ignores Meta outages and rate limits", () => {
    expect(tokenProblem(500, { code: 1 })).toBe(false);
    expect(tokenProblem(400, { code: 17 })).toBe(false);
    expect(tokenProblem(500, { code: 100 })).toBe(false);
    expect(tokenProblem(500, undefined)).toBe(false);
  });
});

describe("message", () => {
  it("speaks Swahili to a Swahili owner and English with the business name to staff", () => {
    const p = { kind: "wa_silent" as const, problem: "x", hours: 7, usual: 2 };
    expect(message(p, null, "Kayani Herbs", true, false).title).toContain("WhatsApp huenda");
    const st = message(p, null, "Kayani Herbs", true, true);
    expect(st.title).toContain("Kayani Herbs");
    expect(st.url).toBe("/app/admin");
  });
  it("says what recovered", () => {
    expect(message(null, "ads_token", "K", false, false).title).toBe("✅ Meta Ads is working again");
  });
});
