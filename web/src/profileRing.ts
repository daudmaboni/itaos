// The ring around the owner's picture in the top bar (ProfileMenu.tsx). Pure, so it's tested.
export type RingIn = { payRed: number; payAmber: number; waiting: number; overdue: number; broken: number };
export type Ring = { tone: "green" | "amber" | "red" | "none"; count: number; badge: string | null };

export function ringOf(x: RingIn | null): Ring {
  if (!x) return { tone: "none", count: 0, badge: null };
  if (x.payRed > 0 || x.broken > 0) return { tone: "red", count: x.payRed + x.broken, badge: "!" };
  const count = x.waiting + x.overdue + x.payAmber;
  if (count > 0) return { tone: "amber", count, badge: count > 99 ? "99+" : String(count) };
  return { tone: "green", count: 0, badge: null };
}
