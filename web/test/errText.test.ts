import { describe, expect, it, beforeEach } from "vitest";
import { errText } from "../src/errText";

describe("errText", () => {
  beforeEach(() => { (globalThis as any).document = { documentElement: { lang: "en" } }; });

  it("turns tech errors into plain words", () => {
    expect(errText(new TypeError("Failed to fetch"))).toMatch(/No internet/);
    expect(errText({ message: "permission denied for table orders", code: "42501" })).toMatch(/permission/);
    expect(errText({ message: "Could not find the function public.x in the schema cache", code: "PGRST202" })).toMatch(/latest itaOS update/);
    expect(errText({ message: 'duplicate key value violates unique constraint "x"', code: "23505" })).toMatch(/already saved/);
    expect(errText(new Error("Edge Function returned a non-2xx status code"))).toMatch(/our side/);
    expect(errText("")).toMatch(/our side/);
  });

  it("keeps messages that are already sentences", () => {
    expect(errText(new Error("WhatsApp only allows replies within 24 hours."))).toBe("WhatsApp only allows replies within 24 hours.");
  });

  it("follows the business language", () => {
    (globalThis as any).document.documentElement.lang = "sw";
    expect(errText(new TypeError("Failed to fetch"))).toMatch(/Hakuna mtandao/);
  });
});
