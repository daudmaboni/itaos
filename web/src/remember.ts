// A dropdown that remembers what you picked (Glide: "A dropdown should remember for you"), saved on this device.
import { useState } from "react";

export function useRemembered<T extends string>(key: string, init: T, ok?: (v: string) => boolean): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem("itaos-pick:" + key); if (s != null && (!ok || ok(s))) return s as T; } catch { /* storage blocked */ }
    return init;
  });
  const set = (x: T) => { setV(x); try { localStorage.setItem("itaos-pick:" + key, x); } catch { /* storage blocked */ } };
  return [v, set];
}
