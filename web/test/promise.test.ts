import { describe, it, expect } from "vitest";
import { zonedToUtc, localStamp, findSource, planPromise, ruleDate, clearDue, ruleDue, ruleClock, ruleOffset, morningSlot } from "../../supabase/functions/_shared/promise";

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
    expect(p?.clear).toBe(true);
    expect(localStamp(p!.due_at!).slice(4, 14)).toBe("2026-12-03");
    expect(["09:00", "10:00", "11:00", "12:00"]).toContain(localStamp(p!.due_at!).slice(15, 20)); // no hour said: 9–12
  });
  it("keeps Kito's own date guesses and vague promises for the owner to confirm", () => {
    const m = [inn("v1", "Nitakuja siku ya mshahara", "2026-11-19T08:00:00Z")];
    const guess = planPromise({ kind: "collect", quote: "Nitakuja siku ya mshahara", when_text: "siku ya mshahara", due_date: "2026-11-25", due_time: null }, m, { now: NOW });
    expect(guess?.clear).toBe(false);
    const vague = planPromise({ kind: "collect", quote: "Nitakuja siku ya mshahara", when_text: "", due_date: null, due_time: null }, m, { now: NOW });
    expect(vague).toMatchObject({ clear: false, due_at: null });
  });
  it("uses a 9–12 morning hour when only Kito's day is known", () => {
    const p = planPromise({ kind: "call", quote: "Nitalipa kesho saa nne", due_date: "2026-11-21", due_time: null }, msgs, { now: NOW });
    expect(["09:00", "10:00", "11:00", "12:00"]).toContain(localStamp(p!.due_at!).slice(15, 20));
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

describe("opening promises saved before clear times were automatic", () => {
  it("sets the day, and the hour only when one was said", () => {
    expect(localStamp(clearDue("Tar 3", "2026-11-22T11:00:00Z", "k1")!).slice(4, 14)).toBe("2026-12-03");
    expect(clearDue("kesho saa kumi", "2026-11-22T11:00:00Z", "k2")).toBe("2026-11-23T13:00:00.000Z"); // 16:00
    expect(localStamp(clearDue("Ijumaa", "2026-11-22T11:00:00Z", "k3")!).slice(4, 14)).toBe("2026-11-27");
  });
  it("leaves vague days for the owner", () => {
    expect(clearDue("mshahara", "2026-11-22T11:00:00Z", "k")).toBeNull();
    expect(clearDue(null, "2026-11-22T11:00:00Z", "k")).toBeNull();
  });
});

// Sun 2026-11-22 14:34 EAT
const SAID = "2026-11-22T11:34:00Z";
const local = (iso: string | null) => (iso ? localStamp(iso).slice(4) : null);

describe("clear times: itaOS sets the reminder itself", () => {
  it("reads 'after an hour' kinds of phrases from when it was said", () => {
    expect(local(ruleDue("baad ya lisaa limoj", SAID, "k"))).toBe("2026-11-22 15:34"); // the card from 22 Nov
    expect(local(ruleDue("baada ya saa moja", SAID, "k"))).toBe("2026-11-22 15:34");
    expect(local(ruleDue("lisaa limoja", SAID, "k"))).toBe("2026-11-22 15:34");
    expect(local(ruleDue("baada ya masaa mawili", SAID, "k"))).toBe("2026-11-22 16:34");
    expect(local(ruleDue("dakika 30", SAID, "k"))).toBe("2026-11-22 15:04");
    expect(local(ruleDue("baada ya nusu saa", SAID, "k"))).toBe("2026-11-22 15:04");
    expect(local(ruleDue("in 1 hour", SAID, "k"))).toBe("2026-11-22 15:34");
    expect(local(ruleDue("in an hour", SAID, "k"))).toBe("2026-11-22 15:34");
    expect(local(ruleDue("after 2 hours", SAID, "k"))).toBe("2026-11-22 16:34");
    expect(local(ruleDue("in 45 mins", SAID, "k"))).toBe("2026-11-22 15:19");
  });
  it("reads Swahili and Western clock times", () => {
    expect(ruleClock("saa 11 jioni")).toBe("17:00");
    expect(ruleClock("saa kumi")).toBe("16:00");
    expect(ruleClock("saa nne asubuhi")).toBe("10:00");
    expect(ruleClock("saa 3")).toBe("09:00");
    expect(ruleClock("saa 2 usiku")).toBe("20:00");
    expect(ruleClock("saa 6 mchana")).toBe("12:00");
    expect(ruleClock("saa tatu na nusu")).toBe("09:30");
    expect(ruleClock("saa 17")).toBe("17:00");
    expect(ruleClock("17:00")).toBe("17:00");
    expect(ruleClock("5pm")).toBe("17:00");
    expect(ruleClock("at 5")).toBe("17:00");
    expect(ruleClock("kesho")).toBeNull();
  });
  it("puts a named hour on today if it's still ahead, else tomorrow", () => {
    expect(local(ruleDue("leo saa 11 jioni", SAID, "k"))).toBe("2026-11-22 17:00");
    expect(local(ruleDue("today at 17", SAID, "k"))).toBe("2026-11-22 17:00");
    expect(local(ruleDue("saa 3", SAID, "k"))).toBe("2026-11-23 09:00"); // 9:00 already gone today
  });
  it("puts a named hour on a named day", () => {
    expect(local(ruleDue("kesho saa nne", SAID, "k"))).toBe("2026-11-23 10:00");
    expect(local(ruleDue("Jumatatu saa 8 mchana", SAID, "k"))).toBe("2026-11-23 14:00");
  });
  it("gives a day without an hour a 9–12 morning time", () => {
    for (const w of ["kesho", "Jumatatu", "Jumanne wiki ijayo", "tar 3", "next week"]) {
      const hm = local(ruleDue(w, SAID, "key-" + w))!.slice(11);
      expect(["09:00", "10:00", "11:00", "12:00"]).toContain(hm);
    }
    expect(local(ruleDue("Jumanne wiki ijayo", SAID, "k"))!.slice(0, 10)).toBe("2026-11-24"); // said Sun 22 Nov: next week starts Mon 23
    expect(local(ruleDue("Jumanne wiki ijayo", "2026-11-24T08:00:00Z", "k"))!.slice(0, 10)).toBe("2026-12-01"); // said on a Tuesday
    expect(local(ruleDue("Alhamisi wiki ijayo", "2026-11-23T08:00:00Z", "k"))!.slice(0, 10)).toBe("2026-12-03"); // said Mon 23: not this Thursday
  });
  it("spreads morning reminders over 9, 10, 11 and 12", () => {
    const hours = new Set(Array.from({ length: 40 }, (_, i) => morningSlot("p" + i)));
    expect(hours).toEqual(new Set(["09:00", "10:00", "11:00", "12:00"]));
  });
  it("'today' with no hour, said after the morning: two hours later", () => {
    expect(local(ruleDue("leo", SAID, "k"))).toBe("2026-11-22 16:34");
    expect(local(ruleDue("leo", "2026-11-22T18:30:00Z", "k"))!.slice(0, 10)).toBe("2026-11-23"); // 21:30: tomorrow morning
  });
  it("reads the short forms people type", () => {
    expect(ruleDate("jmosi", "2026-11-22")).toBe("2026-11-28");
    expect(ruleDate("jpl", "2026-11-22")).toBe("2026-11-29");
    expect(ruleDate("j3", "2026-11-22")).toBe("2026-11-23");
    expect(ruleDate("mwishon mwa huu mwez", "2026-11-15")).toBe("2026-11-30");
  });
  it("leaves promises with no clear time for the owner", () => {
    for (const w of ["nitakujulisha", "nitakuangalia", "nikipata mshahara", "baadae", "soon", "", "nikirudi", "wiki 2 hivi", "januari", "ndan ya mwez", "ijuma tano"]) expect(ruleDue(w, SAID, "k")).toBeNull();
    expect(ruleOffset("saa tatu na dakika 10")).toBeNull(); // a clock time, not "in 10 minutes"
  });
  it("makes the 22 Nov card clear, so it opens by itself", () => {
    const m = [inn("sl", "Ndio kak baad ya lisaa limoj natok kazn", SAID)];
    const p = planPromise({ kind: "pay", quote: "baad ya lisaa limoj", when_text: "baad ya lisaa limoj", due_date: "2026-11-22", due_time: "15:40" }, m, { now: Date.parse(SAID) + 6 * 60e3 });
    expect(p?.clear).toBe(true);
    expect(local(p!.due_at)).toBe("2026-11-22 15:34");
  });
});
