/* Loader colours (22 Nov 2026): black, white and the homepage green, mixed at random on every load.
     The screen is one of the three, the logo tile another, and the dot the third (letters contrast the tile). */
  (function () {
    var C = { black: "#121417", white: "#ffffff", green: "#0f7a4f" }, names = ["black", "white", "green"];
    var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    var bg = pick(names), tile = pick(names.filter(function (n) { return n !== bg; }));
    var dot = names.filter(function (n) { return n !== bg && n !== tile; })[0];
    var ink = function (n) { return n === "white" ? C.black : C.white; };
    var p = document.getElementById("preloader"), st = p.style;
    st.background = C[bg];
    st.setProperty("--t-bg", C[tile]); st.setProperty("--t-fg", ink(tile)); st.setProperty("--t-dot", C[dot]);
    st.setProperty("--t-edge", tile === "white" ? "#e6e8ec" : "rgba(255,255,255,.14)");
    st.setProperty("--sheen", "#ffffff");
    // first-screen liquid loader draws straight on the screen colour
    st.setProperty("--lq-ink", ink(bg)); st.setProperty("--lq-dot", C[bg === "green" ? "white" : "green"]);
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", C[bg]);
  })();
