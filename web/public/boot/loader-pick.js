/* Pick one of the itaOS loading animations at random (never the same one twice in a row). Add ?loader=N to the URL to force one. */
  (function () {
const I = "M18.75 0.0H85.9375V-206.25H18.75ZM52.1484375 -226.3671875C73.828125 -226.3671875 89.2578125 -240.625 89.2578125 -260.3515625C89.2578125 -280.078125 73.828125 -294.140625 52.1484375 -294.140625C30.6640625 -294.140625 15.234375 -280.078125 15.234375 -260.3515625C15.234375 -240.625 30.6640625 -226.3671875 52.1484375 -226.3671875Z";
const T = "M235.3203125 -206.25H192.9375V-262.5H125.5546875V-206.25H90.3984375V-154.296875H125.5546875V-58.0078125C125.5546875 -17.96875 147.8203125 0.0 197.234375 0.0H235.3203125V-51.953125H212.078125C197.0390625 -51.953125 192.9375 -56.0546875 192.9375 -69.3359375V-154.296875H235.3203125Z";
const A = "M307.359375 3.515625C336.4609375 3.515625 355.015625 -6.640625 367.3203125 -28.90625H368.1015625V0.0H433.7265625V-138.8671875C433.7265625 -184.375 400.71875 -210.7421875 340.7578125 -210.7421875C280.9921875 -210.7421875 247.203125 -184.1796875 244.2734375 -139.453125H306.7734375C308.140625 -153.515625 319.6640625 -162.5 338.4140625 -162.5C356.1875 -162.5 367.125 -154.1015625 367.125 -141.796875V-140.8203125C367.125 -128.515625 353.6484375 -125.5859375 316.734375 -122.4609375C272.7890625 -118.9453125 236.65625 -103.90625 236.65625 -57.6171875C236.65625 -16.6015625 266.1484375 3.515625 307.359375 3.515625ZM327.8671875 -40.4296875C311.4609375 -40.4296875 300.328125 -48.046875 300.328125 -60.7421875C300.328125 -74.21875 313.21875 -81.640625 331.1875 -84.375C347.7890625 -87.109375 360.484375 -89.6484375 367.7109375 -92.96875V-74.21875C367.7109375 -53.90625 350.328125 -40.4296875 327.8671875 -40.4296875Z";
const TILE = 'x="8" y="8" width="1008" height="1008" rx="224"';


const STEM = "M18.75 0.0H85.9375V-206.25H18.75Z";
function kick(cls) {
  return `<svg class="mark ${cls}" viewBox="0 0 1024 1024" aria-hidden="true"><rect class="tile" ${TILE}/>
    <g transform="translate(182 624)"><path class="l" d="${STEM}"/><path class="l" d="${T}"/><path class="l" d="${A}"/></g>
    <circle class="burst" cx="234.2" cy="363.7" r="40"/>${cls === "kB" ? '<circle class="burst burst2" cx="234.2" cy="363.7" r="40"/>' : ""}
    <g class="orb orbY"><circle class="inner y fgdot" cx="234.2" cy="363.7" r="35.5"/></g>
    <g class="orb orbX"><circle class="inner x dot" cx="712" cy="586" r="52"/></g></svg>`;
}
function mark(n, uid) { if (n === 4) return kick("kA"); if (n === 21) return kick("kB"); if (n > 10) return mark2(n, uid); return markA(n, uid); }
function markA(n, uid) {
  const extraBack = n === 3 ? `<rect class="fx halo" ${TILE}/>` : "";
  const extraFront =
    n === 5 ? `<g clip-path="url(#clip${uid})"><rect class="sheen" x="0" y="-100" width="220" height="1224" fill="url(#sh${uid})"/></g>` :
    n === 8 ? `<rect class="track" x="197" y="690" width="567" height="22" rx="11"/><rect class="bar" x="197" y="690" width="567" height="22" rx="11"/>` :
    n === 9 ? `<circle class="fx ring" cx="712" cy="586" r="52"/><circle class="fx ring ring2" cx="712" cy="586" r="52"/><circle class="fx ring ring3" cx="712" cy="586" r="52"/>` :
    n === 10 ? `<rect class="fx trace" ${TILE} pathLength="1"/>` : "";
  const defs = n === 5 ? `<defs><clipPath id="clip${uid}"><rect ${TILE}/></clipPath>
      <linearGradient id="sh${uid}" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` : "";
  const pl = n === 6 ? ' pathLength="1"' : "";
  return `<svg class="mark" viewBox="0 0 1024 1024" aria-hidden="true">${defs}
    ${extraBack}<g class="tilegrp"><rect class="tile" ${TILE}/></g>
    <g transform="translate(182 624)"><path class="l li" d="${I}"${pl}/><path class="l lt" d="${T}"${pl}/><path class="l la" d="${A}"${pl}/></g>
    ${n === 9 ? extraFront : ""}<g class="dotwrap"><circle class="dot" cx="712" cy="586" r="52"/></g>${n !== 9 ? extraFront : ""}
  </svg>`;
}

const WORD = (cls = "", pl = "") => `<g transform="translate(182 624)"><path class="l li ${cls}" d="${I}"${pl}/><path class="l lt ${cls}" d="${T}"${pl}/><path class="l la ${cls}" d="${A}"${pl}/></g>`;
const DOT = `<circle class="dot" cx="712" cy="586" r="52"/>`;
const WAVE = "M-1024 0 Q -768 -70 -512 0 T 0 0 T 512 0 T 1024 0 T 1536 0 T 2048 0 V 1300 H -1024 Z";
const svg = (inner, extra = "", vb = "0 0 1024 1024") => `<svg class="mark ${extra}" viewBox="${vb}" aria-hidden="true">${inner}</svg>`;
function mark2(n, u) {
  const tile = `<rect class="tile" ${TILE}/>`;
  switch (n) {
    case 11: return svg(`<defs><clipPath id="sp${u}"><circle class="spot" cx="712" cy="586" r="1250"/></clipPath></defs>
      <g clip-path="url(#sp${u})">${tile}${WORD()}</g>${DOT}`);
    case 12: return svg(`${tile}<g class="gl g1">${WORD()}</g><g class="gl g2">${WORD()}</g><g class="gm">${WORD()}${DOT}</g>`);
    case 13: return svg(`${tile}${WORD()}<g class="blink"><rect class="caret" x="200" y="330" width="26" height="296" rx="8"/></g>${DOT}`);
    case 14: return svg(`<defs><mask id="lq${u}"><g class="rise"><path class="wave" d="${WAVE}" fill="#fff"/></g></mask></defs>
      ${tile}${WORD()}${DOT}
      <g mask="url(#lq${u})"><rect ${TILE} style="fill:var(--t-dot)"/><g transform="translate(182 624)" style="fill:var(--t-bg)"><path d="${I}"/><path d="${T}"/><path d="${A}"/></g><circle cx="712" cy="586" r="52" style="fill:var(--t-bg)"/></g>`);
    case 15: return svg(`${tile}<g class="lw">${WORD()}</g><circle class="m m1" cx="712" cy="586" r="52"/><circle class="m m2" cx="712" cy="586" r="52"/><circle class="m m3" cx="712" cy="586" r="52"/>`);
    case 16: return svg(`<defs><filter id="gw${u}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16" result="b"/><feFlood style="flood-color:var(--t-dot)" flood-opacity=".9"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${tile}<g filter="url(#gw${u})">${WORD()}${DOT}</g>`);
    case 17: return svg(`<defs><g id="ct${u}"><rect ${TILE} style="fill:var(--t-bg);stroke:var(--t-edge);stroke-width:16"/><g transform="translate(182 624)" style="fill:var(--t-fg)"><path d="${I}"/><path d="${T}"/><path d="${A}"/></g><circle cx="712" cy="586" r="52" style="fill:var(--t-dot)"/></g>
      <clipPath id="k1${u}"><rect x="0" y="0" width="512" height="512"/></clipPath><clipPath id="k2${u}"><rect x="512" y="0" width="512" height="512"/></clipPath>
      <clipPath id="k3${u}"><rect x="0" y="512" width="512" height="512"/></clipPath><clipPath id="k4${u}"><rect x="512" y="512" width="512" height="512"/></clipPath></defs>
      <g class="q q1"><use href="#ct${u}" clip-path="url(#k1${u})"/></g><g class="q q2"><use href="#ct${u}" clip-path="url(#k2${u})"/></g>
      <g class="q q3"><use href="#ct${u}" clip-path="url(#k3${u})"/></g><g class="q q4"><use href="#ct${u}" clip-path="url(#k4${u})"/></g>`);
    case 18: {
      const card = (c, st) => `<svg class="mark ${c}" style="${st}" viewBox="0 0 1024 1024" aria-hidden="true">${tile}${WORD()}${DOT}</svg>`;
      return `<div class="deck">${card("c3", "--t-bg:#0f7a4f;--t-fg:#ffffff;--t-dot:#ffffff;--t-edge:#0f7a4f")}${card("c2", "--t-bg:#ffffff;--t-fg:#121417;--t-dot:#0f7a4f;--t-edge:#e6e8ec")}${card("c1", "--t-bg:#121417;--t-fg:#ffffff;--t-dot:#0f7a4f;--t-edge:#2a2d33")}</div>`;
    }
    case 19: return svg(`${tile}${WORD()}${DOT}`);
    case 20: {
      const wm = svg(`${WORD()}${DOT}`, "wm", "190 318 590 330");
      return `<div class="mq"><div class="track">${wm.repeat(16)}</div></div>`;
    }
  }
}

    var POOL = [1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13, 14, 15, 17, 18, 19, 21];
    var n, last = 0, forced = parseInt((location.search.match(/[?&]loader=(\d+)/) || [])[1], 10);
    var stage = document.getElementById("pl-stage");
    // First screen: the homepage, or the first page of this visit, gets the liquid ita. loader. ?loader=liquid forces it.
    var inApp = /^\/app(\/|$)/.test(location.pathname), seen = false;
    try { seen = sessionStorage.getItem("itaos-seen") === "1"; sessionStorage.setItem("itaos-seen", "1"); } catch (e) {}
    if (/[?&]loader=liquid\b/.test(location.search) || (POOL.indexOf(forced) < 0 && (!inApp || !seen))) {
      stage.className = "pl-stage pl-liquid";
      window.__plFormedAt = performance.now() + 2100; // worst case: font wait + pour; refined once it starts
      window.itaLiquid.ready().then(function () {
        if (!document.getElementById("preloader")) return;
        var h = window.itaLiquid.mount(stage, "ita", { offset: .8, times: [1.2, 2.2, 3.8, 4.8] });
        window.__plFormedAt = performance.now() + 1500; // the logo has formed by now
        window.__plStop = h.stop;
      });
      return;
    }
    try { last = +localStorage.getItem("itaos-loader-last") || 0; } catch (e) {}
    if (POOL.indexOf(forced) >= 0) n = forced;
    else { var pool = POOL.filter(function (x) { return x !== last; }); n = pool[Math.floor(Math.random() * pool.length)]; }
    try { localStorage.setItem("itaos-loader-last", String(n)); } catch (e) {}
    stage.className = "pl-stage a" + n;
    stage.innerHTML = mark(n, "pl");
  })();
