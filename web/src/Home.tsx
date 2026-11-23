import { useEffect, useRef, useState, type ReactNode } from "react";
import Logo from "./Logo";
import { hidePreloader } from "./preloader";
import "./home.css";
import { useBackLayer } from "./backStack";

/** Public homepage at "/". The app itself lives at "/app". */
const APP = "/app";
// Same key as the sign-in page, so the language picked here carries on into the app.
const LANG_KEY = "itaos-lang";
type Lang = "sw" | "en";
const PONDI_WA = "255626277027";
const PONDI_SITE = "https://ponditech.com";

/** Pilot: setup is done by Pondi, so the main button opens WhatsApp with Pondi.
 *  When Meta Business Verification is approved and Facebook login + WhatsApp signup work for any business,
 *  switch the main button back to APP ("Get started") and the "How it works" steps back to self-serve. */
const pilotLink = (lang: Lang) => `https://wa.me/${PONDI_WA}?text=${encodeURIComponent(lang === "sw"
  ? "Habari Pondi, ningependa kujiunga na majaribio ya itaOS kwa biashara yangu."
  : "Hi Pondi, I'd like to join the itaOS pilot for my business.")}`;

export default function Home() {
  const [menu, setMenu] = useState(false);
  useBackLayer(menu, () => setMenu(false)); // phone Back closes the menu
  const [lang, setLang] = useState<Lang>(() => {
    try { const v = localStorage.getItem(LANG_KEY); if (v === "sw" || v === "en") return v; } catch { /* storage unavailable */ }
    return "sw";
  });
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  // Language switch = curtain wipe (like the reference's intro): a green panel sweeps up over the page,
  // the language changes behind it, then the panel lifts off the top.
  const [curtain, setCurtain] = useState<{ phase: "idle" | "cover" | "reveal"; label: string }>({ phase: "idle", label: "" });
  const pick = (l: Lang) => {
    if (l === lang || curtain.phase !== "idle") return;
    try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setLang(l); return; }
    setMenu(false);
    setCurtain({ phase: "cover", label: l === "sw" ? "Kiswahili" : "English" });
    window.setTimeout(() => {
      setLang(l);
      window.setTimeout(() => setCurtain((c) => ({ ...c, phase: "reveal" })), 120);
      window.setTimeout(() => setCurtain({ phase: "idle", label: "" }), 120 + 700);
    }, 620);
  };

  useEffect(() => {
    hidePreloader();
    document.documentElement.classList.add("hp-page");
    return () => document.documentElement.classList.remove("hp-page");
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { document.body.style.overflow = menu ? "hidden" : ""; }, [menu]);

  // Video card: tilted back like ponditech.com when it comes into view, straightening as it scrolls up.
  const tiltRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tiltRef.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const run = () => {
      raf = 0;
      const vh = innerHeight, top = el.parentElement!.getBoundingClientRect().top;
      // 0 = fully tilted while the card's top is in the lower 30% of the screen; 1 = flat once it reaches 15%.
      const p = Math.min(1, Math.max(0, (vh * 0.7 - top) / (vh * 0.55)));
      el.style.transform = `rotateX(${(26 * (1 - p)).toFixed(2)}deg) scale(${(0.92 + 0.08 * p).toFixed(3)})`;
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(run); };
    run();
    addEventListener("scroll", on, { passive: true }); addEventListener("resize", on);
    return () => { removeEventListener("scroll", on); removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, []);

  // Content rises in as it scrolls into view (headings, cards, steps, questions).
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>(
      ".hp main section:not(.hp-hero) h2, .hp-feat-art, .hp-feat-txt, .hp-intro p, .hp-trust-grid > div, .hp-how li, .hp-q, .hp-proof-card, .hp-end .hp-pill"));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    els.forEach((el) => {
      const sib = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.matches(".hp-trust-grid > div, .hp-how li, .hp-q")).indexOf(el) : -1;
      if (sib > 0) el.style.transitionDelay = `${sib * 90}ms`;
      el.classList.add("rv"); io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  // Scroll-spy: the top-bar link for the section you're reading lights up, and a glass lens slides to it.
  const SPY = ["features", "how", "faq"] as const;
  const [active, setActive] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let raf = 0;
    const run = () => {
      raf = 0;
      const line = innerHeight * 0.35;
      let cur: string | null = null;
      for (const id of SPY) {
        const r = document.getElementById(id)?.getBoundingClientRect();
        if (r && r.top <= line && r.bottom > line) cur = id;
      }
      // At the very bottom, the last section (Questions) counts as current.
      if (!cur && innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = "faq";
      setActive(cur);
      setScrolled(scrollY > 12);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(run); };
    run();
    addEventListener("scroll", on, { passive: true }); addEventListener("resize", on);
    return () => { removeEventListener("scroll", on); removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, []);
  const navRef = useRef<HTMLElement>(null);
  const [lens, setLens] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const place = () => {
      const a = active && navRef.current?.querySelector<HTMLElement>(`a[href="#${active}"]`);
      setLens(a ? { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight } : null);
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  }, [active, lang]);
  const spyLink = (id: string) => (active === id ? { className: "on", "aria-current": "location" as const } : {});

  const go = () => setMenu(false);
  const pilot = pilotLink(lang);
  const Lang = ({ dark }: { dark?: boolean }) => (
    <div className={"hp-lang" + (dark ? " dark" : "") + (lang === "en" ? " is-en" : "")} role="group" aria-label="Language">
      <span className="hp-lang-thumb" aria-hidden="true" />
      <button className={lang === "sw" ? "on" : ""} onClick={() => pick("sw")} aria-pressed={lang === "sw"}>SW</button>
      <button className={lang === "en" ? "on" : ""} onClick={() => pick("en")} aria-pressed={lang === "en"}>EN</button>
    </div>
  );

  return (
    <div className={"hp" + (menu ? " menu-open" : "")}>
      <div className={"hp-curtain " + curtain.phase} aria-hidden="true">
        <div className="hp-curtain-in"><Logo size={44} /><span>{curtain.label}</span></div>
      </div>
      <header className={"hp-bar" + (scrolled ? " scrolled" : "")}>
        <div className="hp-w hp-bar-in">
          <a href="/" className="hp-logo" aria-label="itaOS home"><Logo size={30} /><span>itaOS</span></a>
          <nav className="hp-nav" aria-label="Main" ref={navRef}>
            <span className={"hp-nav-lens" + (lens ? " on" : "")} aria-hidden="true"
              style={lens ? { transform: `translate(${lens.x}px, ${lens.y}px)`, width: lens.w, height: lens.h } : undefined} />
            <a href="#features" {...spyLink("features")}>{T("Features", "Huduma")}</a>
            <a href="#how" {...spyLink("how")}>{T("How it works", "Inavyofanya kazi")}</a>
            <a href="#faq" {...spyLink("faq")}>{T("Questions", "Maswali")}</a>
            <Lang />
            <a href={APP}>{T("Log in", "Ingia")}</a>
            <a href={pilot} className="hp-pill hp-pill-sm" target="_blank" rel="noopener">{T("Join the pilot", "Jiunge na majaribio")}</a>
          </nav>
          <button className="hp-burger" onClick={() => setMenu(true)} aria-label={T("Open menu", "Fungua menyu")}><span /><span /></button>
        </div>
      </header>

      {/* Full-screen mobile menu */}
      <div className={"hp-menu" + (menu ? " open" : "")} aria-hidden={!menu}>
        <div className="hp-w hp-bar-in">
          <a href="/" className="hp-logo" onClick={go}><Logo size={30} /><span>itaOS</span></a>
          <button className="hp-x" onClick={go} aria-label={T("Close menu", "Funga menyu")}>✕</button>
        </div>
        <nav>
          <a href="/" onClick={go}>{T("Home", "Mwanzo")}</a>
          <a href="#features" onClick={go} {...spyLink("features")}>{T("Features", "Huduma")}</a>
          <a href="#how" onClick={go} {...spyLink("how")}>{T("How it works", "Inavyofanya kazi")}</a>
          <a href="#faq" onClick={go} {...spyLink("faq")}>{T("Questions", "Maswali")}</a>
          <a href={APP}>{T("Log in", "Ingia")}</a>
          <a href={pilot} target="_blank" rel="noopener">{T("Join the pilot", "Jiunge na majaribio")}</a>
          <div className="hp-menu-lang"><Lang dark /></div>
        </nav>
      </div>

      <main>
        {/* HERO */}
        <section className="hp-hero">
          <div className="hp-w hp-hero-in">
            <div className="hp-hero-txt">
              <h1>{lang === "sw" ? <>Jua matangazo yapi <u>kweli</u> yanakuletea pesa</> : <>Know which ads <u>actually</u> make you money</>}</h1>
              <p>{T("Your ads bring chats on WhatsApp. itaOS shows you which of those chats became paying customers, and which ad brought them.",
                "Matangazo yako yanaleta chat WhatsApp. itaOS inakuonyesha chat zipi zimekuwa wateja waliolipa, na tangazo gani liliwaleta.")}</p>
              <div className="hp-hero-cta">
                <a href={pilot} className="hp-pill" target="_blank" rel="noopener">{T("Join the pilot", "Jiunge na majaribio")} <span aria-hidden="true">→</span></a>
                <a href={APP} className="hp-ghost">{T("Log in", "Ingia")}</a>
              </div>
              <small>{T("Works in Kiswahili and English · We set it up with you", "Kwa Kiswahili na Kiingereza · Tunakuunganishia sisi")}</small>
            </div>

            <div className="hp-hero-art" aria-hidden="true">
              <Phone>
                <div className="ph-top"><b>Mama Neema</b><span>online</span></div>
                <div className="ph-tag">{T("From ad", "Kutoka tangazo")} · <b>Offer ya Wiki</b></div>
                <div className="ph-b in">Habari, bei ya hii ni ngapi?</div>
                <div className="ph-b out">Ni TSh 35,000. Unataka ngapi?</div>
                <div className="ph-b in">Nitachukua mbili 🙏</div>
                <div className="ph-b out">Sawa, Lipa namba: 5XXXXX</div>
                <div className="ph-b in">Nimetuma ✅</div>
              </Phone>
              <div className="hp-float f1"><span className="dot g" />{T("Paid", "Amelipa")} · <b>TSh 70,000</b></div>
              <div className="hp-float f2"><span className="dot y" />Kito: <b>{T("Lipa namba sent", "Lipa namba imetumwa")}</b></div>
              <div className="hp-float f3">{T("Ad → Sale", "Tangazo → Mauzo")}<b>{T("3 days", "Siku 3")}</b></div>
            </div>
          </div>
        </section>

        {/* VIDEO — on the white page, tilted back like ponditech.com and straightening as it scrolls in */}
        <section className="hp-video">
          <div className="hp-w">
            <div className="hp-stage">
              <div className="hp-video-card" ref={tiltRef}>
                <video autoPlay muted loop playsInline preload="metadata" poster="/video/itaos-kinetic-poster.jpg"
                  aria-label={T("itaOS in 18 seconds: customers see your ad, message you on WhatsApp and pay with Lipa namba. itaOS shows which ad made the sale.",
                    "itaOS kwa sekunde 18: wateja wanaona tangazo lako, wanakutumia ujumbe WhatsApp na kulipa kwa Lipa namba. itaOS inaonyesha tangazo gani lilileta mauzo.")}>
                  <source src="/video/itaos-kinetic.webm" type="video/webm" />
                  <source src="/video/itaos-kinetic.mp4" type="video/mp4" />
                </video>
              </div>
            </div>
          </div>
        </section>

        {/* REAL RESULT — Kayani Herbs (pilot business), 19 Nov 2026, figures read from the itaOS database; shown with Kayani's permission */}
        <section className="hp-proof">
          <div className="hp-w">
            <div className="hp-proof-card">
              <div className="hp-proof-l">
                <span className="hp-proof-k"><i aria-hidden="true" />{T("Real result", "Matokeo halisi")} · Kayani Herbs</span>
                <h2>{lang === "sw"
                  ? <>Siku moja. <em>TSh 69,000</em> za matangazo zilileta <em>TSh 375,000</em> za mauzo.</>
                  : <>One day. <em>TSh 69,000</em> in ads brought <em>TSh 375,000</em> in sales.</>}</h2>
                <p>{T("Thursday 19 November 2026, read straight from Kayani Herbs' itaOS dashboard and shared with their permission.",
                  "Alhamisi 19 Novemba 2026, kutoka moja kwa moja kwenye dashibodi ya itaOS ya Kayani Herbs, kwa ruhusa yao.")}</p>
                <div className="hp-proof-badge"><b><Count to={5.4} decimals={1} />×</b><span>{T("back for every shilling spent on ads that day", "zilirudi kwa kila shilingi iliyotumika kwenye matangazo siku hiyo")}</span></div>
              </div>
              <ol className="hp-flow" aria-label={T("From ad to payment", "Kutoka tangazo hadi malipo")}>
                <li><span className="hp-flow-dot" /><div><small>{T("Spent on Facebook ads", "Matumizi ya matangazo ya Facebook")}</small><b>TSh <Count to={69000} /></b></div></li>
                <li><span className="hp-flow-dot" /><div><small>{T("New WhatsApp chats from those ads", "Chat mpya za WhatsApp kutoka matangazo hayo")}</small><b><Count to={60} /></b></div></li>
                <li><span className="hp-flow-dot" /><div><small>{T("Customers from the ads who paid", "Wateja wa matangazo waliolipa")}</small><b><Count to={2} /></b></div></li>
                <li className="win"><span className="hp-flow-dot" /><div><small>{T("Paid by those customers", "Walicholipa wateja hao")}</small><b>TSh <Count to={375000} /></b></div></li>
              </ol>
            </div>
            <p className="hp-proof-n">{T("One day's figures. Results differ from day to day and from business to business.", "Takwimu za siku moja. Matokeo yanatofautiana kila siku na kila biashara.")}</p>
          </div>
        </section>

        {/* INTRO */}
        <section className="hp-intro">
          <div className="hp-w">
            <h2>{T("Built for businesses that sell on WhatsApp", "Imetengenezwa kwa biashara zinazouza kupitia WhatsApp")} 🇹🇿</h2>
            <p>{T("If your customers find you through Facebook and Instagram ads, then talk to you on WhatsApp before they pay, itaOS was made for you.",
              "Kama wateja wako wanakupata kupitia matangazo ya Facebook na Instagram, kisha wanaongea nawe WhatsApp kabla ya kulipa, itaOS imetengenezwa kwa ajili yako.")}</p>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="hp-feats">
          <Feature
            tone="mint"
            title={T("See which ad brought each customer", "Ona tangazo gani lilileta kila mteja")}
            text={T("Every chat that starts from an ad is linked back to that ad. So instead of just seeing clicks, you see real sales and what each sale cost you.",
              "Kila chat inayoanzia kwenye tangazo inaunganishwa na tangazo hilo. Badala ya kuona clicks tu, unaona mauzo halisi na kila mauzo yamekugharimu kiasi gani.")}
            art={
              <div className="hp-card-stack">
                <AdRow name="Offer ya Wiki" chats="214" paid="38" good T={T} />
                <AdRow name="Video ya Mteja" chats="131" paid="21" good T={T} />
                <AdRow name="Picha ya Bidhaa" chats="96" paid="4" T={T} />
              </div>
            }
          />
          <Feature
            flip
            tone="butter"
            title={T("Kito reads your chats, so you don't have to", "Kito anasoma chat zako, wewe huna haja")}
            text={T("Kito, our AI assistant, goes through your WhatsApp chats in the background and marks each customer: asked the price, got your Lipa namba, paid, or went quiet.",
              "Kito, msaidizi wetu wa AI, anapitia chat zako za WhatsApp kimya kimya na kumwekea kila mteja alama: ameuliza bei, amepata Lipa namba, amelipa, au amenyamaza.")}
            art={
              <Phone>
                <div className="ph-top"><b>Chats</b><span>{T("today", "leo")}</span></div>
                <ChatRow n="Juma K." m="Nimetuma pesa" t={T("Paid", "Amelipa")} c="g" />
                <ChatRow n="Asha M." m="Ngoja kidogo..." t={T("Lipa namba sent", "Lipa namba imetumwa")} c="y" />
                <ChatRow n="Peter" m="Bei gani?" t={T("Asked price", "Ameuliza bei")} c="b" />
                <ChatRow n="Neema S." m="Asante, nitarudi" t={T("Went quiet", "Amenyamaza")} c="r" />
                <ChatRow n="Hamisi" m="Mko wapi?" t={T("Asked location", "Ameuliza mahali")} c="b" />
              </Phone>
            }
          />
          <Feature
            tone="blush"
            title={T("Know who to follow up with today", "Jua nani wa kumfuatilia leo")}
            text={T("Customers who got your Lipa namba but never paid are money left on the table. itaOS lists them for you, with a reply already written. You decide what to send.",
              "Wateja waliopata Lipa namba yako lakini hawakulipa ni pesa iliyoachwa mezani. itaOS inakuorodheshea, pamoja na jibu lililoandikwa tayari. Wewe ndiye unaamua nini cha kutuma.")}
            art={
              <div className="hp-card-stack">
                <div className="hp-fu-h">{T("Follow up today", "Fuatilia leo")} <span>14</span></div>
                <FollowUp n="Asha M." d={T("Lipa namba sent 2 days ago", "Lipa namba imetumwa siku 2 zilizopita")} btn={T("Reply", "Jibu")} />
                <FollowUp n="Baraka J." d={T("Asked for delivery to Arusha", "Ameuliza usafirishaji Arusha")} btn={T("Reply", "Jibu")} />
                <FollowUp n="Rehema" d={T("Said she'll pay Friday", "Amesema atalipa Ijumaa")} btn={T("Reply", "Jibu")} />
              </div>
            }
          />
          <Feature
            flip
            tone="sky"
            title={T("Ask questions like you'd ask a person", "Uliza maswali kama unavyomuuliza mtu")}
            text={T("Ask Kito anything about your business in Kiswahili or English. It answers from your own numbers and takes you straight to the chats behind them.",
              "Muulize Kito chochote kuhusu biashara yako kwa Kiswahili au Kiingereza. Anajibu kutoka kwenye takwimu zako mwenyewe na kukupeleka moja kwa moja kwenye chat husika.")}
            art={
              <Phone>
                <div className="ph-top"><b>Kito</b><span>{T("AI assistant", "Msaidizi wa AI")}</span></div>
                <div className="ph-b out">Tangazo gani linaleta wateja wanaolipa?</div>
                <div className="ph-b in">"Offer ya Wiki" — wateja 38 wamelipa kutoka chats 214. Ni bora mara 3 kuliko "Picha ya Bidhaa".</div>
                <div className="ph-chip">Fungua chats 38 →</div>
              </Phone>
            }
          />
        </section>

        {/* TRUST */}
        <section className="hp-trust">
          <div className="hp-w">
            <h2>{T("Your data is safe", "Data yako iko salama")}</h2>
            <div className="hp-trust-grid">
              <div><b>{T("Kito only reads", "Kito anasoma tu")}</b><p>{T("Kito labels chats and answers your questions. It never changes your ads and never messages your customers.", "Kito anaweka alama kwenye chat na kujibu maswali yako. Habadilishi matangazo yako wala hawatumii wateja wako ujumbe.")}</p></div>
              <div><b>{T("You send the messages", "Wewe ndiye unatuma ujumbe")}</b><p>{T("Nothing goes to a customer unless you press send. Kito's replies are drafts for you to check.", "Hakuna kinachomfikia mteja mpaka ubonyeze tuma. Majibu ya Kito ni rasimu za wewe kukagua.")}</p></div>
              <div><b>{T("Never sold", "Haiuzwi kamwe")}</b><p>{T("We don't sell your data or your customers' data. Each business sees only its own chats and numbers.", "Hatuuzi data yako wala ya wateja wako. Kila biashara inaona chat na takwimu zake tu.")}</p></div>
              <div><b>{T("Yours to remove", "Unaweza kuifuta")}</b><p>{T("Disconnect any time and ask us to delete your data. We do it within 30 days.", "Unaweza kutenganisha wakati wowote na kutuomba tufute data yako. Tunafanya hivyo ndani ya siku 30.")}</p></div>
            </div>
          </div>
        </section>

        {/* MISSION */}
        <section id="mission" className="hp-mission">
          <div className="hp-w">
            <p className="hp-mission-k">{T("Our mission", "Lengo letu")}</p>
            <ScrollWords key={lang} mark={lang === "sw" ? "kweli" : "really"}
              text={T("Help every business in Tanzania see where its sales really come from.", "Kusaidia kila biashara Tanzania kuona mauzo yake kweli yanatoka wapi.")} />
            <p className="hp-mission-p">{T("Too many good businesses spend on ads and hope. We think you should know. itaOS is built in Dar es Salaam by ", "Biashara nyingi nzuri zinatumia pesa kwenye matangazo na kubahatisha. Tunaamini unastahili kujua. itaOS imetengenezwa Dar es Salaam na ")}
              <a href={PONDI_SITE} target="_blank" rel="noopener">Pondi Technologies</a>{T(", for the way people here actually buy.", ", kwa namna watu wa hapa wanavyonunua kweli.")}</p>
          </div>
        </section>

        {/* HOW (pilot: Pondi connects everything; see pilotLink above for when to switch back to self-serve) */}
        <section id="how" className="hp-how">
          <div className="hp-w">
            <h2>{T("We connect everything for you in one visit", "Tunakuunganishia kila kitu kwa ziara moja")}</h2>
            <ol>
              <li><b>1</b><div><h3>{T("Message us on WhatsApp", "Tutumie ujumbe WhatsApp")}</h3><p>{T("Tell us about your business and the ads you run.", "Tueleze kuhusu biashara yako na matangazo unayoendesha.")}</p></div></li>
              <li><b>2</b><div><h3>{T("We connect your WhatsApp and ads", "Tunaunganisha WhatsApp na matangazo yako")}</h3><p>{T("In one visit. Your number keeps working on your phone exactly as before.", "Kwa ziara moja. Namba yako inaendelea kufanya kazi kwenye simu yako kama kawaida.")}</p></div></li>
              <li><b>3</b><div><h3>{T("Watch the numbers come in", "Tazama takwimu zikiingia")}</h3><p>{T("Kito starts reading new chats and your dashboard fills up.", "Kito anaanza kusoma chat mpya na dashibodi yako inajaa.")}</p></div></li>
            </ol>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="hp-faq">
          <div className="hp-w">
            <h2>{T("Common questions", "Maswali ya kawaida")}</h2>
            <Faq q={T("Is my WhatsApp number safe?", "Je, namba yangu ya WhatsApp iko salama?")}
              a={T("Yes. It is connected through Meta's official WhatsApp Business setup, and it stays yours. You can disconnect it at any time.",
                "Ndiyo. Inaunganishwa kupitia mfumo rasmi wa Meta wa WhatsApp Business, na inabaki kuwa yako. Unaweza kuitenganisha wakati wowote.")} />
            <Faq q={T("Does it change how I use WhatsApp?", "Je, inabadilisha jinsi ninavyotumia WhatsApp?")}
              a={T("No. You and your team keep replying from the WhatsApp Business app on your phone. itaOS reads the chats in the background.",
                "Hapana. Wewe na timu yako mnaendelea kujibu kutoka app ya WhatsApp Business kwenye simu. itaOS inasoma chat kimya kimya.")} />
            <Faq q={T("What does it cost?", "Inagharimu kiasi gani?")}
              a={T("itaOS is in a private pilot. We agree the price with you in writing before you pay anything.",
                "itaOS iko kwenye majaribio. Tunakubaliana bei nawe kwa maandishi kabla hujalipa chochote.")} />
            <Faq q={T("Do I need to know computers?", "Je, ninahitaji kujua kompyuta?")}
              a={T("No. We set it up with you, and everything works on your phone in Kiswahili or English.",
                "Hapana. Tunakuwekea pamoja nawe, na kila kitu kinafanya kazi kwenye simu yako kwa Kiswahili au Kiingereza.")} />
          </div>
        </section>

        {/* CTA */}
        <section className="hp-end">
          <div className="hp-w">
            <h2>{T("Stop guessing. Start knowing.", "Acha kubahatisha. Anza kujua.")}</h2>
            <a href={pilot} className="hp-pill hp-pill-dark" target="_blank" rel="noopener">{T("Join the pilot", "Jiunge na majaribio")} <span aria-hidden="true">→</span></a>
          </div>
        </section>
      </main>

      {/* Footer — same layout as ponditech.com: brand + three link columns, big faded wordmark, company details row */}
      <footer className="hp-foot">
        <div className="hp-w">
          <div className="hp-foot-top">
            <div className="hp-foot-brand">
              <a href="/" className="hp-foot-logo" aria-label="itaOS home">
                <Logo size={30} />
                <span><b>itaOS</b><small>by Pondi Technologies</small></span>
              </a>
              <p className="hp-foot-tag">{T("Know which ads bring paying customers, ", "Jua matangazo yapi yanaleta wateja wanaolipa, ")}<em>{T("built in Dar es Salaam for businesses that sell on WhatsApp.", "imetengenezwa Dar es Salaam kwa biashara zinazouza WhatsApp.")}</em></p>
            </div>
            <nav className="hp-foot-col" aria-label={T("Product", "Bidhaa")}>
              <h4>{T("Product", "Bidhaa")}</h4>
              <a href="#features">{T("Features", "Huduma")}</a>
              <a href="#how">{T("How it works", "Inavyofanya kazi")}</a>
              <a href={pilot} target="_blank" rel="noopener">{T("Join the pilot", "Jiunge na majaribio")}</a>
              <a href={APP}>{T("Log in", "Ingia")}</a>
            </nav>
            <nav className="hp-foot-col" aria-label={T("Company", "Kampuni")}>
              <h4>{T("Company", "Kampuni")}</h4>
              <a href="#mission">{T("Our mission", "Lengo letu")}</a>
              <a href={PONDI_SITE} target="_blank" rel="noopener">Pondi Technologies</a>
              <a href={pilot} target="_blank" rel="noopener">{T("Contact", "Wasiliana nasi")}</a>
              <a href="#faq">{T("Questions", "Maswali")}</a>
            </nav>
            <nav className="hp-foot-col" aria-label={T("Legal", "Kisheria")}>
              <h4>{T("Legal", "Kisheria")}</h4>
              <a href="/privacy.html">{T("Privacy Policy", "Sera ya Faragha")}</a>
              <a href="/terms.html">{T("Terms of Service", "Masharti ya Huduma")}</a>
            </nav>
          </div>
          <div className="hp-foot-mark" aria-hidden="true">itaOS<i>.</i></div>
          <div className="hp-foot-bot">
            <p>© {new Date().getFullYear()} {T("itaOS by ", "itaOS na ")}<a href={PONDI_SITE} target="_blank" rel="noopener">Pondi Technologies</a>. {T("All rights reserved.", "Haki zote zimehifadhiwa.")}</p>
            <p>BRELA Reg. No. 723134 · Kinondoni, Dar es Salaam 14110, Tanzania · <a href={`https://wa.me/${PONDI_WA}`} target="_blank" rel="noopener">+255 626 277 027</a></p>
          </div>
        </div>
      </footer>

      <a className="hp-wa" href={pilot} target="_blank" rel="noopener" aria-label={T("Message Pondi on WhatsApp", "Tuma ujumbe kwa Pondi WhatsApp")}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z" /></svg>
      </a>
    </div>
  );
}

