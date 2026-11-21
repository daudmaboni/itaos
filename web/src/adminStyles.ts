// Staff admin styles (moved out of Admin.tsx, unchanged).


export const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&display=swap');
.ia{--navy:#16224A;--navy2:#22336B;--yellow:#F7C948;--paper:#F1F2F6;--card:#FFFFFF;--ink:#141B34;--muted:#5D6580;--faint:#8D93A8;--line:#E2E5EE;
  --ok:#178A55;--warn:#C46A0B;--bad:#C8372D;--info:#2C5A8C;--r-lg:18px;--r:12px;--r-sm:8px;
  --display:'Bricolage Grotesque',ui-sans-serif,system-ui,sans-serif;--ui:'Instrument Sans',ui-sans-serif,system-ui,sans-serif;
  display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100vh;background:var(--paper);color:var(--ink);font:14px/1.5 var(--ui);-webkit-font-smoothing:antialiased}
.ia *{box-sizing:border-box}.ia button{font:inherit;color:inherit;cursor:pointer}.ia button:disabled{cursor:default}
.ia :focus-visible{outline:2px solid var(--yellow);outline-offset:2px;border-radius:6px}
.ia h1,.ia h2,.ia h3{font-family:var(--display);margin:0;letter-spacing:-.01em}
.ia-faint{color:var(--faint)}.small{font-size:12.5px}.ia-ok{color:var(--ok);font-weight:600}.ia-bad{color:var(--bad)}
.ia-trunc{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ia-blank{grid-column:1/-1;max-width:420px;margin:18vh auto;text-align:center;color:var(--muted)}.ia-blank h2{font-size:26px;color:var(--ink);margin-bottom:8px}

/* sidebar */
.ia-side{background:var(--navy);color:#C9D0E6;display:flex;flex-direction:column;padding:22px 14px;position:sticky;top:0;height:100vh;height:100dvh;align-self:start}
.ia-brand{display:flex;align-items:center;gap:10px;padding:0 8px 26px;font:600 15px var(--display);color:#fff}
.ia-mark{background:var(--yellow);color:var(--navy);font:800 19px/1 var(--display);letter-spacing:-.04em;padding:9px 9px 10px;border-radius:10px}
.ia-nav{display:grid;gap:2px}
.ia-navbtn{display:flex;align-items:center;gap:11px;background:none;border:0;padding:10px 12px;border-radius:10px;text-align:left;color:#C9D0E6;font-weight:500}
.ia-navbtn span{flex:1}.ia-navbtn:hover{background:rgba(255,255,255,.06);color:#fff}
.ia-navbtn.on{background:rgba(255,255,255,.1);color:#fff}.ia-navbtn.on svg{color:var(--yellow)}
.ia-navbtn em{font-style:normal;font-size:12px;font-weight:600;background:rgba(255,255,255,.12);border-radius:20px;padding:1px 8px;color:#fff}
.ia-navbtn em.hot{background:#E2544A}
.ia-side-foot{margin-top:auto;display:grid;gap:6px;padding:0 8px;font-size:12px;color:#8F99BD}
.ia-refresh{display:flex;align-items:center;gap:8px;justify-content:center;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:#fff!important;border-radius:10px;padding:8px;margin-bottom:6px;font-weight:600}
.ia-refresh:hover:not(:disabled){background:rgba(255,255,255,.14)}.ia-refresh:disabled{opacity:.6}
.ia-co{color:#6E79A3}.ia-back{color:#C9D0E6;text-decoration:none;font-weight:600}.ia-back:hover{color:#fff;text-decoration:underline}
.ia-blank .ia-btn{display:inline-block;margin-top:14px;text-decoration:none}.ia-signout{background:none;border:0;padding:0;text-align:left;font:inherit;font-weight:600;cursor:pointer}

/* main */
.ia-main{padding:34px clamp(20px,3.5vw,48px) 60px;min-width:0;max-width:1400px}
.ia-alert{background:#FBEAE8;color:var(--bad);border-radius:var(--r);padding:12px 16px;margin-bottom:18px}
.ia-hero{margin-bottom:26px}
.ia-date{margin:0 0 6px;color:var(--muted);font-weight:500}
.ia-hero h1{font-size:clamp(28px,3.3vw,44px);line-height:1.08;font-weight:700;letter-spacing:-.025em;max-width:24ch}
.ia-need{color:var(--navy);background:linear-gradient(transparent 62%,var(--yellow) 62%,var(--yellow) 92%,transparent 92%);padding:0 2px}
.ia-calm{color:var(--ok)}

.ia-strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);margin:0 0 22px;overflow:hidden}
.ia-stat{padding:16px 18px;border-left:1px solid var(--line)}.ia-stat:first-child{border-left:0}
.ia-stat dt{font-size:12.5px;color:var(--muted);font-weight:500}
.ia-stat dd{margin:2px 0;font:700 28px/1.15 var(--display);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.ia-stat span{font-size:12px;color:var(--faint)}
.ia-stat.t-bad dd{color:var(--bad)}.ia-stat.t-warn dd{color:var(--warn)}

/* board */
.ia-board{background:var(--navy);color:#fff;border-radius:22px;padding:24px 24px 22px;margin-bottom:22px;position:relative;overflow:hidden}
.ia-board::after{content:'';position:absolute;right:-60px;top:-80px;width:260px;height:260px;border-radius:50%;border:38px solid rgba(247,201,72,.08);pointer-events:none}
.ia-board-h{display:flex;justify-content:space-between;align-items:baseline;gap:20px;flex-wrap:wrap;margin-bottom:18px;position:relative;z-index:1}
.ia-board-h h2{font-size:22px;font-weight:700}.ia-board-h p{margin:0;color:#A9B3D6;max-width:52ch}
.ia-lanes{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;position:relative;z-index:1}
.ia-lanes::before{content:'';position:absolute;left:24px;right:24px;top:21px;height:2px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.22) 0 6px,transparent 6px 12px)}
.ia-lane{position:relative;min-width:0}
.ia-lane-h{margin-bottom:12px;min-height:104px;padding-right:6px}
.ia-lane-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.ia-lane-h strong{display:block;font:700 15px/1.25 var(--display)}.ia-lane-h small{display:block;color:#8F99BD;font-size:12px;line-height:1.35;margin-top:3px}
.ia-step{flex:none;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font:700 16px var(--display);background:var(--navy);border:2px solid rgba(255,255,255,.22);color:#A9B3D6;position:relative;z-index:1}
.ia-lane.has .ia-step{background:var(--yellow);border-color:var(--yellow);color:var(--navy)}
.ia-lane.done.has .ia-step{background:#2FBF7A;border-color:#2FBF7A;color:#fff}
.ia-lane-n{font:600 12px var(--ui);color:#6E79A3;background:var(--navy);padding:2px 8px;border-radius:20px;position:relative;z-index:1}.ia-lane.has .ia-lane-n{color:var(--navy);background:#fff}
.ia-chips{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;min-height:64px;align-content:start;background:rgba(255,255,255,.04);border-radius:14px;padding:8px}
.ia-lane.has .ia-chips{background:rgba(255,255,255,.07)}
.ia-lane-empty{font-size:12px;color:#6E79A3;padding:14px 6px;text-align:center}
.ia-chip{position:relative;min-width:0;display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:#fff;color:var(--ink)!important;border:0;border-radius:12px;padding:9px 10px;
  box-shadow:0 1px 0 rgba(0,0,0,.08),0 6px 16px -8px rgba(0,0,0,.5);animation:ia-drop .6s cubic-bezier(.22,1,.36,1) both;transition:transform .15s}
.ia-chip:hover{transform:translateY(-1px)}
.ia-chiptxt{flex:1;min-width:0}.ia-chiptxt strong,.ia-chiptxt small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ia-chiptxt strong{font-size:13.5px}.ia-chiptxt small{color:var(--faint);font-size:11.5px}
.ia-flag{position:absolute;top:-3px;right:-3px;width:11px;height:11px;border-radius:50%;border:2px solid #fff}.ia-flag.t-bad{background:var(--bad)}.ia-flag.t-warn{background:var(--warn)}
@keyframes ia-drop{from{opacity:0;transform:translateY(-14px) scale(.96)}}

.ia-tile{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:#fff;font:700 13px var(--display);letter-spacing:.02em}
.ia-tile.sm{width:28px;height:28px;border-radius:8px;font-size:11px}.ia-tile.lg{width:48px;height:48px;border-radius:14px;font-size:17px}
.ia-ticks{display:flex;gap:3px}.ia-ticks i{width:7px;height:7px;border-radius:2px;background:#DDE1EB}.ia-ticks i.on{background:var(--ok)}
.ia-ticks.lg i{width:22px;height:6px;border-radius:3px}.ia-ticks.lg{margin-bottom:5px}

/* split */
.ia-split{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:22px}
.ia-panel{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);padding:20px 22px}
.ia-panel-h{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}.ia-panel-h h2{font-size:18px;font-weight:700}
.ia-key{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin:0}
.ia-key i{width:10px;height:10px;border-radius:3px;display:inline-block;margin-left:10px}.ia-key i:first-child{margin-left:0}
.k-msg{background:var(--navy)}.k-sign{background:var(--yellow);border-radius:50%!important}.k-in{background:var(--navy)}.k-out{background:#A9B3D6}
.ia-chart svg{width:100%;height:auto;display:block}
.ia-chart .grid{stroke:var(--line);stroke-dasharray:3 4}.ia-chart .ax{font:11px var(--ui);fill:var(--faint)}
.ia-chart .ia-bar{fill:var(--navy)}.ia-chart .ia-bar.hi{fill:var(--navy2)}
.ia-chart .sign{fill:var(--yellow);stroke:var(--navy);stroke-width:1.5}
.ia-tip{font-size:12.5px;color:var(--muted);min-height:20px;margin-top:4px}
.ia-textbtn{background:none;border:0;padding:0;color:var(--info)!important;font-weight:600}.ia-textbtn:hover{text-decoration:underline}
.ia-feed{list-style:none;margin:0 -10px;padding:0}
.ia-feeditem{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;background:none;border:0;border-radius:12px;padding:10px}
.ia-feeditem:hover:not(:disabled){background:var(--paper)}
.ia-feeddot{flex:none;width:9px;height:9px;border-radius:50%;margin-top:6px}
.t-bad .ia-feeddot{background:var(--bad)}.t-warn .ia-feeddot{background:var(--warn)}.t-info .ia-feeddot{background:var(--info)}
.ia-feedtxt{flex:1;min-width:0}.ia-feedtxt strong{display:block;font-weight:600}.ia-feedtxt span{display:block;color:var(--muted);font-size:13px;line-height:1.4;word-break:break-word}
.ia-feeditem time{font-size:12px;color:var(--faint);white-space:nowrap;padding-top:2px}
.ia-empty{color:var(--muted);text-align:center;padding:26px 10px;margin:0}.ia-empty.left{text-align:left;padding:4px 0}

/* pages */
.ia-pagehead{margin-bottom:20px}.ia-pagehead h1{font-size:34px;font-weight:700;letter-spacing:-.02em}.ia-pagehead p{margin:4px 0 0;color:var(--muted)}
.ia-tools{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.ia-search{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:0 12px;color:var(--faint);min-width:min(320px,100%)}
.ia-search input{border:0;outline:0;background:none;font:inherit;color:var(--ink);padding:10px 0;flex:1;min-width:0}
.ia-search:focus-within{border-color:var(--navy)}
.ia-seg{display:inline-flex;background:#E4E7EF;border-radius:12px;padding:3px;gap:2px;flex-wrap:wrap}
.ia-seg button{border:0;background:none;padding:7px 12px;border-radius:9px;color:var(--muted)!important;font-weight:500;display:flex;gap:6px;align-items:center}
.ia-seg button.on{background:var(--card);color:var(--ink)!important;box-shadow:0 1px 2px rgba(20,27,52,.12)}
.ia-seg button em{font-style:normal;font-size:11.5px;color:var(--faint)}
.ia-seg.full{display:flex}.ia-seg.full button{flex:1;justify-content:center}
.ia-seg button.on.s-suspended{color:var(--bad)!important}.ia-seg button.on.s-trial{color:var(--warn)!important}.ia-seg button.on.s-active{color:var(--ok)!important}
.ia-tablecard{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);overflow-x:auto}
.ia-table{width:100%;border-collapse:collapse;min-width:900px}
.ia-table th{text-align:left;font-size:12.5px;font-weight:500;color:var(--muted);padding:12px 16px;border-bottom:1px solid var(--line);white-space:nowrap}
.ia-table td{white-space:normal;padding:14px 16px;border-bottom:1px solid var(--line);vertical-align:middle}.ia-table tr:last-child td{border-bottom:0}
.ia-table tbody tr{cursor:pointer}.ia-table tbody tr:hover{background:#F7F8FB}
.ia-table td:first-child{min-width:280px}.ia-table .r{text-align:right}.ia-table small{display:block;font-size:12px}.num{font-variant-numeric:tabular-nums}.nowrap{white-space:nowrap}
.ia-bizcell{display:flex;gap:12px;align-items:center}.ia-bizcell strong{display:flex;align-items:center;gap:8px;font-size:14.5px}
.ia-health{display:flex;align-items:baseline;gap:6px;font-size:12.5px;color:var(--muted);margin-top:1px}
.ia-health i{width:8px;height:8px;border-radius:50%;flex:none;background:var(--faint);transform:translateY(-1px)}
.ia-health.t-ok i{background:var(--ok)}.ia-health.t-warn i{background:var(--warn)}.ia-health.t-bad i{background:var(--bad)}.ia-health.t-idle i{background:transparent;border:1.5px solid var(--faint)}
.ia-health.t-bad{color:var(--bad)}
.ia-badge{display:inline-block;font:600 11px var(--ui);padding:2px 8px;border-radius:20px;background:#EDEFF5;color:var(--muted);text-transform:capitalize}
.ia-badge.s-trial{background:#FDF1DD;color:var(--warn)}.ia-badge.s-suspended{background:#FBEAE8;color:var(--bad)}
.ia-sparkcell{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--faint)}
.ia-spark{width:84px;height:24px}.ia-spark rect{fill:#DDE1EB}.ia-spark rect.on{fill:var(--navy)}
.ia-errlist{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.ia-err-h{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}.ia-err-h strong{font-size:15px}.ia-err-h time{margin-left:auto;color:var(--faint);font-size:12.5px}
.ia-errlist pre{white-space:pre-wrap;word-break:break-word;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--paper);border-radius:10px;padding:10px 12px;margin:10px 0 8px;color:#3A4160}
.ia-src{font-size:11.5px;color:var(--faint)}
.ia-timeline{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg)}
.ia-timeline li{display:grid;grid-template-columns:110px 1fr;gap:14px;padding:14px 20px;border-bottom:1px solid var(--line)}.ia-timeline li:last-child{border:0}
.ia-timeline time{color:var(--faint);font-size:12.5px;padding-top:1px}.ia-timeline span{display:block;color:var(--muted);font-size:13px}
.ia-timeline.compact{border:0;background:none}.ia-timeline.compact li{padding:8px 0;grid-template-columns:90px 1fr}
.ia-skel{height:120px;border-radius:var(--r-lg);background:linear-gradient(90deg,#E7E9F0 25%,#F1F2F6 50%,#E7E9F0 75%);background-size:200% 100%;animation:ia-sh 1.3s linear infinite;margin-bottom:12px}
@keyframes ia-sh{to{background-position:-200% 0}}

/* drawer */
.ia-scrim{position:fixed;inset:0;background:rgba(14,20,45,.42);display:flex;justify-content:flex-end;z-index:60;animation:ia-fade .2s ease}
.ia-drawer{width:min(620px,100%);height:100%;background:var(--paper);overflow-y:auto;animation:ia-in .38s cubic-bezier(.22,1,.36,1);box-shadow:-30px 0 60px -20px rgba(14,20,45,.45)}
.ia-dh{display:flex;gap:14px;align-items:center;padding:22px 24px 16px;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
.ia-dh-t{flex:1;min-width:0}.ia-dh-t h2{font-size:24px;font-weight:700}.ia-dh-t p{margin:2px 0 0;color:var(--muted);font-size:13px}
.ia-x{background:var(--paper);border:0;border-radius:10px;width:36px;height:36px;display:grid;place-items:center;color:var(--muted)!important}.ia-x:hover{color:var(--ink)!important}
.ia-banner{display:flex;align-items:center;gap:10px;padding:10px 24px;font-weight:600;font-size:13.5px}
.ia-banner i{width:9px;height:9px;border-radius:50%;background:currentColor;flex:none}
.ia-banner.t-ok{background:#E3F4EB;color:var(--ok)}.ia-banner.t-warn{background:#FDF1DD;color:var(--warn)}.ia-banner.t-bad{background:#FBEAE8;color:var(--bad)}.ia-banner.t-idle{background:#EDEFF5;color:var(--muted)}
.ia-dbody{padding:18px 24px 40px;display:grid;gap:14px}
.ia-dsec{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.ia-dsec h3{font-size:15px;font-weight:700;margin-bottom:12px}
.ia-check{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ia-check li{display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:12px;background:var(--paper)}
.ia-check li>span{flex:none;width:22px;height:22px;border-radius:50%;border:2px solid #C9CEDC;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff}
.ia-check li.on>span{background:var(--ok);border-color:var(--ok)}
.ia-check strong{display:block;font-size:13px}.ia-check small{color:var(--faint);font-size:11.5px;line-height:1.3;display:block}
.ia-check li:not(.on) strong{color:var(--muted)}
.ia-form{display:grid;grid-template-columns:1.4fr 1fr;gap:12px}.ia-form .wide{grid-column:1/-1}
.ia-field{display:grid;gap:6px}.ia-field>span{font-size:12.5px;color:var(--muted);font-weight:500}
.ia-field input,.ia-field textarea{font:inherit;color:var(--ink);background:var(--paper);border:1px solid transparent;border-radius:10px;padding:9px 12px;resize:vertical;width:100%}
.ia-field input:focus,.ia-field textarea:focus{outline:0;border-color:var(--navy);background:#fff}
.ia-confirm{margin:12px 0 0;background:#FBEAE8;color:var(--bad);border-radius:10px;padding:9px 12px;font-weight:500;font-size:13px}
.ia-actions{display:flex;gap:10px;align-items:center;margin:14px 0 8px;flex-wrap:wrap}
.ia-btn{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:9px 16px;font-weight:600}.ia-btn:hover:not(:disabled){border-color:var(--navy)}
.ia-btn.primary{background:var(--navy);color:#fff!important;border-color:var(--navy)}.ia-btn.primary:hover:not(:disabled){background:var(--navy2)}
.ia-btn:disabled{opacity:.4}
.ia-dbars{display:flex;align-items:flex-end;gap:5px;height:110px}
.ia-dbars>div{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px}
.ia-dbars .col{width:100%;max-width:26px;display:flex;flex-direction:column;border-radius:5px 5px 2px 2px;overflow:hidden;min-height:3px;background:#E4E7EF}
.ia-dbars .n{background:var(--navy)}.ia-dbars .o{background:#A9B3D6}.ia-dbars small{font-size:10.5px;color:var(--faint)}
.ia-conns,.ia-people,.ia-runs{list-style:none;margin:0;padding:0}
.ia-conns li{display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}.ia-conns li:last-child{border:0}
.ia-conns li>div{flex:1;min-width:0}.ia-conns strong{display:block}.ia-conns small{display:block;color:var(--muted);font-size:12.5px}.ia-conns .ia-faint{font-size:12.5px}
.ia-counts{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:0}
.ia-counts div{background:var(--paper);border-radius:10px;padding:10px}.ia-counts dd{margin:0;font:700 19px var(--display);font-variant-numeric:tabular-nums}
.ia-counts dt{font-size:11.5px;color:var(--muted);line-height:1.25}.ia-counts .zero dd{color:#B6BBCB}
.ia-kito{margin:0 0 8px;color:var(--muted)}.ia-kito strong{color:var(--ink)}
.ia-runs li{display:flex;gap:12px;font-size:13px;padding:6px 0;border-top:1px solid var(--line)}.ia-runs time{width:90px;color:var(--faint)}.ia-runs span{flex:1}.ia-runs small{color:var(--faint)}
.ia-people li{display:flex;gap:10px;align-items:center;padding:6px 0}.ia-people li .ia-trunc{flex:1}
.ia-id{margin:4px 2px 0;word-break:break-all}
.ia-warn{color:var(--warn)}
.ia-dbars .s{background:var(--yellow)}.k-itaos{background:var(--yellow)}
.ia-mini{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:2px}
.ia-mini li{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:6px 10px;border-radius:8px;background:var(--paper)}
.ia-mini li span{color:var(--muted);display:flex;gap:8px;align-items:center}.ia-mini li b{font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.ia-row{display:flex;gap:14px;align-items:center;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.ia-row strong{display:block;font-size:13.5px}.ia-row small{display:block;font-size:12.5px}
.ia-danger{border-color:#F1C9C4}.ia-danger h3{color:var(--bad)}
.ia-btn.danger{background:var(--bad);border-color:var(--bad);color:#fff!important}.ia-btn.danger:hover:not(:disabled){background:#A92B22}
.ia-actions.wide{grid-column:1/-1;margin:0}
.ia-staffrow{display:flex;gap:12px;align-items:center;justify-content:space-between}.ia-staffrow strong{display:flex;gap:8px;align-items:center}
.ia-addstaff{margin-top:16px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 12px;align-items:end}.ia-addstaff p,.ia-addstaff [role=status]{grid-column:1/-1;margin:0}
@keyframes ia-fade{from{opacity:0}}@keyframes ia-in{from{transform:translateX(48px);opacity:0}}

@media (max-width:1180px){.ia-strip{grid-template-columns:repeat(3,1fr)}.ia-stat:nth-child(4){border-left:0}.ia-stat:nth-child(n+4){border-top:1px solid var(--line)}
  .ia-lanes{grid-template-columns:repeat(6,minmax(170px,1fr));overflow-x:auto;padding-bottom:6px}.ia-split{grid-template-columns:1fr}}
@media (max-width:820px){.ia{grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr;align-content:start}
  .ia-side{position:sticky;top:0;z-index:20;height:auto;align-self:start;flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px 8px;padding:10px 12px 8px}
  .ia-brand{padding:0;flex:1}.ia-mark{font-size:16px;padding:7px 7px 8px;border-radius:8px}
  .ia-side-foot{order:2;margin:0;padding:0;display:flex;align-items:center;gap:12px}.ia-back{font-size:12.5px}.ia-side-foot span{display:none}.ia-refresh{margin:0;padding:6px 12px;font-size:13px}
  .ia-nav{order:3;width:100%;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px}
  .ia-navbtn{flex-direction:column;gap:3px;padding:7px 2px;font-size:12px;text-align:center;position:relative}
  .ia-navbtn span{flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .ia-navbtn em{position:absolute;top:3px;left:calc(50% + 6px);font-size:10px;padding:0 5px;line-height:16px}
  .ia-main{padding-top:22px}
  .ia-strip{grid-template-columns:repeat(2,1fr)}.ia-stat{border-left:0!important;border-top:1px solid var(--line)}.ia-stat:nth-child(-n+2){border-top:0}
  .ia-lanes{grid-template-columns:repeat(6,minmax(230px,1fr))}.ia-board{padding:20px 16px}
  .ia-check,.ia-form{grid-template-columns:1fr}.ia-counts{grid-template-columns:repeat(2,1fr)}.ia-lanes::before{display:none}}
@media (prefers-reduced-motion:reduce){.ia *{animation:none!important;transition:none!important}}

/* ---- Liquid glass (iOS 26 style) on buttons, toggles and the sidebar navigation ---- */
.ia{--lg-sheen:linear-gradient(180deg,rgba(255,255,255,.95) 0%,rgba(255,255,255,.4) 50%,rgba(255,255,255,.2) 100%);--lg-tint:linear-gradient(180deg,rgba(255,255,255,.3) 0%,rgba(255,255,255,.08) 45%,rgba(255,255,255,0) 62%,rgba(255,255,255,.1) 100%);--lg-blur:blur(16px) saturate(180%);--lg-spring:cubic-bezier(.34,1.56,.64,1)}
.ia-btn{background:rgba(255,255,255,.6) var(--lg-sheen);border-color:rgba(255,255,255,.95);border-radius:999px;-webkit-backdrop-filter:var(--lg-blur);backdrop-filter:var(--lg-blur);box-shadow:inset 0 1px 1px #fff,inset 0 -1px 2px rgba(20,27,52,.07),0 0 0 .5px rgba(20,27,52,.16),0 6px 16px -10px rgba(20,27,52,.4);transition:transform .35s var(--lg-spring),box-shadow .25s,background-color .25s}
.ia-btn:hover:not(:disabled){border-color:#fff;background-color:rgba(255,255,255,.88);box-shadow:inset 0 1px 1px #fff,inset 0 -1px 2px rgba(20,27,52,.07),0 0 0 .5px rgba(20,27,52,.22),0 12px 24px -12px rgba(20,27,52,.45)}
.ia-btn:active:not(:disabled){transform:scale(.96)}
.ia-btn.primary{background:color-mix(in srgb,var(--navy) 88%,transparent) var(--lg-tint);border-color:rgba(255,255,255,.22);box-shadow:inset 0 1px 1px rgba(255,255,255,.35),inset 0 -2px 4px rgba(0,0,0,.25),0 0 0 .5px rgba(20,27,52,.3),0 10px 24px -10px rgba(22,34,74,.6)}
.ia-btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--navy2) 92%,transparent) var(--lg-tint)}
.ia-seg{background:rgba(20,27,52,.07);border-radius:999px;box-shadow:inset 0 1px 3px rgba(20,27,52,.12),inset 0 0 0 .5px rgba(20,27,52,.06)}
.ia-seg button{border-radius:999px;transition:transform .35s var(--lg-spring),background-color .25s}
.ia-seg button.on{background:rgba(255,255,255,.9) var(--lg-sheen);box-shadow:inset 0 1px 1px #fff,inset 0 -1px 1px rgba(20,27,52,.06),0 0 0 .5px rgba(20,27,52,.14),0 4px 12px -6px rgba(20,27,52,.35)}
.ia-seg button:active:not(:disabled){transform:scale(.96)}
.ia-navbtn{border-radius:14px;border:1px solid transparent;transition:background-color .25s,border-color .25s,box-shadow .25s,transform .35s var(--lg-spring)}
.ia-navbtn:hover{background:rgba(255,255,255,.07)}
.ia-navbtn.on{background:rgba(255,255,255,.12) linear-gradient(180deg,rgba(255,255,255,.18) 0%,rgba(255,255,255,0) 60%);border-color:rgba(255,255,255,.16);box-shadow:inset 0 1px 0 rgba(255,255,255,.22),inset 0 -1px 1px rgba(0,0,0,.25),0 8px 20px -12px rgba(0,0,0,.6);-webkit-backdrop-filter:var(--lg-blur);backdrop-filter:var(--lg-blur)}
.ia-navbtn:active{transform:scale(.96)}
.ia-refresh{border-radius:999px;background:rgba(255,255,255,.1) linear-gradient(180deg,rgba(255,255,255,.18) 0%,rgba(255,255,255,0) 60%);border-color:rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 6px 16px -10px rgba(0,0,0,.6)}
@media (max-width:820px){.ia-side{background:color-mix(in srgb,var(--navy) 84%,transparent);-webkit-backdrop-filter:blur(22px) saturate(180%);backdrop-filter:blur(22px) saturate(180%)}}
/* ---- Phone (20 Nov): slim top bar, bottom menu + "More" sheet, filters in one swipeable line, businesses as rows ---- */
.ia-mrefresh,.ia-bnav,.ia-mlist{display:none}
@media (max-width:820px){
  .ia-side{flex-wrap:nowrap;padding:max(10px,env(safe-area-inset-top)) 14px 10px;gap:8px}
  .ia-nav,.ia-side-foot{display:none!important}
  .ia-mrefresh{display:flex;align-items:center;gap:8px;flex:none;height:38px;padding:0 6px 0 14px;border-radius:999px;border:1px solid rgba(255,255,255,.16);
    background:rgba(255,255,255,.1) linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,0) 60%);color:#fff!important;font-size:12.5px;font-weight:600;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.2);transition:transform .3s var(--lg-spring),background-color .2s}
  .ia-mrefresh svg{width:26px;height:26px;padding:4px;border-radius:999px;background:rgba(255,255,255,.14);color:var(--yellow)}
  .ia-mrefresh:active:not(:disabled){transform:scale(.95);background-color:rgba(255,255,255,.18)}
  .ia-mrefresh:disabled{opacity:1}
  .ia-mrefresh-t{color:#C9D0E6;white-space:nowrap}
  .ia-mrefresh.busy svg{animation:ia-spin .9s linear infinite}
  @keyframes ia-spin{to{transform:rotate(360deg)}}
  .ia-main{padding:18px 14px calc(100px + env(safe-area-inset-bottom))}
  .ia-bnav{display:grid;grid-template-columns:repeat(4,1fr);position:fixed;z-index:30;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));width:min(340px,calc(100% - 24px));padding:6px;border-radius:999px;
    background:color-mix(in srgb,var(--navy) 90%,transparent);-webkit-backdrop-filter:blur(22px) saturate(180%);backdrop-filter:blur(22px) saturate(180%);box-shadow:0 12px 30px -12px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.12)}
  .ia-bnav button{border:0;background:none;border-radius:999px;padding:7px 2px 6px;display:grid;justify-items:center;gap:2px;font-size:11.5px;font-weight:600;color:#AEB7D6!important}
  .ia-bnav button.on{background:rgba(255,255,255,.13);color:#fff!important}.ia-bnav button.on svg{color:var(--yellow)}
  .ia-bico{position:relative;display:grid}
  .ia-bico em{position:absolute;top:-6px;left:12px;font-style:normal;font-size:10px;font-weight:700;line-height:16px;min-width:16px;padding:0 4px;border-radius:999px;background:#E2544A;color:#fff;text-align:center}
  .ia-sheet-back{position:fixed;inset:0;z-index:28;background:rgba(10,14,30,.35)}
  .ia-sheet{position:fixed;z-index:29;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom));background:var(--card);border-radius:22px;padding:8px;display:grid;gap:2px;box-shadow:0 24px 60px -20px rgba(10,14,30,.6);animation:ia-up .22s ease both}
  @keyframes ia-up{from{opacity:0;transform:translateY(12px)}}
  .ia-sheet>button{display:flex;align-items:center;gap:12px;border:0;background:none;padding:12px 14px;border-radius:14px;font-weight:600;text-align:left}
  .ia-sheet>button span{flex:1}.ia-sheet>button svg{color:var(--muted)}
  .ia-sheet>button.on{background:var(--paper)}.ia-sheet>button.on svg{color:var(--navy)}
  .ia-sheet>button em{font-style:normal;font-size:11px;font-weight:700;background:#E2544A;color:#fff;border-radius:999px;padding:1px 7px}
  .ia-sheet-foot{display:flex;align-items:center;gap:14px;padding:10px 14px 6px;margin-top:4px;border-top:1px solid var(--line);font-size:13px;color:var(--faint)}
  .ia-sheet-foot span{flex:1}.ia-sheet-foot a,.ia-sheet-foot button{color:var(--navy)!important;font-weight:600;text-decoration:none;border:0;background:none;padding:6px 0}
  .ia-sheet-foot button{color:var(--bad)!important}
  .ia-pagehead h1{font-size:28px}
  .ia-tools{display:grid;gap:10px;grid-template-columns:minmax(0,1fr);justify-content:stretch}
  .ia-search{min-width:0;width:100%}
  .ia-tools .ia-seg{display:flex;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;background:none;box-shadow:none;padding:0;gap:6px;margin:0 -14px;padding:0 14px;border-radius:0}
  .ia-tools .ia-seg::-webkit-scrollbar{display:none}
  .ia-tools .ia-seg button{flex:none;height:34px;padding:0 13px;border-radius:999px;background:#E4E7EF;box-shadow:none;white-space:nowrap}
  .ia-tools .ia-seg button.on{background:var(--navy);color:#fff!important;box-shadow:none}.ia-tools .ia-seg button.on em{color:#C9D0E6}
  .ia-mlist{display:grid;list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
  .ia-mlist>li+li{border-top:1px solid var(--line)}
  .ia-mlist>li.ia-empty{padding:18px}
  .ia-mlist button{display:flex;gap:12px;align-items:flex-start;width:100%;border:0;background:none;text-align:left;padding:14px}
  .ia-mlist button:active{background:#F7F8FB}
  .ia-mlist .ia-tile{width:40px;height:40px;border-radius:12px}
  .ia-mbody{display:grid;gap:3px;min-width:0;flex:1}
  .ia-mtop{display:flex;align-items:baseline;gap:6px;min-width:0}
  .ia-mtop strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}
  .ia-mtop small{margin-left:auto;flex:none;color:var(--faint);font-size:12px}
  .ia-mbody>small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}
  .ia-msetup{display:flex;align-items:center;gap:8px;margin-top:3px}.ia-msetup .ia-ticks.lg{margin:0}.ia-msetup .ia-ticks.lg i{width:18px}
  .ia-msetup small{font-size:12px}
  .ia-tools+.ia-mlist+.ia-tablecard{display:none}
}
/* ---- Phone (20 Nov, 2): the page never slides sideways. Wide tables scroll inside their own box instead. ---- */
@media (max-width:820px){
  html:has(.ia),html:has(.ia) body{overflow-x:hidden;overscroll-behavior-x:none}
  .ia{overflow-x:clip;max-width:100vw}
  .ia-main{min-width:0;max-width:100vw;overflow-x:clip}
  .ia-main>*,.ia-panel,.ia-split>*,.ix-two>*{min-width:0;max-width:100%}
  .ia-strip,.ia-strip.ix-strip5{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ia-stat{min-width:0;overflow-wrap:anywhere}
  .ia-panel{padding:16px}
  .ia-panel-h{flex-wrap:wrap;gap:8px}
  .ia-main .ia-seg{max-width:100%;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.ia-main .ia-seg::-webkit-scrollbar{display:none}
  .ia-main .ia-seg button{flex:none;white-space:nowrap}
  .ia-timeline li{grid-template-columns:minmax(0,80px) minmax(0,1fr)}
}
/* ---- Phone (20 Nov, 3): every table becomes a stack of cards. The first cell is the card's title;
   the others sit two per line under it, each with its column name as a small label (set by Frame). ---- */
@media (max-width:820px){
  .ia table{display:block;width:100%;min-width:0!important;border-collapse:separate}
  .ia thead{display:none}
  .ia tbody{display:grid}
  .ia tbody tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;padding:14px 0;border-bottom:1px solid var(--line)}
  .ia tbody tr:last-child{border-bottom:0}
  .ia-tablecard{overflow:visible}.ia-tablecard tbody tr{padding:14px 16px}
  .ia tbody tr:hover{background:none}
  .ia td{display:block;padding:0!important;border:0!important;text-align:left!important;min-width:0!important;white-space:normal!important;overflow-wrap:anywhere}
  .ia td:first-child,.ia td[colspan]{grid-column:1/-1}
  .ia td:first-child{font-size:14.5px}
  .ia td[data-label]:not(:first-child):not([data-label=""])::before{content:attr(data-label);display:block;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);margin-bottom:2px}
  .ia td:empty{display:none}
  .ia td .nowrap,.ia td.nowrap{white-space:normal}
  .ia td .ia-trunc{max-width:100%}
  .ia td:last-child:has(button),.ia td:last-child:has(.ia-btn){grid-column:1/-1}
  /* Today: the setup steps stack one under another instead of sliding sideways */
  .ia-lanes{grid-template-columns:minmax(0,1fr)!important;overflow:visible!important;padding-bottom:0}
}
/* ---- Phone (20 Nov, 5): each card shows its title and two numbers with a ›. Tap: rows about a business open
   that business; other rows open as their own full page with every detail and a Back button. ---- */
.ia td.ia-fold{display:none}
@media (max-width:820px){
  .ia tbody tr[data-more]:not([data-page])>td:nth-child(n+4):not(.ia-fold),
  .ia tbody tr[data-link]>td:nth-child(n+4){display:none}
  .ia tbody tr[data-more],.ia tbody tr[data-link]{position:relative;cursor:pointer;padding-right:40px!important}
  .ia tbody tr[data-more]:not([data-page])::after,.ia tbody tr[data-link]::after{content:"";position:absolute;right:16px;top:50%;width:9px;height:9px;margin-top:-5px;border-right:2px solid var(--faint);border-top:2px solid var(--faint);transform:rotate(45deg)}
  .ia tbody tr[data-more]:not([data-page]):active,.ia tbody tr[data-link]:active{background:#F7F8FB}
  /* the full page */
  html.ia-paged,html.ia-paged body{overflow:hidden}
  .ia tbody tr[data-page]{position:fixed;inset:0;z-index:60;margin:0;background:var(--paper);overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
    grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:10px;padding:calc(72px + env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom))!important;border:0;cursor:default}
  .ia tbody tr[data-page]>td{display:block;background:var(--card);border:1px solid var(--line)!important;border-radius:14px;padding:12px 14px!important;font-size:15px}
  .ia tbody tr[data-page]>td:first-child{background:none;border:0!important;padding:4px 2px 8px!important;font-size:22px}
  .ia tbody tr[data-page]>td:first-child strong{font:700 24px/1.2 var(--display)}
  .ia tbody tr[data-page]>td[data-label]:not(:first-child):not([data-label=""])::before{font-size:11.5px;margin-bottom:4px}
  .ia tbody tr[data-page]>td:has(input,select,button:not(.ia-page-back)){grid-column:1/-1}
  .ia tbody tr[data-page]>td.ia-fold{display:flex;align-items:center;position:fixed;z-index:61;left:0;right:0;top:0;padding:calc(10px + env(safe-area-inset-top)) 10px 10px!important;border:0!important;border-radius:0;
    background:color-mix(in srgb,var(--navy) 92%,transparent);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}
  .ia-page-back{display:flex;align-items:center;gap:4px;border:0;background:none;color:#fff!important;font-size:16px;font-weight:600;padding:8px 10px;border-radius:999px}
  .ia-page-back:active{background:rgba(255,255,255,.12)}
  .ia tbody tr[data-page] input,.ia tbody tr[data-page] select{width:100%!important;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink)}
  .ia tbody tr[data-page] td:has(button:not(.ia-page-back)){display:flex!important;align-items:center;gap:14px;flex-wrap:wrap}
  .ia tbody tr[data-page] .ia-textbtn,.ia tbody tr[data-page] td>button:not(.ia-page-back){font-size:15px;font-weight:600}
}
/* ---- Timelines (Audit log, Recent failed calls, Drawer history): long words wrap, never run off the card.
   On a phone the time sits above the text, and very long notes show 3 lines until tapped. ---- */
.ia-timeline li>div,.ia-timeline li>*{min-width:0}
.ia-timeline li strong,.ia-timeline li span{overflow-wrap:anywhere;word-break:break-word}
@media (max-width:820px){
  .ia-timeline li,.ia-timeline.compact li{grid-template-columns:minmax(0,1fr)!important;gap:2px;padding:12px 16px}
  .ia-timeline.compact li{padding:10px 0}
  .ia-timeline time{font-size:12px}
  .ia-timeline li span{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer}
  .ia-timeline li.ia-open span{display:block;-webkit-line-clamp:unset}
}
/* ---- Phone audit (20 Nov): everything on every admin page fits a phone ---- */
@media (max-width:820px){
  /* Charts: bigger axis labels (they're drawn in a wide box, then shrunk to the phone) */
  .ia-chart svg[viewBox^="0 0 640"] .ax{font-size:20px}
  .ia-chart svg[viewBox^="0 0 1000"] .ax{font-size:24px}
  .ia-chart text[text-anchor="end"]{display:none}   /* side scale would be cut off; the totals line under the chart says it */
  /* Period / view toggles with a few choices: share the width instead of sliding off the edge */
  .ia-main .ia-seg:not(:has(>button:nth-child(5))){display:grid!important;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);width:auto!important;justify-self:stretch;flex:1 1 100%;overflow:visible!important;margin:0!important;padding:3px!important;gap:3px;border-radius:999px;background:rgba(20,27,52,.07)!important}
  .ia-main .ia-seg:not(:has(>button:nth-child(5)))>button{flex:none!important;width:100%;min-width:0;height:34px;justify-content:center;padding:0 6px!important;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:none!important;box-shadow:none!important;color:var(--muted)!important}
  .ia-main .ia-seg:not(:has(>button:nth-child(5)))>button.on{background:var(--card)!important;color:var(--ink)!important;box-shadow:0 1px 3px rgba(20,27,52,.18)!important}
  .ia-pagehead{margin-bottom:14px}.ia-pagehead p{font-size:13.5px}
  /* Stat boxes: an odd one out spans the row */
  .ia-strip>.ia-stat:last-child:nth-child(odd){grid-column:1/-1}
  /* Panels stacked one after another need breathing room */
  .ia-main section.ia-panel+section.ia-panel{margin-top:16px}
  /* Today: empty setup steps stay short */
  .ia-lane:not(.has) .ia-chips{display:none}
  .ia-lane:not(.has):not(.done){opacity:.55}
  .ia-feedtxt span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  /* Errors: each one is a short card; tap to see the full message and what to do */
  .ia-errlist>li{cursor:pointer;padding:14px 16px}
  .ia-errlist>li:not([data-open]) pre{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;background:none;padding:0;border:0;margin:6px 0 0;font:13px/1.45 var(--ui);color:var(--muted)}
  .ia-errlist>li[data-open] pre{white-space:pre-wrap;overflow-wrap:anywhere}
  .ia-errlist>li:not([data-open]) .ia-src,.ia-errlist>li:not([data-open]) .ix-recovery{display:none}
  .ia-errlist>li:not([data-open])::after{content:"Tap for details";display:block;margin-top:6px;font-size:12px;color:var(--faint)}
  .ia-err-h{flex-wrap:wrap;row-gap:2px}
  /* Business panel (drawer) */
  .ia-drawer .ix-dfunnel{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ia-conns li{flex-wrap:wrap;align-items:flex-start}
  .ia-conns li>.ia-faint{flex-basis:100%;padding-left:20px}
  .ia-people li{flex-wrap:wrap}.ia-people li .ia-trunc{flex:1 1 100%;max-width:100%;white-space:normal;overflow-wrap:anywhere}
  .ia-mini li{flex-direction:column;gap:2px}.ia-mini li b{text-align:left}
  .ia-row{flex-wrap:wrap}
}
`;
