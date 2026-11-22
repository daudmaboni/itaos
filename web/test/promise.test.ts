import { describe, it, expect } from "vitest";
import { zonedToUtc, localStamp, findSource, planPromise, ruleDate, clearDue } from "../../supabase/functions/_shared/promise";

const inn = (id: string, body: string, at: string) => ({ id, direction: "in", sent_at: at, body, type: "text" });
const out = (id: string, body: string, at: string) => ({ id, direction: "out", sent_at: at, body, type: "text" });
// Fri 2026-11-20 10:00 EAT
const NOW = Date.parse("2026-11-20T07:00:00Z");

describe("time zones", () => {
  it("turns Dar es Salaam wall time into UTC", () => {
    expect(zonedToUtc("2026-11-21", "16:00")).toBe("2026-11-21T13:00:00.000Z");
    expect(zonedToUtc("2026-11-21", "09:00", "Africa/Nairobi")).toBe("2026-11-21T06:00:00.000Z");
  });
  it("rejects impossible dates and times", () => {
    expect(zonedToUtc("2026-02-31", "09:00")).toBeNull();
    expect(zonedToUtc("2026-11-21", "25:00")).toBeNull();
    expect(zonedToUtc("kesho", "09:00")).toBeNull();
  });
  it("stamps days in business time", () => {
    expect(localStamp("2026-11-20T22:30:00Z")).toBe("Sat 2026-11-21 01:30");
  });
});

describe("finding the customer's message", () => {
  const msgs = [inn("a", "Bei gani?", "2026-11-19T07:00:00Z"), out("b", "Ni 175,000", "2026-11-19T07:05:00Z"), inn("c", "Sawa nitalipa Ijumaa  asubuhi!", "2026-11-19T08:00:00Z")];
  it("matches ignoring case, spaces and punctuation", () => {
    expect(findSource(msgs, "nitalipa ijumaa asubuhi")?.id).toBe("c");
  });
  it("never matches the business's own words", () => {
    expect(findSource(msgs, "Ni 175,000")).toBeNull();
  });
});

describe("planning a promise", () => {
  const msgs = [inn("m1", "Nimeipenda", "2026-11-19T07:00:00Z"), inn("m2", "Nitalipa kesho saa nne", "2026-11-19T08:00:00Z")];
  it("dates a promise and keys it to its message", () => {
    const p = planPromise({ kind: "pay", quote: "Nitalipa kesho saa nne", when_text: "kesho saa nne", due_date: "2026-11-20", due_time: "10:00" }, msgs, { now: NOW });
    expect(p).toMatchObject({ kind: "pay", due_at: "2026-11-20T07:00:00.000Z", promise_key: "m:m2:pay", promise_at: "2026-11-19T08:00:00.000Z" });
  });
  it("marks a plainly named day as clear, so itaOS sets the reminder itself", () => {
    const m = [inn("t1", "Tar 3 ndo narud ntawachek sasa", "2026-11-22T11:00:00Z")];
    const p = planPromise({ kind: "come_back", quote: "Tar 3 ndo narud", when_text: "Tar 3", due_date: "2026-11-24", due_time: null }, m, { now: Date.parse("2026-11-22T11:10:00Z") });
    expect(p).toMatchObject({ clear: true, due_at: "2026-12-03T06:00:00.000Z" });
  });
  it("keeps Kito's own date guesses and vague promises for the owner to confirm", () => {
    const m = [inn("v1", "Nitakuja siku ya mshahara", "2026-11-19T08:00:00Z")];
    const guess = planPromise({ kind: "collect", quote: "Nitakuja siku ya mshahara", when_text: "siku ya mshahara", due_date: "2026-11-25", due_time: null }, m, { now: NOW });
    expect(guess?.clear).toBe(false);
    const vague = planPromise({ kind: "collect", quote: "Nitakuja siku ya mshahara", when_text: "", due_date: null, due_time: null }, m, { now: NOW });
    expect(vague).toMatchObject({ clear: false, due_at: null });
  });
  it("uses a default hour when only the day is known", () => {
    const p = planPromise({ kind: "call", quote: "Nitalipa kesho saa nne", due_date: "2026-11-21", due_time: null }, msgs, { now: NOW });
    expect(p?.due_at).toBe("2026-11-21T07:00:00.000Z"); // 10:00 EAT for calls
  });
  it("leaves salary-day promises undated for the owner", () => {
    const m = [inn("s", "Nikipata mshahara nitachukua", "2026-11-19T08:00:00Z")];
    const p = planPromise({ kind: "pay", quote: "Nikipata mshahara nitachukua", when_text: "mshahara", due_date: null, due_time: null }, m, { now: NOW });
    expect(p?.due_at).toBeNull();
  });
  it("drops dates before the promise or months away", () => {
    expect(planPromise({ kind: "pay", quote: "Nitalipa kesho saa nne", due_date: "2026-10-01", due_time: null }, msgs, { now: NOW })?.due_at).toBeNull();
    expect(planPromise({ kind: "pay", quote: "Nitalipa kesho saa nne", due_date: "2027-09-01", due_time: null }, msgs, { now: NOW })?.due_at).toBeNull();
  });
  it("ignores old promises and long-missed due dates", () => {
    expect(planPromise({ kind: "pay", quote: "Nitalipa kesho saa nne", due_date: "2026-11-20", due_time: null }, msgs, { now: Date.parse("2026-12-30T00:00:00Z") })).toBeNull();
    const m = [inn("x", "Nitalipa jumatatu", "2026-11-05T08:00:00Z")];
    expect(planPromise({ kind: "pay", quote: "Nitalipa jumatatu", due_date: "2026-11-09", due_time: null }, m, { now: NOW })).toBeNull();
  });
  it("returns nothing for empty or junk promises", () => {
    expect(planPromise(null, msgs, { now: NOW })).toBeNull();
    expect(planPromise({ kind: "pay", quote: "" }, msgs, { now: NOW })).toBeNull();
  });
  it("falls back to a quote key when the words can't be found", () => {
    const p = planPromise({ kind: "weird", quote: "something paraphrased by the model", due_date: null }, msgs, { now: NOW });
    expect(p?.kind).toBe("other");
    expect(p?.promise_key.startsWith("q:")).toBe(true);
  });
});

