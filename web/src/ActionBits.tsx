// Small pieces shared by the Actions tabs so every tab looks the same: Promises-style cards for things to do,
// and Buyers-style rows for things already done.
import { initials as ini, hue } from "./Buyers";

export const avaText = (name: string | null | undefined) => ini(name ?? "") || "?";

/** One finished item, laid out like a row on the Buyers page. */
export function DoneRow({ seed, name, sub, href, right, chips }: { seed: string; name: string; sub: string; href: string; right?: React.ReactNode; chips?: React.ReactNode }) {
  return (
    <div className="by-item">
      <a className="by-row" href={href}>
        <span className="by-av" style={{ ["--h" as any]: hue(seed) }} aria-hidden>{avaText(name)}</span>
        <span className="by-main">
          <span className="by-name"><b>{name}</b></span>
          <span className="by-phone">{sub}</span>
        </span>
        <span className="by-money">{right}</span>
        {chips && <span className="by-prods">{chips}</span>}
      </a>
    </div>
  );
}
