import { describe, it, expect } from "vitest";
import { gotPrice } from "../src/lib";

describe("gotPrice", () => {
  it("counts a price typed in the chat", () => expect(gotPrice({ price_shared: true, kito_label: null })).toBe(true));
  it("counts a price only Kito found (voice note)", () => expect(gotPrice({ price_shared: false, kito_label: "priced" })).toBe(true));
  it("counts later stages Kito found", () => expect(gotPrice({ price_shared: false, kito_label: "awaiting_payment" })).toBe(true));
  it("does not count a chat still talking", () => expect(gotPrice({ price_shared: false, kito_label: "talking" })).toBe(false));
});