describe("fixed date rules", () => {
  // Fri 2026-10-30
  it("reads relative days", () => {
    expect(ruleDate("kesho", "2026-10-30")).toBe("2026-10-31");
    expect(ruleDate("keshokutwa", "2026-10-30")).toBe("2026-11-01");
    expect(ruleDate("wiki ijayo", "2026-10-30")).toBe("2026-11-06");
    expect(ruleDate("leo jioni", "2026-10-30")).toBe("2026-10-30");
  });
  it("reads weekdays as the next such day", () => {
    expect(ruleDate("juma pili", "2026-10-30")).toBe("2026-11-01");
    expect(ruleDate("Jumamosi", "2026-10-22")).toBe("2026-10-24");
    expect(ruleDate("Ijumaa", "2026-10-30")).toBe("2026-11-06"); // said on a Friday: next Friday
  });
  it("reads month end", () => {
    expect(ruleDate("Mwisho wa mwezi", "2026-07-10")).toBe("2026-07-31");
    expect(ruleDate("MWISHO WA mwezi", "2026-09-30")).toBe("2026-10-31");
  });
  it("reads a day of the month (tarehe / tar / 3rd)", () => {
    expect(ruleDate("Tar 3", "2026-11-22")).toBe("2026-12-03"); // already passed: next month
    expect(ruleDate("tarehe 28", "2026-11-22")).toBe("2026-11-28");
    expect(ruleDate("tr. 22", "2026-11-22")).toBe("2026-11-22");
    expect(ruleDate("the 3rd", "2026-11-22")).toBe("2026-12-03");
    expect(ruleDate("tarehe 31", "2026-11-05")).toBe("2026-12-31"); // November has no 31st
    expect(ruleDate("tar 40", "2026-11-22")).toBeNull();
    expect(ruleDate("saa 3", "2026-11-22")).toBeNull(); // a time, not a date
  });
  it("leaves unknown phrases to Kito", () => {
    expect(ruleDate("nikipata mshahara", "2026-07-10")).toBeNull();
    expect(ruleDate("", "2026-07-10")).toBeNull();
  });
  it("overrides a wrong AI date", () => {
    const m = [inn("b", "Mwisho wa mwezi nitakuja Biafra", "2026-07-10T10:25:00Z")];
    const p = planPromise({ kind: "collect", quote: "Mwisho wa mwezi nitakuja Biafra", when_text: "Mwisho wa mwezi", due_date: "2026-06-30", due_time: null }, m, { now: Date.parse("2026-07-12T00:00:00Z") });
    expect(p?.due_at).toBe("2026-07-31T06:00:00.000Z");
  });
});

describe("opening promises saved before clear days were automatic", () => {
  it("fixes the day and keeps the hour already read", () => {
    // The card from 22 Nov: "Tar 3" saved as 24 Nov 09:00
    expect(clearDue("Tar 3", "2026-11-22T11:00:00Z", "2026-11-24T06:00:00Z", "come_back")).toBe("2026-12-03T06:00:00.000Z");
    expect(clearDue("kesho saa kumi", "2026-11-22T11:00:00Z", "2026-11-23T13:00:00Z", "call")).toBe("2026-11-23T13:00:00.000Z");
    expect(clearDue("Ijumaa", "2026-11-22T11:00:00Z", null, "call")).toBe("2026-11-27T07:00:00.000Z");
  });
  it("leaves vague days for the owner", () => {
    expect(clearDue("mshahara", "2026-11-22T11:00:00Z", null, "pay")).toBeNull();
    expect(clearDue(null, "2026-11-22T11:00:00Z", null, "pay")).toBeNull();
  });
});
