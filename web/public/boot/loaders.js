/* itaOS liquid loaders (ita. wordmark and Kito gem). Gooey blobs wander, pour into the mark, hold, then melt back.
     Used by the first-screen preloader below and by Kito's thinking states in the app (window.itaLiquid.mount). */
  (function () {
    var NS = "http://www.w3.org/2000/svg", W = 640, H = 480, uid = 0;
    var reduce = false; try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    function el(n, a, p) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
    function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    var FONT = "600 250px Inter, system-ui, sans-serif";
    function itaM(x) { x.font = FONT; var w1 = x.measureText("ita").width, w2 = x.measureText(".").width; return { sx: (W - w1 - w2) / 2, w1: w1 }; }
    function sparkle(x, cx, cy, r, th) {
      x.beginPath();
      for (var i = 0; i < 4; i++) {
        var a = i * Math.PI / 2 - Math.PI / 2, a2 = a + Math.PI / 2, am = a + Math.PI / 4;
        if (i === 0) x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        x.quadraticCurveTo(cx + Math.cos(am) * r * th, cy + Math.sin(am) * r * th, cx + Math.cos(a2) * r, cy + Math.sin(a2) * r);
      }
      x.closePath(); x.fill();
    }
    var MARKS = {
      ita: [
        { color: "var(--lq-ink)", r: 6, step: 9, draw: function (x) { var m = itaM(x); x.fillText("ita", m.sx, H / 2 + 78); },
          blobs: [{ cx: 330, cy: 160, ax: 170, ay: 60, fx: .9, fy: 1.3, px: 0, py: 1, lag: 1.1, w: 15 },
                  { cx: 250, cy: 300, ax: 150, ay: 80, fx: 1.1, fy: .8, px: 2, py: 3, lag: .7, w: 13 },
                  { cx: 400, cy: 320, ax: 120, ay: 60, fx: .7, fy: 1.1, px: 4, py: .5, lag: .12, w: 28 }] },
        { color: "var(--lq-dot)", r: 5.5, step: 7, draw: function (x) { var m = itaM(x); x.fillText(".", m.sx + m.w1, H / 2 + 78); },
          blobs: [{ cx: 190, cy: 250, ax: 110, ay: 120, fx: 1.2, fy: .9, px: 1, py: 2, lag: .3, w: 12 }] }
      ],
      kito: [
        { color: "var(--lq-ink)", r: 6, step: 9, draw: function (x) { sparkle(x, W / 2 - 30, H / 2 + 10, 165, .32); },
          blobs: [{ cx: 320, cy: 170, ax: 180, ay: 70, fx: 1, fy: 1.2, px: .5, py: 0, lag: 1, w: 15 },
                  { cx: 300, cy: 290, ax: 140, ay: 70, fx: .8, fy: 1, px: 3, py: 2, lag: .5, w: 16 },
                  { cx: 420, cy: 250, ax: 100, ay: 90, fx: 1.3, fy: .7, px: 1.5, py: 4, lag: .12, w: 26 }] },
        { color: "var(--lq-dot)", r: 5.5, step: 7, draw: function (x) { sparkle(x, W / 2 + 140, H / 2 - 120, 58, .34); },
          blobs: [{ cx: 180, cy: 220, ax: 110, ay: 110, fx: 1.1, fy: 1.3, px: 2, py: 1, lag: .35, w: 12 }] }
      ]
    };
    var cache = {};
    function targets(kind, li, L, small) {
      var key = kind + li + (small ? "s" : "");
      if (cache[key]) return cache[key];
      var c = document.createElement("canvas"); c.width = W; c.height = H;
      var x = c.getContext("2d"); x.fillStyle = "#fff"; L.draw(x);
      var d = x.getImageData(0, 0, W, H).data, s = L.step * (small ? 1.8 : 1), pts = [];
      for (var y = s / 2, row = 0; y < H; y += s, row++)
        for (var xx = row % 2 ? s / 2 : 0; xx < W; xx += s)
          if (d[((y | 0) * W + (xx | 0)) * 4 + 3] > 150) pts.push([xx, y]);
      return (cache[key] = { pts: pts, url: c.toDataURL() });
    }
    // opts: { small, offset (s), times: [wanderEnd, formed, meltStart, cycle] }
    function mount(host, kind, opts) {
      opts = opts || {};
      var id = "lq" + (uid++), small = !!opts.small, tm = opts.times || [1.4, 2.9, 4.4, 5.6];
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, class: "lq-svg", "aria-hidden": "true" }, host);
      var defs = el("defs", {}, svg);
      var f = el("filter", { id: id + "g", filterUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H, "color-interpolation-filters": "sRGB" }, defs);
      el("feGaussianBlur", { "in": "SourceGraphic", stdDeviation: small ? 11 : 7, result: "b" }, f);
      el("feColorMatrix", { "in": "b", mode: "matrix", values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" }, f);
      var layers = MARKS[kind].map(function (L, li) {
        var tg = targets(kind, li, L, small);
        var m = el("mask", { id: id + "m" + li, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H }, defs);
        el("image", { href: tg.url, x: 0, y: 0, width: W, height: H }, m);
        var g = el("g", { filter: "url(#" + id + "g)", style: "fill:" + L.color }, svg);
        var crisp = el("rect", { x: 0, y: 0, width: W, height: H, style: "fill:" + L.color, mask: "url(#" + id + "m" + li + ")", opacity: reduce ? 1 : 0 }, svg);
        var B = L.blobs, per = Math.ceil(tg.pts.length / B.length), pts = [];
        if (!reduce) tg.pts.forEach(function (t, i) {
          var bi = Math.min(B.length - 1, Math.floor(i / per)), n = Math.min(per, tg.pts.length - bi * per);
          var a = Math.random() * 6.283, rr = Math.sqrt(Math.random());
          var p = { tx: t[0], ty: t[1], b: B[bi], f: (i - bi * per) / Math.max(1, n - 1), ox: Math.cos(a) * rr, oy: Math.sin(a) * rr };
          p.c = el("circle", { r: ((small ? L.r * 1.8 : L.r) * (.85 + Math.random() * .3)).toFixed(2) }, g);
          pts.push(p);
        });
        return { pts: pts, crisp: crisp };
      });
      var raf = 0, stopped = false;
      if (reduce) { svg.classList.add("lq-still"); return { stop: function () { svg.remove(); } }; }
      var G0 = tm[0], G1 = tm[1], H1 = tm[2], T = tm[3], t0 = performance.now() / 1000 - (opts.offset || 0);
      function pos(b, t) {
        return [b.cx + b.ax * Math.sin(b.fx * t + b.px) + b.ax * .3 * Math.sin(b.fx * 2.3 * t + b.py),
                b.cy + b.ay * Math.sin(b.fy * t + b.py) + b.ay * .25 * Math.cos(b.fy * 1.7 * t + b.px)];
      }
      function frame(now) {
        if (stopped) return;
        var t = now / 1000 - t0, ph = t % T, cr = 0;
        if (ph > G1 - .2 && ph < H1 + .2) cr = Math.min(clamp((ph - (G1 - .2)) / .35), 1 - clamp((ph - (H1 - .1)) / .3));
        for (var j = 0; j < layers.length; j++) {
          var l = layers[j];
          for (var i = 0; i < l.pts.length; i++) {
            var p = l.pts[i], b = p.b, w = pos(b, t - p.f * b.lag), tap = .5 + .5 * Math.sin(Math.PI * p.f);
            var sx = w[0] + p.ox * b.w * tap, sy = w[1] + p.oy * b.w * tap, k = 0;
            if (ph >= G0 && ph < G1) k = ease(clamp(((ph - G0) / (G1 - G0) - p.f * .3) / .7));
            else if (ph >= G1 && ph < H1) k = 1;
            else if (ph >= H1) k = 1 - ease(clamp(((ph - H1) / (T - H1) - (1 - p.f) * .25) / .75));
            p.c.setAttribute("cx", (sx + (p.tx - sx) * k).toFixed(1));
            p.c.setAttribute("cy", (sy + (p.ty - sy) * k).toFixed(1));
          }
          l.crisp.setAttribute("opacity", cr.toFixed(3));
        }
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      return { stop: function () { stopped = true; cancelAnimationFrame(raf); svg.remove(); } };
    }
    // Waits (briefly) for Inter so the ita. targets are drawn in the right font.
    function ready() {
      try { return Promise.race([document.fonts.load(FONT), new Promise(function (r) { setTimeout(r, 600); })]); }
      catch (e) { return Promise.resolve(); }
    }
    window.itaLiquid = { mount: mount, ready: ready };
  })();