function Phone({ children }: { children: ReactNode }) {
  return <div className="ph"><div className="ph-notch" /><div className="ph-scr">{children}</div></div>;
}

function Feature({ title, text, art, tone, flip }: { title: string; text: string; art: ReactNode; tone: string; flip?: boolean }) {
  return (
    <div className={"hp-feat" + (flip ? " flip" : "")}>
      <div className="hp-w hp-feat-in">
        <div className={"hp-feat-art " + tone}>{art}</div>
        <div className="hp-feat-txt"><h2>{title}</h2><p>{text}</p></div>
      </div>
    </div>
  );
}

function AdRow({ name, chats, paid, good, T }: { name: string; chats: string; paid: string; good?: boolean; T: (en: string, sw: string) => string }) {
  return (
    <div className="hp-ad">
      <div className="hp-ad-thumb" />
      <div className="hp-ad-n"><b>{name}</b><span>{chats} chats</span></div>
      <div className={"hp-ad-p" + (good ? " good" : "")}>{T(`${paid} paid`, `${paid} wamelipa`)}</div>
    </div>
  );
}

function ChatRow({ n, m, t, c }: { n: string; m: string; t: string; c: string }) {
  return (
    <div className="ph-row">
      <div className="ph-av">{n[0]}</div>
      <div className="ph-row-t"><b>{n}</b><span>{m}</span></div>
      <i className={"ph-lab " + c}>{t}</i>
    </div>
  );
}

