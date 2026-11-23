// Plain-words errors (23 Nov 2026), after The Glide Studio's "Something went wrong. Where?":
// point at the fix, in words the owner understands. Database / network / function errors used to reach
// the screen as raw English tech text ("permission denied for table orders", "Failed to fetch", …).
// errText() turns the common ones into plain Kiswahili or English (following the business's language)
// that say what to do next. A message that already reads like a sentence (one of our own) passes through.

const sw = () => (typeof document !== "undefined" && document.documentElement.lang === "sw");
const T = (en: string, s: string) => (sw() ? s : en);

type ErrLike = { message?: string; code?: string } | string | null | undefined | unknown;

export function errText(e: ErrLike): string {
  const msg = typeof e === "string" ? e : String((e as { message?: string })?.message ?? "");
  const code = typeof e === "object" && e ? String((e as { code?: string }).code ?? "") : "";

  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed|ERR_INTERNET/i.test(msg))
    return T("No internet connection. Check your connection and try again.", "Hakuna mtandao. Angalia intaneti yako kisha jaribu tena.");
  if (/jwt expired|invalid jwt|refresh token|not signed in|auth session missing/i.test(msg))
    return T("You've been signed out. Log in again, then try once more.", "Umetoka kwenye akaunti. Ingia tena, kisha jaribu tena.");
  if (code === "42501" || /permission denied|row-level security|violates row-level/i.test(msg))
    return T("You don't have permission for this. Ask the business owner or an admin.", "Huna ruhusa ya kufanya hili. Muulize mmiliki wa biashara au admin.");
  if (code === "42883" || code === "PGRST202" || /function .* does not exist|schema cache|could not find the|column .* does not exist|relation .* does not exist/i.test(msg))
    return T("This needs the latest itaOS update. Try again in a few minutes.", "Hii inahitaji sasisho jipya la itaOS. Jaribu tena baada ya dakika chache.");
  if (code === "23505" || /duplicate key value/i.test(msg))
    return T("This is already saved. Check the list before adding it again.", "Hii tayari imehifadhiwa. Angalia orodha kabla ya kuongeza tena.");
  if (code === "57014" || /statement timeout|gateway timeout|request timed out/i.test(msg))
    return T("That took too long. Try again in a moment.", "Imechukua muda mrefu sana. Jaribu tena baada ya muda mfupi.");
  if (code === "23502" || /null value in column/i.test(msg))
    return T("Something required is missing. Fill in every field and try again.", "Kuna kitu kinachohitajika hakijajazwa. Jaza kila sehemu kisha jaribu tena.");
  if (code === "22P02" || code === "22003" || /invalid input syntax|out of range|numeric field overflow/i.test(msg))
    return T("One of the numbers or dates isn't right. Check what you typed and try again.", "Namba au tarehe moja si sahihi. Angalia ulichoandika kisha jaribu tena.");
  if (code === "23503" || /foreign key|check constraint|violates .* constraint/i.test(msg))
    return T("This can't be saved as it is. Refresh the page and try again.", "Hii haiwezi kuhifadhiwa hivi. Onyesha upya ukurasa kisha jaribu tena.");
  if (/rate limit|too many requests|\b429\b/i.test(msg))
    return T("Too many tries at once. Wait a minute and try again.", "Majaribio mengi kwa wakati mmoja. Subiri dakika moja kisha jaribu tena.");
  if (/non-2xx|edge function|internal server error|\b50[0234]\b|unexpected token|is not valid json/i.test(msg) || !msg.trim())
    return T("Something went wrong on our side. Try again; if it keeps happening, tell Pondi at hello@ponditech.com.",
      "Kuna tatizo upande wetu. Jaribu tena; likiendelea, tuambie Pondi kupitia hello@ponditech.com.");
  return msg; // already a sentence written for people
}
