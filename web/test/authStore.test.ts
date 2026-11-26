import { describe, it, expect, beforeEach } from "vitest";

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const g = globalThis as any;

describe("keep me signed in", () => {
  let mod: typeof import("../src/authStore");
  beforeEach(async () => { g.localStorage = new Mem(); g.sessionStorage = new Mem(); mod = await import("../src/authStore"); });

  it("uses the same key Supabase uses by default, so nobody is signed out", () => {
    expect(mod.AUTH_KEY).toBe("sb-localhost-auth-token");
  });

  it("keeps the sign-in on the device by default", () => {
    expect(mod.rememberThisDevice()).toBe(true);
    mod.authStorage.setItem(mod.AUTH_KEY, JSON.stringify({ refresh_token: "r" }));
    expect(g.localStorage.getItem(mod.AUTH_KEY)).not.toBeNull();
    expect(g.sessionStorage.getItem(mod.AUTH_KEY)).toBeNull();
    expect(mod.hasSavedSignIn()).toBe(true);
  });

  it("unticked: only this browser session holds it, and an old saved copy is cleared", () => {
    g.localStorage.setItem(mod.AUTH_KEY, "old");
    mod.setRememberThisDevice(false);
    mod.authStorage.setItem(mod.AUTH_KEY, JSON.stringify({ refresh_token: "r" }));
    expect(g.localStorage.getItem(mod.AUTH_KEY)).toBeNull();
    expect(g.sessionStorage.getItem(mod.AUTH_KEY)).not.toBeNull();
    expect(mod.hasSavedSignIn()).toBe(true);
    g.sessionStorage = new Mem(); // browser closed
    expect(mod.hasSavedSignIn()).toBe(false);
  });

  it("sign-out removes it from both places", () => {
    g.localStorage.setItem(mod.AUTH_KEY, "a"); g.sessionStorage.setItem(mod.AUTH_KEY, "b");
    mod.authStorage.removeItem(mod.AUTH_KEY);
    expect(mod.authStorage.getItem(mod.AUTH_KEY)).toBeNull();
  });

  it("no sign-in or a broken copy means not signed in", () => {
    expect(mod.hasSavedSignIn()).toBe(false);
    g.localStorage.setItem(mod.AUTH_KEY, "{not json");
    expect(mod.hasSavedSignIn()).toBe(false);
  });
});