function FollowUp({ n, d, btn }: { n: string; d: string; btn: string }) {
  return (
    <div className="hp-fu">
      <div className="ph-av">{n[0]}</div>
      <div className="hp-fu-t"><b>{n}</b><span>{d}</span></div>
      <span className="hp-fu-btn">{btn}</span>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="hp-q">
      <summary>{q}<span aria-hidden="true">+</span></summary>
      <p>{a}</p>
    </details>
  );
}

/** A number that counts up once it scrolls into view. */
function Count({ to, decimals = 0 }: { to: number; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) { el.textContent = fmt(to); return; }
    el.textContent = fmt(0);
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now(), dur = 1300;
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / dur), v = to * (1 - Math.pow(1 - k, 3));
        el.textContent = fmt(decimals ? v : Math.round(v));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, decimals]);
  return <span ref={ref} className="num">{fmt(to)}</span>;
}

/** A sentence whose words light up one by one as it scrolls through the screen (the reference's dim-to-bright line). */
function ScrollWords({ text, mark }: { text: string; mark?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const words = text.split(" ");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const spans = Array.from(el.querySelectorAll<HTMLSpanElement>("span.w"));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { spans.forEach((s) => s.classList.add("lit")); return; }
    let raf = 0;
    const run = () => {
      raf = 0;
      const r = el.getBoundingClientRect(), vh = innerHeight;
      // starts lighting when the line's middle is at 85% of the screen, fully lit at 45%
      const p = Math.min(1, Math.max(0, (vh * 0.85 - (r.top + r.height / 2)) / (vh * 0.4)));
      const n = Math.round(p * spans.length);
      spans.forEach((s, i) => s.classList.toggle("lit", i < n));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(run); };
    run();
    addEventListener("scroll", on, { passive: true }); addEventListener("resize", on);
    return () => { removeEventListener("scroll", on); removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, [text]);
  return (
    <h2 ref={ref} className="hp-words" aria-label={text}>
      {words.map((w, i) => <span key={i} aria-hidden="true" className={"w" + (mark && w.replace(/[.,]/g, "") === mark ? " mark" : "")}>{w}{i < words.length - 1 ? " " : ""}</span>)}
    </h2>
  );
}
