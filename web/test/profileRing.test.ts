import { describe, it, expect } from "vitest";
import { ringOf } from "../src/profileRing";

describe("profile ring", () => {
  it("is quiet until the counts load", () => expect(ringOf(null).tone).toBe("none"));
  it("green when nothing waits", () => expect(ringOf({ payRed: 0, payAmber: 0, waiting: 0, overdue: 0, broken: 0 })).toEqual({ tone: "green", count: 0, badge: null }));
  it("amber with the count of things to do", () => expect(ringOf({ payRed: 0, payAmber: 3, waiting: 24, overdue: 23, broken: 0 })).toEqual({ tone: "amber", count: 50, badge: "50" }));
  it("red beats everything for a fake-looking payment or a broken connection", () => {
    expect(ringOf({ payRed: 1, payAmber: 0, waiting: 5, overdue: 0, broken: 0 }).tone).toBe("red");
    expect(ringOf({ payRed: 0, payAmber: 0, waiting: 0, overdue: 0, broken: 1 }).badge).toBe("!");
  });
  it("caps the badge", () => expect(ringOf({ payRed: 0, payAmber: 0, waiting: 150, overdue: 0, broken: 0 }).badge).toBe("99+"));
});
