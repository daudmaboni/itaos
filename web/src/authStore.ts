// Where the business sign-in is kept on this device (26 Nov 2026).
//
// "Keep me signed in on this device" (ticked by default):
//  - ticked   → the sign-in lives in localStorage and survives closing the browser or the app.
//  - unticked → it lives in sessionStorage and ends when the tab or browser is closed (shared phones).
// The choice itself is remembered on the device, so a shared phone stays "unticked" for the next person.
//
// No Supabase import here: main.tsx uses hasSavedSignIn() before deciding which page to load,
// and the public homepage must stay light.

const REMEMBER_KEY = "itaos-remember";

/** Same key Supabase uses by default (sb-<project ref>-auth-token), so nobody is signed out by this change. */
export const AUTH_KEY = (() => {
  try { return `sb-${new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split(".")[0]}-auth-token`; }
  catch { return "sb-auth-token"; }
})();

export function rememberThisDevice(): boolean {
  try { return localStorage.getItem(REMEMBER_KEY) !== "0"; } catch { return true; }
}

export function setRememberThisDevice(on: boolean) {
  try { if (on) localStorage.removeItem(REMEMBER_KEY); else localStorage.setItem(REMEMBER_KEY, "0"); } catch { /* storage blocked */ }
}

/** Storage given to the Supabase client. Reads either place; writes only to the chosen one. */
export const authStorage = {
  getItem(key: string): string | null {
    try { const s = sessionStorage.getItem(key); if (s != null) return s; } catch { /* blocked */ }
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem(key: string, value: string) {
    const keep = rememberThisDevice();
    try { (keep ? localStorage : sessionStorage).setItem(key, value); } catch { /* storage full or blocked */ }
    try { (keep ? sessionStorage : localStorage).removeItem(key); } catch { /* blocked */ }
  },
  removeItem(key: string) {
    try { localStorage.removeItem(key); } catch { /* blocked */ }
    try { sessionStorage.removeItem(key); } catch { /* blocked */ }
  },
};

/** True when this device holds a business sign-in (it may still need a quiet refresh). */
export function hasSavedSignIn(): boolean {
  const raw = authStorage.getItem(AUTH_KEY);
  if (!raw) return false;
  try { const s = JSON.parse(raw); return !!(s?.refresh_token || s?.currentSession?.refresh_token); } catch { return false; }
}
