// Meta ad-policy check for ad text Claude writes (pure, no imports, so tests can load it).
// A guardrail, not a guarantee: Meta still reviews every ad. Each hit becomes a plain warning
// the owner sees before creating the ad. Swahili and English.

type Rule = { re: RegExp; why: string };

const RULES: Rule[] = [
  { re: /\b(tibu|inatibu|kutibu|inatibia|tiba|ponya|inaponya|kuponya|huponya|maliza kabisa|ondoa kabisa)\w*/i, why: "Says the product treats or cures something. Meta rejects health cure claims." },
  { re: /\b(cure[sd]?|heal[sd]?|treat(s|ment)?|remed(y|ies)|prevent[s]?)\b/i, why: "Says the product treats or cures something. Meta rejects health cure claims." },
  { re: /\b(dawa ya|badala ya dawa|acha dawa|replace[sd]? (your )?medicine)/i, why: "Presents the product as medicine or a replacement for medicine." },
  { re: /\b(je,? una|unasumbuliwa|unateseka|unaugua|una tatizo|do you (have|suffer)|are you suffering|struggling with)\b/i, why: "Asks the viewer about their own health problem. Meta's personal-attributes rule bans this." },
  { re: /\b(kabla na baada|before and after|before\/after)\b/i, why: "Before/after framing is not allowed for health products." },
  { re: /(100\s?%|\b(uhakika|hakika|guarantee[sd]?|bila shaka|matokeo ndani ya|results in \d+)\b)/i, why: "Promises a guaranteed result or a fixed time to results." },
  { re: /\b(nguvu za kiume|kuongeza uume|mapenzi|tendo la ndoa|sexual|erection|libido)\b/i, why: "Sexual-health wording. Meta restricts these ads heavily." },
  { re: /\b(kisukari|presha|shinikizo la damu|kansa|saratani|ukimwi|hiv|diabetes|cancer|hypertension)\b/i, why: "Names a disease. Ads must not link the product to a disease." },
  { re: /\b(daktari (amethibitisha|anapendekeza)|doctor[- ](approved|recommended)|clinically)\b/i, why: "Claims medical backing. Only allowed with real proof." },
];

/** Plain-language warnings for one ad (headline, text and WhatsApp greeting together). */
export function policyWarnings(...texts: (string | null | undefined)[]): string[] {
  const all = texts.filter(Boolean).join("\n");
  const out: string[] = [];
  for (const r of RULES) {
    const m = all.match(r.re);
    if (m && !out.some((w) => w.endsWith(r.why))) out.push(`"${m[0].trim()}": ${r.why}`);
  }
  return out;
}
