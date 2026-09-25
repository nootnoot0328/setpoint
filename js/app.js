/* ==========================================================================
   Setpoint — app shell, views, sheets.
   Depends on: Engine (engine.js), SP_FOODS (foods.js), Charts (charts.js)
   All data stays in this browser (localStorage) and in your exports.
   ========================================================================== */
(function () {
  "use strict";
  const E = window.Engine, C = window.Charts, FOODS = window.SP_FOODS, Y = window.SPSync;
  const { r0, r1, clamp, addDays, daysBetween, isWeekend, weekStart, today } = E;
  let TR = null;   // training module, initialised in boot()

  /* =================================================================
     helpers
     ================================================================= */
  const $ = (s, r) => (r || document).querySelector(s);
  function h(tag, a, ...kids) {
    const n = document.createElement(tag);
    if (a) for (const k in a) {
      const v = a[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "style" && typeof v === "object") {
        for (const sk in v) { if (v[sk] == null) continue; if (sk.startsWith("--")) n.style.setProperty(sk, v[sk]); else n.style[sk] = v[sk]; }
      }
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      n.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  const svg = (p, cls) => `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ""}>${p}</svg>`;
  const I = {
    dash: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="4.5" rx="1.5"/><rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    log: '<path d="M12 7.2c-1.6-1.4-4.2-1.7-5.8-.2C4.3 8.7 4.5 12.3 6 15.3c1.2 2.5 3 4.9 4.6 4.9.8 0 1-.5 1.4-.5s.6.5 1.4.5c1.6 0 3.4-2.4 4.6-4.9 1.5-3 1.7-6.6-.2-8.3-1.6-1.5-4.2-1.2-5.8.2z"/><path d="M12 7.2c0-2 1-3.6 3-4.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    strat: '<circle cx="12" cy="7" r="3.2"/><circle cx="6.5" cy="16.5" r="3.2"/><circle cx="17.5" cy="16.5" r="3.2"/>',
    more: '<circle cx="12" cy="12" r="9.5"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="3"/>',
    train: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
    share: '<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    sync: '<path d="M20 12a8 8 0 01-14.3 4.9M4 12A8 8 0 0118.3 7.1"/><path d="M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2"/>',
    body: '<circle cx="12" cy="4.5" r="2.2"/><path d="M5 8.5h14M12 8.5v6M12 14.5l-3 7M12 14.5l3 7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
    barcode: '<path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2M8 8.5v7M11 8.5v7M14 8.5v7M17 8.5v7"/>',
    bolt: '<path d="M13 2.5L4.5 13.5h7l-1 8 8.5-11h-7l1-8z"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.6A8.2 8.2 0 019.4 4a8.2 8.2 0 1010.6 10.6z"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    dots: '<path d="M12 5.5h.01M12 12h.01M12 18.5h.01" stroke-width="3.2"/>',
    scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M8.3 9.3a5.2 5.2 0 017.4 0M12 12l1.8-2.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    book: '<path d="M5 4.5h12.5a1.5 1.5 0 011.5 1.5v14H6.5A1.5 1.5 0 015 18.5z"/><path d="M5 18.5A1.5 1.5 0 016.5 17H19"/>',
    data: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
    half: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 000 18z" fill="currentColor"/>',
    fork: '<path d="M7 3v7a2 2 0 002 2v9M11 3v7M7 3v4M15.5 21V3c2 1.5 3 4 3 7h-3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    reset: '<path d="M20 11.5A8 8 0 104.5 15M20 4.5v7h-7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h11"/>',
    moonfast: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3"/>',
    trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    up: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>'
  };
  const flame = (col) => `<svg viewBox="0 0 24 24" style="fill:${col || "currentColor"}"><path d="M13.6 2.2c.3 2.9-1.3 4.4-2.6 5.9-1.3 1.5-2.4 3-2.4 5.3 0 .9.2 1.7.6 2.4-1-.4-1.9-1.3-2.3-2.5-.6 1-.9 2.1-.9 3.3A6 6 0 0012 22.6a6 6 0 006-6.1c0-3.4-1.9-5.6-3.3-7.6-.9-1.3-1.3-2.9-1.1-6.7z"/></svg>`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const f0 = v => (v == null || !isFinite(v)) ? "—" : String(Math.round(v));
  const f1 = v => (v == null || !isFinite(v)) ? "—" : (Math.round(v * 10) / 10).toFixed(1);
  const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v);
  const hourLabel = hr => { const h12 = hr % 12 === 0 ? 12 : hr % 12; return `${h12} ${hr < 12 ? "AM" : "PM"}`; };
  const pad2 = n => String(n).padStart(2, "0");
  const qtyTxt = q => (Math.round(q * 100) / 100).toString();
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW1 = ["S", "M", "T", "W", "T", "F", "S"];
  function dShort(iso) { const d = E.parse(iso); return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  function dLong(iso) { const d = E.parse(iso); return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }
  function CW() { return Math.min(520, document.documentElement.clientWidth) - 32; }

  let toastT;
  function toast(msg) {
    const old = $(".toast"); if (old) old.remove();
    const t = h("div", { class: "toast", role: "status" }, msg);
    document.body.appendChild(t);
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 260); }, 2200);
  }

  function countUps(root) {
    root.querySelectorAll("[data-count]").forEach(el => {
      const to = +el.dataset.count, dec = +(el.dataset.dec || 0);
      if (!isFinite(to)) return;
      const t0 = performance.now(), dur = 750;
      const step = t => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = (to * e).toFixed(dec);
        if (k < 1) requestAnimationFrame(step);
      };
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(step);
      setTimeout(() => { el.textContent = to.toFixed(dec); }, dur + 60); // never strand a half-counted number
    });
  }
  const num = (v, dec, cls) => h("span", { class: cls || null, "data-count": v != null && isFinite(v) ? v : null, "data-dec": dec || 0 },
    v == null || !isFinite(v) ? "—" : (+v).toFixed(dec || 0));

  /* =================================================================
     state
     ================================================================= */
  const KEY = "setpoint.v2", OLD_KEY = "setpoint.v1";
  function blank() {
    return {
      v: 2,
      profile: { sex: "m", age: 35, heightCm: 172, activity: 1.45 },
      goal: { mode: "loss", ratePct: 0.6, goalWeight: null, startWeight: null, startDate: null, proteinMode: "lbm", proteinPerKg: 2.2, fatPerKg: 0.8, weekendPct: 0 },
      settings: { kcalPerKg: 7700, alpha: 0.25, theme: "system", dash: "remaining", demo: false, lastExport: null,
        estimator: "kalman", rho: "auto", backupDays: 7, voice: true, sound: true },
      weights: {}, intake: {}, fasted: {}, custom: [], meals: [], health: {}, meta: { u: {}, tomb: {} }, program: { checkins: [] },
      train: { profile: null, plan: null, log: [], active: null }
    };
  }
  let S = blank();
  let CACHE = {};
  function invalidate() { CACHE = {}; }
  let SNAP = null;          // record hashes as of the last save, for change tracking
  function persist() {
    invalidate();
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage blocked: keep going in memory */ }
  }
  function save() {
    SNAP = Y.stamp(S, SNAP);
    persist();
    scheduleSync();
  }
  function merge(p) {
    const b = blank();
    return Object.assign(b, p, {
      profile: Object.assign(b.profile, p.profile), goal: Object.assign(b.goal, p.goal),
      settings: Object.assign(b.settings, p.settings), fasted: p.fasted || {}, custom: p.custom || [], meals: p.meals || [],
      health: p.health || {}, meta: p.meta && p.meta.u ? p.meta : { u: {}, tomb: {} },
      program: p.program && p.program.checkins ? p.program : { checkins: [] },
      train: Object.assign(b.train, p.train || {})
    });
  }
  function migrateV1(p) {
    const n = blank();
    n.profile = Object.assign(n.profile, p.profile);
    const g = p.goal || {};
    const rate = g.rateMode === "kg" && p.weights ? null : g.ratePct;
    n.goal.mode = rate == null ? "loss" : rate < 0 ? "loss" : rate > 0 ? "gain" : "maintain";
    n.goal.ratePct = Math.abs(rate ?? 0.6) || 0.6;
    ["proteinMode", "proteinPerKg", "fatPerKg", "weekendPct"].forEach(k => { if (g[k] != null) n.goal[k] = g[k]; });
    n.settings.kcalPerKg = p.settings?.kcalPerKg || 7700;
    n.settings.alpha = p.settings?.alpha || 0.25;
    n.weights = p.weights || {};
    n.custom = (p.custom || []).map(f => Object.assign({ tag: "custom" }, f));
    for (const d in p.intake || {}) n.intake[d] = p.intake[d].map(e => {
      const q = e.qty || 1;
      return { id: uid(), name: e.name, unit: e.unit || "serving", g: 0, qty: q,
        base: { kcal: e.kcal / q, p: e.p / q, f: e.f / q, c: e.c / q }, kcal: e.kcal, p: e.p, f: e.f, c: e.c, t: e.t || "12:00" };
    });
    return n;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const p = JSON.parse(raw); if (p && p.v === 2) { S = merge(p); SNAP = Y.hashes(S); return true; } }
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        const p = JSON.parse(old);
        if (p && p.v === 1 && !p.settings?.demo) { S = migrateV1(p); save(); return true; }
      }
    } catch (e) { }
    return false;
  }

  /* Four weeks of plausible hawker-heavy logging, internally consistent with
     a true expenditure of 2750 kcal, plus three past weekly check-ins. */
  function seedDemo() {
    S = blank();
    const TRUE = 2600, kpk = 7700;
    let seed = 0x5E7;
    const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const byName = n => FOODS.find(f => f.n === n);
    const B = ["Kaya toast set, 2 eggs", "Roti prata, plain", "Chwee kueh, 6 pc", "Greek yoghurt, 0%", "Soft-boiled eggs, 2"];
    const L = ["Chicken rice, steamed", "Economy rice, 1 meat 2 veg", "Fishball noodle, soup", "Yong tau foo, mixed items, no noodles", "Sliced fish soup with rice", "Bak chor mee, dry", "Wanton mee, dry"];
    const D = ["Economy rice, 2 meat 1 veg", "Chicken breast, cooked", "Ban mian, soup", "Duck rice, braised", "Salmon, cooked", "Char siew rice", "Beef kway teow, soup"];
    const K = ["Kopi O kosong", "Kopi siew dai", "Teh C kosong"];
    const XS = ["Banana, medium", "Whey protein", "Curry puff, chicken", "Bubble tea, 25% sugar", "Kaya toast, 2 slices"];
    const K2 = ["Teh C", "Kopi", "Soya bean milk", "Barley, sweetened", "Kopi siew dai"];
    const N = ["Whey protein", "Min jiang kueh", "Roti prata, egg", "Greek yoghurt, 0%", "Soya bean milk", "Otah"];
    let w = 88.4;
    const first = addDays(today(), -27);
    for (let i = 0; i < 28; i++) {
      const d = addDays(first, i);
      const rows = [];
      const add = (name, hr, qty) => {
        const f = byName(name); if (!f) return;
        qty = qty || 1;
        rows.push({ id: uid(), name: f.n, unit: f.unit, g: f.g, qty, base: { kcal: f.kcal, p: f.p, f: f.f, c: f.c },
          kcal: r0(f.kcal * qty), p: r1(f.p * qty), f: r1(f.f * qty), c: r1(f.c * qty), t: pad2(hr) + ":" + pad2(Math.floor(rnd() * 4) * 15) });
      };
      const b = pick(B); add(b, 8, b === "Roti prata, plain" ? 2 : b === "Greek yoghurt, 0%" ? 2 : 1);
      add(pick(K), 8); add(pick(L), 12); add(pick(K2), 12);
      if (rnd() > 0.5) add(pick(["Otah", "Popiah"]), 12);
      add(pick(K), 15); add(pick(XS), 16);
      const dn = pick(D);
      if (dn === "Chicken breast, cooked" || dn === "Salmon, cooked") { add(dn, 19, 1.5); add("Rice, white, 1 bowl", 19); add("Leafy greens, cooked", 19, 1.5); }
      else add(dn, 19);
      add(pick(N), 21);
      if (isWeekend(d) && rnd() > 0.4) add("Beer, 5%", 21, 2);
      const total = rows.reduce((s, r) => s + r.kcal, 0);
      const logged = rnd() > 0.07;
      if (logged) S.intake[d] = rows;
      if (rnd() > 0.1) {
        const noise = (rnd() + rnd() + rnd() - 1.5) * 0.6;
        S.weights[d] = { kg: r1(w + noise), bf: i % 5 === 1 ? r1(32.6 - i * 0.03 + (rnd() - 0.5)) : null, mm: null };
      }
      w += ((logged ? total : 2300) - TRUE) / kpk;
    }
    S.goal = Object.assign(S.goal, { mode: "loss", ratePct: 0.6, goalWeight: 72, startWeight: 88.4, startDate: first });
    for (const back of [21, 14, 7]) {
      invalidate();
      const c = E.makeCheckin(S, addDays(today(), -back));
      if (c) S.program.checkins.push(c);
    }
    S.meals = [{ id: uid(), name: "Kopitiam breakfast", items: [
      { n: "Kaya toast set, 2 eggs", kcal: 430, p: 15, f: 22, c: 42, unit: "set", g: 260, qty: 1 },
      { n: "Kopi siew dai", kcal: 90, p: 2, f: 3, c: 14, unit: "cup", g: 200, qty: 1 }] }];
    TR.seed(rnd);
    S.settings.demo = true;
    save();
  }

  /* =================================================================
     memoised lookups (cleared on every save)
     ================================================================= */
  function trendSer() { return CACHE.ts || (CACHE.ts = E.trendSeries(S)); }
  function expAt(d) {
    const m = CACHE.exp || (CACHE.exp = new Map());
    if (!m.has(d)) {
      if (S.settings.estimator === "window") m.set(d, E.estimateWindow(S, d));
      else {
        if (!("kal" in CACHE)) CACHE.kal = E.kalmanRun(S, today());
        m.set(d, E.packageKalman(S, CACHE.kal, d));
      }
    }
    return m.get(d);
  }
  function tgtFor(d) {
    const m = CACHE.tg || (CACHE.tg = new Map());
    if (!m.has(d)) m.set(d, E.targetsFor(S, d));
    return m.get(d);
  }
  function trendMap() {
    if (CACHE.tm) return CACHE.tm;
    const m = {}; trendSer().forEach(p => m[p.date] = p); return (CACHE.tm = m);
  }
  function firstDataDate() {
    const ks = Object.keys(S.weights).concat(Object.keys(S.intake)).sort();
    return ks[0] || today();
  }

  /* =================================================================
     theme
     ================================================================= */
  const mqDark = matchMedia("(prefers-color-scheme: dark)");
  function isDark() { return S.settings.theme === "dark" || (S.settings.theme === "system" && mqDark.matches); }
  function applyTheme() {
    const t = S.settings.theme, root = document.documentElement;
    if (t === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
    const m = $('meta[name="theme-color"]:not([media])');
    if (m) m.setAttribute("content", isDark() ? "#111213" : "#F2F2F4");
  }
  mqDark.addEventListener && mqDark.addEventListener("change", () => { applyTheme(); render(false); });

  /* =================================================================
     routing
     ================================================================= */
  let TAB = "dash", STACK = [], SEL = today(), RANGE = {}, CALM = today().slice(0, 7);
  function go(tab) { TAB = tab; STACK = []; closeSheet(true); window.scrollTo(0, 0); render(true); }
  function push(scr) {
    STACK.push(scr);
    try { history.pushState({ d: STACK.length }, ""); } catch (e) { }
    window.scrollTo(0, 0); render(true);
  }
  function back() { if (!STACK.length) return; try { history.back(); } catch (e) { STACK.pop(); render(true); } }
  window.addEventListener("popstate", () => {
    closeSheet(true);
    if (STACK.length) { STACK.pop(); render(true); }
  });

  function render(anim) {
    const app = $("#app");
    app.classList.toggle("no-anim", !anim);
    const y = window.scrollY;
    app.innerHTML = "";
    const top = STACK[STACK.length - 1];
    const v = top ? SCREENS[top.v](top) : ({ dash: viewDash, log: viewLog, train: TR.viewTrain, strategy: viewStrategy, more: viewMore }[TAB])();
    if (anim) v.classList.add("view");
    app.appendChild(v);
    const dock = !top && (TAB === "dash" || TAB === "log");
    $("#dock").hidden = !dock;
    app.classList.toggle("no-search", !dock);
    renderNav();
    if (anim) countUps(app); else window.scrollTo(0, y);
    if (v._after) v._after(anim);
  }

  function renderNav() {
    const n = $("#navInner"); n.innerHTML = "";
    const due = E.checkinStatus(S).due && S.program.checkins.length + Object.keys(S.weights).length > 0;
    const item = (id, label, icon, badge) => h("button", {
      "aria-current": TAB === id && !STACK.length ? "page" : null,
      onclick: () => (TAB === id && !STACK.length) ? window.scrollTo({ top: 0, behavior: "smooth" }) : go(id)
    }, h("span", { class: "ico", html: svg(I[icon]) }, badge ? h("span", { class: "badge" }, "!") : null), label);
    n.append(
      item("dash", "Dashboard", "dash"),
      item("log", "Food Log", "log"),
      item("train", "Train", "train", !!(S.train && S.train.active)),
      item("strategy", "Strategy", "strat", due),
      item("more", "More", "more")
    );
  }

  /* =================================================================
     shared components
     ================================================================= */
  function head(title, ...btns) { return h("div", { class: "head" }, h("h1", null, title), ...btns); }
  function subhead(title, right) {
    return h("div", { class: "head sub" },
      h("button", { class: "back", "aria-label": "Back", html: svg(I.back), onclick: back }),
      h("h1", null, title),
      right || h("div", { style: { width: "40px" } }));
  }
  function iconBtn(icon, label, onclick, cls) { return h("button", { class: "icon-btn " + (cls || ""), "aria-label": label, html: svg(I[icon]), onclick }); }
  function section(title, linkText, onLink) {
    return h("div", { class: "section" }, h("h2", null, title), linkText ? h("button", { class: "link", onclick: onLink }, linkText) : null);
  }
  function seg(opts, active, onPick, cls) {
    const n = opts.length;
    const el = h("div", { class: "seg " + (cls || ""), role: "tablist" });
    const thumb = h("i", { class: "thumb" });
    const place = i => { thumb.style.left = `calc(3px + ${i} * (100% - 6px) / ${n})`; thumb.style.width = `calc((100% - 6px) / ${n})`; };
    place(active); el.appendChild(thumb);
    opts.forEach((o, i) => el.appendChild(h("button", {
      class: i === active ? "on" : null, role: "tab", "aria-selected": i === active ? "true" : "false",
      onclick: () => {
        el.querySelectorAll("button").forEach((b, j) => { b.classList.toggle("on", j === i); b.setAttribute("aria-selected", j === i); });
        place(i); onPick(i);
      }
    }, o)));
    return el;
  }
  function flags(list) { return (list || []).map(f => h("div", { class: "flag " + f.t }, h("i"), h("div", null, f.msg))); }
  function kv(a, b) { return h("div", { class: "kv" }, h("span", null, a), h("span", null, b)); }
  function tile(title, sub, chartEl, value, unit, onclick) {
    return h("button", { class: "tile", onclick },
      h("h3", null, title), h("div", { class: "sub" }, sub),
      h("div", { class: "spk" }, chartEl),
      h("div", { class: "foot" }, h("b", null, value), h("span", null, unit), h("span", { html: svg(I.chev), style: { flex: "none" } })));
  }
  const tileW = () => Math.floor((CW() - 12) / 2 - 32);
  const MAC = [
    { k: "kcal", label: "Calories", short: "", unit: "kcal", color: "var(--kcal)" },
    { k: "p", label: "Protein", short: "P", unit: "g", color: "var(--pro)" },
    { k: "f", label: "Fat", short: "F", unit: "g", color: "var(--fat)" },
    { k: "c", label: "Carbs", short: "C", unit: "g", color: "var(--carb)" }
  ];

  /* =================================================================
     DASHBOARD
     ================================================================= */
  function viewDash() {
    const root = h("div");
    root.append(head("Dashboard",
      iconBtn(isDark() ? "sun" : "moon", "Switch theme", () => {
        S.settings.theme = isDark() ? "light" : "dark"; save(); applyTheme(); render(false);
      })));

    if (S.settings.demo) root.append(h("div", { class: "banner" },
      h("span", null, "You're looking at 4 weeks of example data."),
      h("button", { onclick: startFresh }, "Start fresh")));
    else if (needsBackupNudge()) root.append(h("div", { class: "banner" },
      h("span", null, S.settings.lastExport ? `Last backup ${dShort(S.settings.lastExport)}. Your data lives only in this browser.` : "No backup yet. Your data lives only in this browser."),
      h("button", { onclick: () => shareBackup() }, "Back up now")));

    const ready = !!tgtFor(SEL);
    if (!ready) {
      root.append(h("div", { class: "card" },
        h("h3", { style: { margin: "0 0 6px", fontSize: "20px" } }, "Set up your targets"),
        h("p", { class: "note", style: { marginTop: 0 } }, "Setpoint needs your profile and one weigh-in to give you a starting target. After two weeks of logging it measures your real expenditure and adjusts."),
        h("div", { class: "btnrow", style: { marginTop: "14px" } },
          h("button", { class: "btn primary", onclick: () => push({ v: "profile" }) }, "Profile"),
          h("button", { class: "btn", onclick: () => weighSheet() }, "Log weigh-in"))));
    }

    // weekly nutrition band
    const band = h("div", { class: "band" });
    band.append(h("div", { class: "section", style: { marginTop: 0 } }, h("h2", null, "Weekly Nutrition")));
    let grid = weeklyGrid(false);
    band.append(grid);
    band.append(seg(["Consumed", "Remaining"], S.settings.dash === "consumed" ? 0 : 1, i => {
      S.settings.dash = i ? "remaining" : "consumed"; save();
      const g2 = weeklyGrid(true); grid.replaceWith(g2); grid = g2; countUps(g2);
    }, "center"));
    root.append(band);

    // insights
    root.append(section("Insights & Analytics"));
    const days7 = E.range(addDays(today(), -6), today());
    const tw = tileW();
    const exps = days7.map(d => { const e = expAt(d); return e.kcal; });
    const expNow = expAt(today());
    const tm = trendMap();
    const trend7 = days7.map(d => tm[d] ? tm[d].trend : null);
    const trNow = E.trendAt(S, today(), trendSer());
    const bal = days7.map(d => { const k = E.dayKcal(S, d), e = expAt(d).kcal; return k == null || e == null ? null : k - e; });
    const balV = bal.filter(v => v != null);
    const balAvg = balV.length ? balV.reduce((a, b) => a + b, 0) / balV.length : null;
    const gp = E.goalProgress(S);

    root.append(h("div", { class: "tiles" },
      tile("Expenditure", "Last 7 Days",
        C.spark({ w: tw, h: 58, xs: days7, series: [{ data: exps, color: "var(--exp)", nodes: true, w: 2 }] }),
        num(expNow.kcal), "kcal", () => push({ v: "detail", kind: "exp" })),
      tile("Weight Trend", "Last 7 Days",
        C.spark({ w: tw, h: 58, xs: days7, series: [{ data: trend7, color: "var(--wt)", nodes: true, w: 2 }] }),
        trNow ? num(trNow.trend, 1) : "—", "kg", () => push({ v: "detail", kind: "weight" })),
      tile("Energy Balance", "Last 7 Days",
        C.spark({ w: tw, h: 58, xs: days7, zero: 0, series: [{ type: "bars", data: bal, colorFn: v => v < 0 ? "var(--kcal)" : "var(--pro)" }] }),
        balAvg == null ? "—" : num(Math.abs(balAvg)), balAvg == null ? "kcal" : balAvg < 0 ? "kcal deficit" : "kcal surplus",
        () => push({ v: "detail", kind: "balance" })),
      tile("Goal Progress", gp ? `Since ${dShort(S.goal.startDate || firstDataDate())}` : "No goal weight",
        h("div", { class: "meter" }, h("i", { style: { width: `${(gp ? gp.pct : 0) * 100}%` } })),
        gp ? num(gp.pct * 100) : "—", "%", () => go("strategy"))
    ));

    // body metrics
    root.append(section("Body Metrics", "See All", () => push({ v: "body" })));
    const wk = Object.keys(S.weights).sort().slice(-7);
    const bfk = Object.keys(S.weights).filter(k => S.weights[k].bf != null).sort().slice(-7);
    const lastW = E.latestWeight(S), lastBf = bfk.length ? S.weights[bfk[bfk.length - 1]].bf : null;
    root.append(h("div", { class: "tiles" },
      tile("Scale Weight", "Last 7 Entries",
        C.spark({ w: tw, h: 58, xs: wk, series: [{ type: "dots", data: wk.map(k => S.weights[k].kg), color: "var(--wt)", opacity: 1, r: 3.4 }] }),
        lastW ? num(lastW.kg, 1) : "—", "kg", () => push({ v: "detail", kind: "weight" })),
      tile("Body Fat", "Last 7 Entries",
        C.spark({ w: tw, h: 58, xs: bfk, series: [{ type: "dots", data: bfk.map(k => S.weights[k].bf), color: "var(--bfc)", opacity: 1, r: 3.4 }] }),
        lastBf != null ? num(lastBf, 1) : "—", "%", () => push({ v: "detail", kind: "bf" }))
    ));

    // Apple Health + sync
    const hs = days7.map(d => (S.health[d] || {}).steps ?? null);
    if (hs.some(v => v != null) || SC.enabled) {
      const lastSteps = [...hs].reverse().find(v => v != null);
      root.append(h("div", { class: "tiles", style: { marginTop: "12px" } },
        tile("Steps", "From Apple Health", C.spark({ w: tw, h: 58, xs: days7, zero: 0, series: [{ type: "bars", data: hs, colorFn: () => "var(--carb)" }] }),
          lastSteps != null ? num(lastSteps) : "—", "steps", () => push({ v: "sync" })),
        h("button", { class: "tile", onclick: () => push({ v: "sync" }) }, h("h3", null, "Sync"), h("div", { class: "sub" }, "Encrypted"),
          h("div", { class: "spk", html: `<div class="syncbig" data-state="${!SC.enabled ? "off" : SC.lastErr ? "err" : "ok"}">${svg(I.sync)}</div>` }),
          h("div", { class: "foot" }, h("span", { "data-syncstatus": "", style: { color: "var(--text)", fontSize: "14.5px", whiteSpace: "normal" } }, syncLabel())))));
    }

    // nutrition today
    root.append(section("Nutrition", "See All", () => push({ v: "detail", kind: "kcal" })));
    const tot = E.dayTotals(S, SEL), tg = tgtFor(SEL);
    root.append(h("div", { class: "tiles" }, MAC.map(m => {
      const v = tot[m.k], t = tg ? tg[m.k] : null;
      const pct = t ? clamp(v / t, 0, 1.25) : 0;
      return tile(m.label, SEL === today() ? "Today" : dShort(SEL),
        h("div", { class: "meter", style: { height: "22px" } },
          h("i", { style: { width: `${Math.min(100, pct / 1.25 * 100)}%`, background: v > (t || Infinity) * 1.03 ? "var(--bad)" : m.color } }),
          t ? h("span", { class: "tick", style: { left: `${100 / 1.25}%` } }) : null),
        num(v), m.unit, () => push({ v: "detail", kind: m.k }));
    })));

    // training
    root.append(section("Training", "Open", () => go("train")));
    root.append(h("div", { class: "tiles" }, TR.dashTiles(tw)));

    // habits
    root.append(section("Habits", "Calendar", () => push({ v: "calendar" })));
    const st = E.streak(S);
    const last30 = E.range(addDays(today(), -29), today()).filter(d => E.isTracked(S, d)).length;
    root.append(h("div", { class: "tiles" },
      tile("Logging Streak", "Consecutive days", h("div", { html: flame("var(--pro)"), style: { width: "40px", height: "40px" } }), num(st), st === 1 ? "day" : "days", () => push({ v: "calendar" })),
      tile("Days Tracked", "Last 30 days",
        h("div", { class: "meter" }, h("i", { style: { width: `${last30 / 30 * 100}%`, background: "var(--kcal)" } })),
        num(last30), "of 30", () => push({ v: "calendar" }))
    ));
    return root;
  }

  function weeklyGrid(force) {
    const ws = weekStart(SEL), days = E.range(ws, addDays(ws, 6)), t0 = today();
    const mode = S.settings.dash;
    const g = h("div", { class: "wgrid" + (force ? " force-anim" : "") });
    const selIdx = days.indexOf(SEL);
    g.append(h("div", { class: "sel", style: { gridColumn: String(selIdx + 1), gridRow: "1 / span 5" } }));
    MAC.forEach((m, r) => {
      days.forEach((d, c) => {
        const tg = tgtFor(d), tot = E.dayTotals(S, d), tv = tg ? tg[m.k] : null, v = tot[m.k];
        const future = d > t0, tracked = E.isTracked(S, d);
        let frac = 0, cls = "slot";
        if (tv) {
          if (mode === "consumed") frac = clamp(v / tv, 0, 1);
          else frac = future || !tracked ? 1 : clamp((tv - v) / tv, 0, 1);
          if (v > tv * 1.03) cls += " over";
        }
        if (future || (!tracked && d < t0)) cls += " empty";
        g.append(h("div", { class: "cell", style: { gridColumn: String(c + 1), gridRow: String(r + 1) } },
          h("div", { class: cls }, h("i", { class: "cap" }),
            h("i", { class: "bar", style: { "--v": frac, "--d": c + r * 2, background: m.color } }))));
      });
      if (r < 3) g.append(h("div", { class: "row-line", style: { gridRow: String(r + 1) } }));
      const tg = tgtFor(SEL), tot = E.dayTotals(S, SEL);
      const tv = tg ? tg[m.k] : null, v = tot[m.k];
      const shown = mode === "consumed" ? v : tv != null ? tv - v : null;
      g.append(h("div", { class: "val", style: { gridColumn: "8", gridRow: String(r + 1) } },
        h("div", { class: "big" + (shown != null && shown < 0 ? " neg" : "") }, num(shown),
          m.k === "kcal" ? h("span", { html: flame() }) : h("span", null, " " + m.short)),
        h("div", { class: "of" }, tv != null ? `of ${f0(tv)}` : "no target")));
    });
    days.forEach((d, c) => {
      g.append(h("div", { class: "day" + (d === SEL ? " on" : ""), style: { gridColumn: String(c + 1), gridRow: "5" } }, DOW1[E.weekday(d)]));
      g.append(h("button", { class: "col-hit", "aria-label": dLong(d), style: { gridColumn: String(c + 1), gridRow: "1 / span 5" },
        onclick: () => { SEL = d; render(false); } }));
    });
    return g;
  }

  function needsBackupNudge() {
    const n = Object.keys(S.intake).length + Object.keys(S.weights).length;
    if (n < 5 || !S.settings.backupDays) return false;
    if (!S.settings.lastExport) return true;
    return daysBetween(S.settings.lastExport, today()) >= S.settings.backupDays;
  }
  function startFresh() {
    const keepTheme = S.settings.theme;
    S = blank(); S.settings.theme = keepTheme; save(); SEL = today();
    TAB = "dash"; STACK = [];
    push({ v: "profile", onboarding: true });
    toast("Example data cleared");
  }

  /* =================================================================
     FOOD LOG
     ================================================================= */
  function viewLog() {
    const root = h("div");
    const title = SEL === today() ? "Today" : SEL === addDays(today(), -1) ? "Yesterday" : `${DOW[E.weekday(SEL)]} ${E.parse(SEL).getDate()}`;
    root.append(head(title,
      iconBtn("cal", "Logging calendar", () => push({ v: "calendar" })),
      iconBtn("dots", "Day options", e => dayMenu(e.currentTarget))));

    // week strip with swipe between weeks
    const ws = weekStart(SEL), t0 = today();
    const strip = h("div", { class: "daystrip" }, E.range(ws, addDays(ws, 6)).map(d => h("button", {
      class: "daypill" + (d === SEL ? " on" : "") + (d === t0 ? " today" : "") + (E.isTracked(S, d) && d !== SEL ? " tracked" : "") + (d > t0 ? " future" : ""),
      onclick: () => { SEL = d; render(false); }
    }, h("b", null, E.parse(d).getDate()), h("span", null, DOW[E.weekday(d)].slice(0, 2)), h("i"))));
    let sx = null;
    strip.addEventListener("pointerdown", e => { sx = e.clientX; });
    strip.addEventListener("pointerup", e => {
      if (sx == null) return; const dx = e.clientX - sx; sx = null;
      if (Math.abs(dx) > 60) {
        let n = addDays(SEL, dx < 0 ? 7 : -7);
        if (n > t0) n = t0;
        if (n !== SEL) { SEL = n; render(true); }
      }
    });
    root.append(strip);

    // macro strip (tap toggles consumed / remaining)
    const tot = E.dayTotals(S, SEL), tg = tgtFor(SEL), mode = S.settings.dash;
    root.append(h("div", { class: "mstrip", role: "button", tabindex: "0", title: "Tap to switch consumed / remaining",
      onclick: () => { S.settings.dash = mode === "consumed" ? "remaining" : "consumed"; save(); render(false); } },
      MAC.map(m => {
        const v = tot[m.k], t = tg ? tg[m.k] : null;
        const shown = mode === "consumed" ? v : t != null ? t - v : null;
        return h("div", { class: "m" },
          h("div", { class: "t" }, m.k === "kcal" ? h("span", { html: flame(), style: { color: "var(--text)" } }) : h("b", { style: { color: m.color } }, m.short),
            h("b", { style: { color: shown != null && shown < 0 ? "var(--bad)" : null } }, f0(shown))),
          h("div", { class: "o" }, mode === "consumed" ? `of ${f0(t)}` : `left of ${f0(t)}`),
          h("div", { class: "thin" }, h("i", { style: { width: `${t ? clamp(v / t, 0, 1) * 100 : 0}%`, background: v > (t || Infinity) * 1.03 ? "var(--bad)" : m.color } })));
      })));

    if (S.fasted[SEL]) root.append(h("div", { class: "flag", style: { marginTop: "16px" } }, h("i"), h("div", null, "Marked as a fasting day: counted as tracked with zero calories. ",
      h("button", { class: "link", style: { fontSize: "15px" }, onclick: () => { delete S.fasted[SEL]; save(); render(false); } }, "Undo"))));

    // timeline
    const rows = (S.intake[SEL] || []).slice().sort((a, b) => a.t.localeCompare(b.t));
    const byHour = {};
    rows.forEach(e => { const hr = parseInt(e.t, 10); (byHour[hr] = byHour[hr] || []).push(e); });
    const hrs = Object.keys(byHour).map(Number);
    const lo = Math.min(6, ...hrs), hi = Math.max(22, ...hrs);
    const nowH = new Date().getHours();
    const tl = h("div", { class: "timeline" });
    for (let hr = lo; hr <= hi; hr++) {
      const items = byHour[hr] || [];
      tl.append(h("div", { class: "hour" + (SEL === t0 && hr === nowH ? " now" : ""), "data-h": hr },
        h("div", { class: "hp" }, hourLabel(hr)),
        h("div", { class: "items" },
          items.map(e => h("button", { class: "entry", onclick: () => entrySheet(e) },
            h("div", { class: "n" }, e.name),
            h("div", { class: "q" }, e.grams ? `${e.grams} g` : `${qtyTxt(e.qty)} ${e.unit}`),
            h("div", { class: "k" }, f0(e.kcal), h("small", null, "kcal")),
            h("div", { class: "mac" },
              h("span", null, h("b", { class: "dotp" }, f0(e.p)), " P"),
              h("span", null, h("b", { class: "dotf" }, f0(e.f)), " F"),
              h("span", null, h("b", { class: "dotc" }, f0(e.c)), " C")))),
          h("div", { class: "hrow" },
            h("button", { class: "add", "aria-label": "Add food at " + hourLabel(hr), html: svg(I.plus), onclick: () => logSheet({ hour: hr }) }),
            items.length >= 2 ? h("button", { class: "mini", onclick: () => mealForm(items) }, "Save as meal") : null))));
    }
    root.append(tl);
    root._after = anim => {
      if (anim && SEL === t0) {
        const el = $(`.hour[data-h="${Math.max(lo, nowH - 1)}"]`);
        if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 180 });
      }
    };
    return root;
  }

  function dayMenu() {
    const y = addDays(SEL, -1);
    openMenu([
      S.intake[y] ? ["copy", `Copy ${SEL === today() ? "yesterday" : dShort(y)}`, () => { copyDay(y, SEL); }] : null,
      ["moonfast", S.fasted[SEL] ? "Unmark fasting day" : "Mark as fasting day", () => {
        if (S.fasted[SEL]) delete S.fasted[SEL]; else { S.fasted[SEL] = true; }
        save(); render(false);
      }],
      (S.intake[SEL] || []).length ? ["trash", "Clear this day", () => confirmSheet("Clear this day?", `Removes all ${S.intake[SEL].length} entries for ${dLong(SEL)}.`, "Clear day", () => { delete S.intake[SEL]; save(); render(false); toast("Day cleared"); })] : null
    ]);
  }
  function copyDay(from, to) {
    const rows = (S.intake[from] || []).map(e => Object.assign({}, e, { id: uid(), base: Object.assign({}, e.base) }));
    S.intake[to] = (S.intake[to] || []).concat(rows); delete S.fasted[to]; save(); render(false);
    toast(`Copied ${rows.length} entries`);
  }

  /* =================================================================
     STRATEGY
     ================================================================= */
  function viewStrategy() {
    const root = h("div");
    root.append(head("Strategy", iconBtn("dots", "Strategy options", e => openMenu([
      ["target", "Edit goal", () => goalSheet()],
      ["sliders", "Edit program", () => push({ v: "program" })],
      ["reset", "Check in now", () => checkinSheet(true)]
    ]))));

    const st = E.checkinStatus(S), ready = E.computeTargets(S).ready;
    // check-in hero
    const wrap = h("div", { class: "checkin-wrap" });
    const circ = h("div", { class: "checkin" + (st.due && ready ? " due" : "") });
    const R = 46, L = 2 * Math.PI * R;
    const prog = st.due ? 1 : (st.daysSince || 0) / 7;
    circ.append(h("div", { class: "ring", html: `<svg viewBox="0 0 100 100" class="ring"><circle cx="50" cy="50" r="${R}" fill="none" class="track" stroke-width="3"/><circle cx="50" cy="50" r="${R}" fill="none" class="prog" stroke-width="3" transform="rotate(-90 50 50)" stroke-dasharray="${L}" stroke-dashoffset="${L}" data-to="${L * (1 - prog)}"/></svg>` }));
    if (!ready) circ.append(h("button", { class: "core idle", onclick: () => push({ v: "profile" }) }, h("b", { style: { fontSize: "30px" } }, "SET UP"), h("span", null, "profile & weigh-in")));
    else if (st.due) circ.append(h("button", { class: "core", onclick: () => checkinSheet() }, h("b", null, "CHECK IN"), h("span", null, "it's time")));
    else circ.append(h("button", { class: "core idle", onclick: () => checkinSheet(true) }, h("b", null, st.daysLeft + "d"), h("span", null, "until check-in")));
    wrap.append(circ);
    root.append(wrap);
    root._after = () => {
      const p = root.querySelector(".prog");
      if (p) requestAnimationFrame(() => requestAnimationFrame(() => p.setAttribute("stroke-dashoffset", p.dataset.to)));
    };

    const last = E.lastCheckin(S);
    root.append(section("In Progress"));
    // program card
    const pc = h("div", { class: "card" });
    pc.append(h("h3", { style: { margin: 0, fontSize: "21px", fontWeight: 600 } }, "Current Program"),
      h("div", { class: "muted", style: { fontSize: "16px" } }, last ? `${dShort(last.date)} – Now` : "Not started"));
    if (last) pc.append(programCols(last.weekday, last.weekend));
    else pc.append(h("p", { class: "note" }, "Your first check-in locks in a program. Targets then hold steady for a week, and each check-in updates them from what the scale and your log actually did."));
    pc.append(h("div", { class: "btnrow", style: { marginTop: "18px" } },
      h("button", { class: "btn", html: svg(I.reset) + "New Program", onclick: () => confirmSheet("Start a new program?", "Clears your check-in history. Your weigh-ins and food log are kept. You'll check in again straight away to set fresh targets.", "Start new", () => { S.program.checkins = []; save(); render(true); }) }),
      h("button", { class: "btn", html: svg(I.edit) + "Edit Program", onclick: () => push({ v: "program" }) })));
    root.append(pc);

    // goal card
    const g = S.goal, gp = E.goalProgress(S);
    const rate = last ? last.rateKgWk : null;
    const gc = h("div", { class: "card" });
    gc.append(h("h3", { style: { margin: 0, fontSize: "21px", fontWeight: 600 } },
      g.mode === "loss" ? "Weight Loss Goal" : g.mode === "gain" ? "Weight Gain Goal" : "Maintenance"),
      h("div", { class: "muted", style: { fontSize: "16px", marginBottom: "16px" } }, g.startDate ? `${dShort(g.startDate)} – Now` : "No start date"),
      h("div", { class: "stats3" },
        h("div", { class: "stat" }, h("b", null, g.goalWeight ? f1(g.goalWeight) : "—", h("small", null, "kg")), h("span", null, "Goal Weight")),
        h("div", { class: "stat" }, h("b", null, rate != null ? (rate > 0 ? "+" : rate < 0 ? "−" : "") + Math.abs(rate).toFixed(2) : "—", h("small", null, "kg")), h("span", null, "Per Week")),
        h("div", { class: "stat" }, h("b", null, last ? (last.ratePctWk > 0 ? "+" : last.ratePctWk < 0 ? "−" : "") + Math.abs(last.ratePctWk).toFixed(1) : "—", h("small", null, "%")), h("span", null, "Per Week"))));
    if (gp) {
      gc.append(h("div", { class: "divider" }),
        h("div", { class: "meter", style: { height: "12px", borderRadius: "6px" } }, h("i", { style: { width: `${gp.pct * 100}%`, borderRadius: "6px" } })),
        h("div", { style: { display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "15px" }, class: "muted" },
          h("span", null, `${f1(gp.start)} kg`), h("span", null, `${r0(gp.pct * 100)}% · now ${f1(gp.current)} kg`), h("span", null, `${f1(gp.goal)} kg`)),
        h("p", { class: "note" }, gp.eta ? `At the programmed rate you reach ${f1(gp.goal)} kg around ${dLong(gp.eta)}.` : "At the current rate the goal isn't getting closer."));
      const ib = E.impliedBf(S, g.goalWeight);
      const floor = S.profile.sex === "m" ? 8 : 15;
      if (ib != null && ib < floor) {
        const fe = E.goalFeasibility(S);
        const sane = fe.ffm / (1 - (S.profile.sex === "m" ? 0.15 : 0.23));
        gc.append(h("div", { class: "flag bad", style: { marginTop: "12px" } }, h("i"),
          h("div", null, `Even keeping every kilogram of lean mass, ${f1(g.goalWeight)} kg works out to about ${Math.max(0, r0(ib))}% body fat. That isn't reachable. ${f1(sane)} kg (${S.profile.sex === "m" ? 15 : 23}%) is a realistic target.`)));
      }
    }
    gc.append(h("div", { class: "btnrow", style: { marginTop: "18px" } },
      h("button", { class: "btn", html: svg(I.plus) + "New Goal", onclick: () => goalSheet(true) }),
      h("button", { class: "btn", html: svg(I.edit) + "Edit Goal", onclick: () => goalSheet() })));
    root.append(h("div", { style: { height: "12px" } }), gc);

    if (last && last.flags && last.flags.length) root.append(h("div", { style: { marginTop: "12px" } }, flags(last.flags)));

    // history
    const cs = S.program.checkins.slice().reverse();
    if (cs.length) {
      root.append(section("Check-in History"));
      root.append(h("div", { class: "card" }, cs.map(c => h("div", { class: "hist" },
        h("div", { class: "d" }, dLong(c.date)),
        h("div", { class: "w" }, `${f1(c.trendKg)} kg`, c.delta && c.delta.trendKg != null ? h("span", { class: "muted", style: { fontSize: "15px", fontWeight: 400, marginLeft: "8px" } }, `${c.delta.trendKg > 0 ? "+" : ""}${c.delta.trendKg.toFixed(1)}`) : null),
        h("div", { class: "r" }, h("b", null, `${c.kcal} kcal`), `exp ${c.exp}${c.se ? " ± " + c.se : ""}`)))));
    }
    return root;
  }

  function programCols(wd, we, hilite) {
    const ws = weekStart(today()), t0 = today();
    const max = Math.max(wd.kcal, we.kcal);
    const H = 210;
    return h("div", { class: "program" }, E.range(ws, addDays(ws, 6)).map((d, i) => {
      const t = isWeekend(d) ? we : wd, scale = t.kcal / max;
      const pk = t.p * 4, fk = t.f * 9, ck = t.c * 4, tot = pk + fk + ck || 1;
      const hh = H * scale;
      return h("div", { class: "pcol" + (d === t0 ? " today" : ""), style: { "--i": i } },
        h("div", { class: "kc" }, t.kcal),
        h("div", { class: "blk", style: { background: "var(--pro)", height: `${Math.max(28, hh * pk / tot)}px` } }, `${t.p} P`),
        h("div", { class: "blk", style: { background: "var(--fat)", height: `${Math.max(28, hh * fk / tot)}px` } }, `${t.f} F`),
        h("div", { class: "blk", style: { background: "var(--carb)", height: `${Math.max(28, hh * ck / tot)}px` } }, `${t.c} C`),
        h("div", { class: "day" }, DOW1[E.weekday(d)]));
    }));
  }

  /* =================================================================
     MORE
     ================================================================= */
  function viewMore() {
    const root = h("div");
    root.append(head("More"));
    const row = (icon, title, sub, onclick, right) => h("button", { class: "row", onclick },
      h("span", { class: "ri", html: svg(I[icon]) }),
      h("span", { class: "rt" }, h("b", null, title), sub ? h("span", null, sub) : null),
      right || h("span", { html: svg(I.chev, "chev") }));
    const lw = E.latestWeight(S);
    root.append(h("div", { class: "list" },
      row("scale", "Log weigh-in", lw ? `Last: ${f1(lw.kg)} kg on ${dShort(lw.date)}` : "No weigh-ins yet", () => weighSheet()),
      row("user", "Body composition", "Weight, body fat, goal feasibility", () => push({ v: "body" })),
      row("cal", "Logging calendar", `${E.streak(S)}-day streak`, () => push({ v: "calendar" }))));
    root.append(h("div", { style: { height: "14px" } }));
    root.append(h("div", { class: "list" },
      row("target", "Goal", S.goal.mode === "maintain" ? "Maintain" : `${S.goal.mode === "loss" ? "Lose" : "Gain"} ${S.goal.ratePct}%/wk${S.goal.goalWeight ? " to " + S.goal.goalWeight + " kg" : ""}`, () => goalSheet()),
      row("sliders", "Program", "Protein, fat, weekend structure", () => push({ v: "program" })),
      row("user", "Profile & engine", `${S.profile.sex === "m" ? "Male" : "Female"}, ${S.profile.age}, ${S.profile.heightCm} cm`, () => push({ v: "profile" }))));
    root.append(h("div", { style: { height: "14px" } }));
    const th = ["system", "light", "dark"];
    root.append(h("div", { class: "list" },
      h("div", { class: "row" }, h("span", { class: "ri", html: svg(I.half) }), h("span", { class: "rt" }, h("b", null, "Appearance")),
        seg(["Auto", "Light", "Dark"], th.indexOf(S.settings.theme), i => { S.settings.theme = th[i]; save(); applyTheme(); }, "sm"))));
    root.append(h("div", { style: { height: "14px" } }));
    root.append(h("div", { class: "list" },
      row("fork", "My foods", `${S.custom.length} saved`, () => push({ v: "foods" })),
      h("button", { class: "row", onclick: () => push({ v: "sync" }) }, h("span", { class: "ri", html: svg(I.sync) }),
        h("span", { class: "rt" }, h("b", null, "Sync & Apple Health"), h("span", { "data-syncstatus": "" }, syncLabel())), h("span", { html: svg(I.chev, "chev") })),
      row("share", "Back up now", S.settings.lastExport ? `Last backup ${dShort(S.settings.lastExport)}` : "Not backed up yet", () => shareBackup()),
      row("data", "Your data", "Export, import, reminders", () => push({ v: "data" })),
      row("book", "How it works", "The method and its sources", () => push({ v: "method" }))));
    root.append(h("p", { class: "note", style: { textAlign: "center", marginTop: "26px" } }, "Setpoint · runs entirely in this browser · no account, no tracking"));
    return root;
  }

  /* =================================================================
     DETAIL SCREENS
     ================================================================= */
  const RANGES = ["1W", "1M", "3M", "6M", "1Y", "All"];
  const RDAYS = { "1W": 7, "1M": 30, "3M": 91, "6M": 182, "1Y": 365 };
  function rangeDays(key) {
    const n = key === "All" ? Math.max(7, daysBetween(firstDataDate(), today()) + 1) : RDAYS[key];
    return E.range(addDays(today(), -(n - 1)), today());
  }
  function xLabel(d, n) { const dt = E.parse(d); return n <= 8 ? DOW[dt.getDay()] : dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }

  const DETAIL = {
    weight: { title: "Weight Trend", unit: "kg", dec: 1, color: "var(--wt)", add: true },
    bf: { title: "Body Fat", unit: "%", dec: 1, color: "var(--bfc)", add: true },
    exp: { title: "Expenditure", unit: "kcal", dec: 0, color: "var(--exp)" },
    balance: { title: "Energy Balance", unit: "kcal", dec: 0, color: "var(--kcal)" },
    kcal: { title: "Calories", unit: "kcal", dec: 0, color: "var(--kcal)" },
    p: { title: "Protein", unit: "g", dec: 0, color: "var(--pro)" },
    f: { title: "Fat", unit: "g", dec: 0, color: "var(--fat)" },
    c: { title: "Carbs", unit: "g", dec: 0, color: "var(--carb)" }
  };

  function viewDetail(scr) {
    const K = scr.kind, cfg = DETAIL[K];
    const rk = RANGE[K] || (K === "weight" || K === "exp" ? "1M" : "1W");
    const days = rangeDays(rk), n = days.length, xs = days.map(d => xLabel(d, n));
    const root = h("div");
    root.append(subhead(cfg.title, cfg.add ? iconBtn("plus", "Add weigh-in", () => weighSheet(), "flat") : null));

    // series
    let series = [], band = null, targets = null, zero, legend = [], primary, info = [];
    const tm = trendMap();
    if (K === "weight") {
      const raw = days.map(d => S.weights[d] ? S.weights[d].kg : null);
      const tr = days.map(d => tm[d] ? tm[d].trend : null);
      // carry the trend line across days without a weigh-in
      let lastT = null; const trf = days.map((d, i) => { if (tr[i] != null) lastT = tr[i]; else { const p = E.trendAt(S, d, trendSer()); lastT = p ? p.trend : null; } return lastT; });
      series = [{ type: "dots", data: raw, color: "var(--muted)", opacity: .55, r: 3 }, { data: trf, color: cfg.color, area: true, w: 2.6, endDot: true }];
      primary = trf; legend = [["o", "var(--muted)", "Scale reading"], ["l", cfg.color, "Trend"]];
      info = [
        h("p", { class: "note" }, "The trend is an exponentially weighted average of your weigh-ins. It moves about as fast as body tissue can, which is why it ignores the kilo you gain overnight after a salty dinner."),
        h("p", { class: "note" }, `Smoothing α = ${S.settings.alpha}. Change it in Profile & engine.`)];
    } else if (K === "bf") {
      const bf = days.map(d => S.weights[d] && S.weights[d].bf != null ? S.weights[d].bf : null);
      series = [{ data: bf, color: cfg.color, w: 2 }, { type: "dots", data: bf, color: cfg.color, opacity: 1, r: 3.6 }];
      primary = bf; legend = [["o", cfg.color, "Reading"]];
      info = [h("p", { class: "note" }, "Consumer bio-impedance scales carry a wide error band against DEXA, and readings swing with hydration. Weigh in under the same conditions and watch the direction, not the decimal.")];
    } else if (K === "exp") {
      const ex = days.map(d => { const e = expAt(d); return e.source === "formula" ? null : e.kcal; });
      band = days.map((d, i) => { const e = expAt(d); return ex[i] != null && e.se ? [e.kcal - e.se, e.kcal + e.se] : null; });
      const intake = days.map(d => E.dayKcal(S, d));
      series = [{ type: "dots", data: intake, color: "var(--muted)", opacity: .45, r: 2.8 }, { data: ex, color: cfg.color, w: 2.6, endDot: true }];
      primary = ex; legend = [["o", "var(--muted)", "Intake"], ["l", cfg.color, "Expenditure"], ["b", cfg.color, "±1σ"]];
      const e = expAt(today());
      info = [
        kv("Method", e.method === "kalman" ? "Kalman filter" : "Window fit"),
        kv("Confidence", e.source === "measured" ? "Measured" : e.source === "blended" ? "Still learning" : "Formula only"),
        kv(e.method === "kalman" ? "Last 28 days" : "Window", e.window ? `${e.method === "kalman" ? e.weighIns : e.window + " days, " + e.weighIns} weigh-ins` : "—"),
        kv("Energy per kg", `${e.rho || S.settings.kcalPerKg} kcal`),
        kv("Intake coverage", e.window ? r0(e.coverage * 100) + "%" : "—"),
        kv("Fitted rate", e.slopeKgWk != null ? `${e.slopeKgWk > 0 ? "+" : ""}${e.slopeKgWk.toFixed(2)} kg/wk` : "—"),
        kv("Formula estimate", e.baseline ? e.baseline + " kcal" : "—"),
        e.method === "kalman"
          ? h("p", { class: "note" }, "A two-state Kalman filter tracks your weight and expenditure together. Each morning's weigh-in corrects both, and each day's intake predicts tomorrow's weight. The band is the filter's own uncertainty.")
          : h("p", { class: "note" }, h("code", null, `expenditure = mean intake − slope × ${e.rho || S.settings.kcalPerKg}`), " — a least-squares line through your raw weigh-ins gives the slope, and its standard error gives the band."),
        h("p", { class: "note" }, "Workouts are already inside this number, because it's measured from what your weight actually did. Setpoint never adds exercise calories on top."),
        e.clamped ? h("div", { class: "flag warn", style: { marginTop: "12px" } }, h("i"), h("div", null, "The raw measurement fell outside a plausible range and was clamped. Usually a mistyped weight or a stretch of unlogged food.")) : null];
    } else if (K === "balance") {
      const bal = days.map(d => { const k = E.dayKcal(S, d), e = expAt(d).kcal; return k == null || e == null ? null : k - e; });
      series = [{ type: "bars", data: bal, colorFn: v => v < 0 ? "var(--kcal)" : "var(--pro)" }];
      zero = 0; primary = bal; legend = [["o", "var(--kcal)", "Deficit"], ["o", "var(--pro)", "Surplus"]];
      info = [h("p", { class: "note" }, "Intake minus the expenditure estimate for that day. The weekly average matters; any single day is noise.")];
    } else {
      const v = days.map(d => E.isTracked(S, d) ? E.dayTotals(S, d)[K] : null);
      targets = days.map(d => { const t = tgtFor(d); return t ? t[K] : null; });
      series = [{ type: "bars", data: v, colorFn: (x, i) => targets[i] && x > targets[i] * 1.03 ? "var(--bad)" : cfg.color }];
      zero = 0; primary = v; legend = [["o", cfg.color, "Consumed"], ["l", "var(--text)", "Target"]];
      const tracked = v.filter(x => x != null);
      const hits = days.filter((d, i) => v[i] != null && targets[i] && Math.abs(v[i] - targets[i]) <= targets[i] * 0.1).length;
      info = [kv("Days tracked", `${tracked.length} of ${n}`), kv("Within 10% of target", tracked.length ? `${hits} days (${r0(hits / tracked.length * 100)}%)` : "—")];
      root.append(h("div", { style: { marginBottom: "14px" } }, seg(MAC.map(m => m.label), MAC.findIndex(m => m.k === K), i => { STACK[STACK.length - 1] = { v: "detail", kind: MAC[i].k }; render(true); }, "sm")));
    }

    // header stats
    const vals = primary.filter(v => v != null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const diff = vals.length > 1 ? vals[vals.length - 1] - vals[0] : null;
    const stats = h("div", { class: "dstats" });
    const paintStats = i => {
      stats.innerHTML = "";
      if (i == null) {
        stats.append(
          h("div", null, h("div", { class: "k" }, K === "balance" ? "Daily Average" : "Average"), h("div", { class: "v" }, num(avg, cfg.dec), h("small", null, cfg.unit))),
          h("div", null, h("div", { class: "k" }, "Difference"), h("div", { class: "v" }, diff == null ? "—" : (diff > 0 ? "+" : "") + diff.toFixed(cfg.dec), h("small", null, cfg.unit))),
          h("div"),
          h("div", { class: "when" }, `${dShort(days[0])} – ${dShort(days[n - 1])}`));
        countUps(stats);
      } else {
        const v = primary[i];
        const extra = targets && targets[i] != null ? `of ${f0(targets[i])}` : band && band[i] ? `± ${r0((band[i][1] - band[i][0]) / 2)}` : "";
        stats.append(
          h("div", { style: { gridColumn: "1 / 3" } }, h("div", { class: "k" }, dLong(days[i])),
            h("div", { class: "v" }, v == null ? "—" : v.toFixed(cfg.dec), h("small", null, `${cfg.unit} ${extra}`))));
      }
    };
    paintStats(null);
    root.append(stats);

    root.append(h("div", { class: "chartbox" }, C.plot({
      w: CW() + 8, h: 300, xs, series, band, targets, zero, yfmt: v => cfg.dec ? v.toFixed(1) : String(Math.round(v)),
      onScrub: paintStats, scrubSeries: series.length - 1, bandColor: cfg.color, label: cfg.title
    })));
    root.append(h("div", { class: "ranges" }, seg(RANGES, RANGES.indexOf(rk), i => { RANGE[K] = RANGES[i]; render(true); })));
    root.append(h("div", { class: "legend" }, legend.map(([t, c, l]) => h("span", null,
      h("i", { class: t === "o" ? "o" : t === "b" ? "bnd" : "", style: { background: c } }), l))));
    if (info.length) root.append(h("div", { class: "card", style: { marginTop: "12px" } }, info));
    return root;
  }

  /* ---------------------------------------------------------- body */
  function viewBody() {
    const root = h("div");
    root.append(subhead("Body Composition", iconBtn("plus", "Add weigh-in", () => weighSheet(), "flat")));
    const fe = E.goalFeasibility(S);
    if (fe) {
      root.append(h("div", { class: "card" },
        h("div", { class: "stats3" },
          h("div", { class: "stat" }, h("b", null, num(fe.weight, 1), h("small", null, "kg")), h("span", null, "Weight")),
          h("div", { class: "stat" }, h("b", null, num(fe.fat, 1), h("small", null, "kg")), h("span", null, "Fat mass")),
          h("div", { class: "stat" }, h("b", null, num(fe.ffm, 1), h("small", null, "kg")), h("span", null, "Lean mass"))),
        h("div", { class: "divider" }),
        kv("Body fat", `${f1(fe.bf)}%`),
        kv("Resting rate (Katch-McArdle)", `${r0(E.katch(fe.ffm))} kcal`)));
      root.append(section("Goal Weight Check"));
      const gw = S.goal.goalWeight;
      root.append(h("div", { class: "card" },
        h("p", { class: "note", style: { marginTop: 0, marginBottom: "12px" } }, "What you would weigh at each body-fat level if you kept all of your lean mass. Treat it as a floor: losing some muscle puts the real number higher."),
        h("table", { class: "t" },
          h("thead", null, h("tr", null, h("th", null, "Body fat"), h("th", null, "Weight"), h("th", null, "Change"))),
          h("tbody", null, fe.rows.map(r => h("tr", { class: gw && Math.abs(r.kg - gw) < 2.5 ? "hi" : null },
            h("td", null, `${r.bf}%`), h("td", null, `${f1(r.kg)} kg`), h("td", null, `${(r.kg - fe.weight > 0 ? "+" : "")}${f1(r.kg - fe.weight)} kg`))))),
        gw ? h("p", { class: "note" }, `Your goal of ${f1(gw)} kg implies about ${Math.max(0, r0(E.impliedBf(S, gw)))}% body fat.`) : null));
    } else {
      root.append(h("div", { class: "card" }, h("div", { class: "empty-state" }, h("b", null, "No body-fat reading yet"), "Add one with a weigh-in to see lean mass and check whether your goal weight is realistic.")));
    }
    root.append(section("Recent Weigh-ins"));
    const ks = Object.keys(S.weights).sort().reverse().slice(0, 30);
    root.append(h("div", { class: "card" }, ks.length ? ks.map(k => h("div", { class: "hist" },
      h("div", { class: "d" }, dLong(k)),
      h("div", { class: "w" }, `${f1(S.weights[k].kg)} kg`, S.weights[k].bf != null ? h("span", { class: "muted", style: { fontSize: "15px", fontWeight: 400, marginLeft: "8px" } }, `${f1(S.weights[k].bf)}%`) : null,
        S.weights[k].src === "health" ? h("span", { class: "src", style: { marginLeft: "8px" } }, "Health") : null),
      h("div", { class: "r" }, h("button", { class: "btn sm", onclick: () => weighSheet(k) }, "Edit")))) : h("div", { class: "empty-state" }, "No weigh-ins yet.")));
    return root;
  }

  /* ------------------------------------------------------ calendar */
  function viewCalendar() {
    const root = h("div");
    root.append(subhead("Food Logging"));
    const t0 = today();
    root.append(h("div", { class: "stats3", style: { gridTemplateColumns: "1fr 1fr", marginBottom: "18px" } },
      h("div", { class: "stat" }, h("span", null, "Today"), h("b", null, E.isTracked(S, t0) ? num(E.dayKcal(S, t0)) : "--", h("small", null, "kcal"))),
      h("div", { class: "stat" }, h("span", null, "Streak"), h("b", null, num(E.streak(S)), h("small", null, "days")))));
    const [y, m] = CALM.split("-").map(Number);
    const first = `${CALM}-01`, gridStart = weekStart(first);
    const cal = h("div", { class: "cal" });
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(d => cal.append(h("div", { class: "wd" }, d)));
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      if (i >= 35 && d.slice(0, 7) !== CALM) break;
      const inM = d.slice(0, 7) === CALM;
      cal.append(h("button", {
        class: "c" + (inM ? "" : " out") + (S.fasted[d] ? " fasted" : E.isTracked(S, d) ? " tracked" : "") + (d === t0 ? " today" : "") + (d === SEL ? " sel" : ""),
        disabled: d > t0 ? true : null,
        onclick: () => { SEL = d; go("log"); }
      }, E.parse(d).getDate()));
    }
    root.append(h("div", { class: "card" }, cal,
      h("div", { class: "legend-row" }, h("span", null, h("i", { class: "t" }), "Tracked"), h("span", null, h("i", { class: "f" }), "Fasting"), h("span", null, h("i"), "Untracked"))));
    const mdate = E.parse(first);
    root.append(h("div", { class: "btnrow", style: { marginTop: "14px", justifyContent: "space-between" } },
      h("button", { class: "btn", html: svg(I.back), "aria-label": "Previous month", onclick: () => { mdate.setMonth(mdate.getMonth() - 1); CALM = E.isoDate(mdate).slice(0, 7); render(false); } }),
      h("div", { style: { alignSelf: "center", fontSize: "18px", fontWeight: 600 } }, mdate.toLocaleDateString("en-GB", { month: "long", year: "numeric" })),
      h("button", { class: "btn", html: svg(I.chev), "aria-label": "Next month", disabled: CALM >= t0.slice(0, 7) ? true : null, onclick: () => { mdate.setMonth(mdate.getMonth() + 1); CALM = E.isoDate(mdate).slice(0, 7); render(false); } })));
    return root;
  }

  /* ------------------------------------------------------- profile */
  function field(label, input) { return h("label", { class: "fld" }, h("span", null, label), input); }
  function numIn(id, val, step, onchange, ph) {
    return h("input", { class: "inp", id, type: "number", inputmode: "decimal", step: step || "any", value: val ?? "", placeholder: ph || null, onchange: e => onchange(e.target.value === "" ? null : +e.target.value) });
  }
  function selIn(id, opts, val, onchange) {
    return h("select", { class: "inp", id, onchange: e => onchange(e.target.value) }, opts.map(([v, l]) => h("option", { value: v, selected: String(v) === String(val) ? true : null }, l)));
  }
  function viewProfile(scr) {
    const root = h("div");
    const P = S.profile;
    root.append(subhead(scr.onboarding ? "Welcome" : "Profile & Engine"));
    if (scr.onboarding) root.append(h("div", { class: "card", style: { marginBottom: "12px" } },
      h("p", { class: "note", style: { marginTop: 0 } }, "Three steps: fill in your profile below, log a weigh-in, then set a goal. Setpoint starts from a formula estimate and switches to measuring your real expenditure once it has about two weeks of weigh-ins and food logs.")));
    root.append(h("div", { class: "card" },
      h("div", { class: "fields" },
        field("Sex", selIn("p_sex", [["m", "Male"], ["f", "Female"]], P.sex, v => { P.sex = v; save(); })),
        field("Age", numIn("p_age", P.age, 1, v => { P.age = clamp(v || 35, 14, 100); save(); }))),
      h("div", { class: "fields", style: { marginTop: "12px" } },
        field("Height (cm)", numIn("p_h", P.heightCm, 1, v => { P.heightCm = clamp(v || 170, 120, 230); save(); })),
        field("Activity (first 2 weeks)", selIn("p_act", [[1.2, "Desk-bound"], [1.35, "Light"], [1.45, "On your feet"], [1.6, "Active"], [1.75, "Very active"]], P.activity, v => { P.activity = +v; save(); }))),
      h("p", { class: "note" }, "Activity only seeds the starting estimate. Once there's enough weigh-in and food data, the measured figure takes over and this stops mattering.")));
    root.append(section("Engine"));
    root.append(h("div", { class: "card" },
      h("div", { class: "fields" },
        field("kcal per kg", numIn("e_kpk", S.settings.kcalPerKg, 100, v => { S.settings.kcalPerKg = clamp(v || 7700, 5000, 9500); save(); })),
        field("Trend smoothing α", numIn("e_a", S.settings.alpha, 0.05, v => { S.settings.alpha = clamp(v || 0.25, 0.05, 0.6); save(); }))),
      h("p", { class: "note" }, "7700 kcal/kg is the usual energy density of body fat. It overstates the first week or two of a diet, when much of the loss is glycogen and water. A lower α smooths harder but reacts more slowly."),
      h("div", { class: "divider" }),
      h("div", { class: "lbl" }, "Expenditure estimator"),
      seg(["Kalman filter", "Window fit"], S.settings.estimator === "window" ? 1 : 0, i => { S.settings.estimator = i ? "window" : "kalman"; save(); }, "sm"),
      h("p", { class: "note" }, "The Kalman filter updates every day, treats unlogged days as uncertain instead of ignoring them, and gives a more honest error band. The window fit is the simpler least-squares method from earlier versions."),
      h("div", { class: "lbl" }, "Energy per kg"),
      seg(["From body fat", "Fixed"], S.settings.rho === "auto" ? 0 : 1, i => { S.settings.rho = i ? "fixed" : "auto"; save(); }, "sm"),
      h("p", { class: "note" }, `With a body-fat reading, Setpoint estimates how much of each kilo lost is fat versus lean tissue (Forbes) and prices each part separately (Hall, 2008). Right now: ${r0(E.energyDensity(S))} kcal/kg.`)));
    if (scr.onboarding) root.append(h("div", { class: "btnrow", style: { marginTop: "16px" } },
      h("button", { class: "btn primary block", onclick: () => weighSheet(null, () => goalSheet(true)) }, "Next: log a weigh-in")));
    return root;
  }

  /* ------------------------------------------------------- program */
  function viewProgram() {
    const root = h("div");
    root.append(subhead("Edit Program"));
    const g = Object.assign({}, S.goal);
    const preview = h("div");
    const paint = () => {
      const saved = S.goal; S.goal = g; invalidate();
      const t = E.computeTargets(S);
      S.goal = saved; invalidate();
      preview.innerHTML = "";
      if (!t.ready) { preview.append(h("div", { class: "empty-state" }, "Add a weigh-in to preview targets.")); return; }
      preview.append(programCols(t.weekday, t.weekend), h("div", { style: { marginTop: "14px" } }, flags(t.flags)));
    };
    const slider = (label, key, min, max, step, fmt) => {
      const out = h("b", null, fmt(g[key]));
      return h("div", { style: { marginTop: "16px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "16px" } }, h("span", { class: "muted" }, label), out),
        h("input", { type: "range", min, max, step, value: g[key], style: { width: "100%", accentColor: "var(--text)", marginTop: "8px" },
          oninput: e => { g[key] = +e.target.value; out.textContent = fmt(g[key]); paint(); } }));
    };
    root.append(h("div", { class: "card" },
      h("div", { class: "muted", style: { fontSize: "15px", marginBottom: "8px" } }, "Protein basis"),
      seg(["Lean mass", "Bodyweight"], g.proteinMode === "lbm" ? 0 : 1, i => { g.proteinMode = i ? "bw" : "lbm"; g.proteinPerKg = i ? 1.8 : 2.2; paint(); }, "sm"),
      slider("Protein", "proteinPerKg", 1.2, 3.0, 0.1, v => `${v.toFixed(1)} g/kg`),
      slider("Fat", "fatPerKg", 0.5, 1.5, 0.05, v => `${v.toFixed(2)} g/kg`),
      slider("Weekend bump", "weekendPct", 0, 30, 5, v => v ? `+${v}%` : "Even week")));
    root.append(h("div", { class: "card", style: { marginTop: "12px" } }, h("h3", { style: { margin: 0, fontSize: "19px" } }, "Preview"), preview));
    root.append(h("p", { class: "note" }, "2.2 g/kg of lean mass is at the top of the range the evidence supports for keeping muscle in a deficit. The weekend bump keeps the weekly total the same and moves calories to Saturday and Sunday."));
    root.append(h("button", { class: "btn primary block", style: { marginTop: "16px" }, onclick: () => {
      Object.assign(S.goal, { proteinMode: g.proteinMode, proteinPerKg: g.proteinPerKg, fatPerKg: g.fatPerKg, weekendPct: g.weekendPct });
      applyCheckin(E.makeCheckin(S), "Program updated"); back();
    } }, "Save and apply"));
    root._after = paint;
    return root;
  }

  /* --------------------------------------------------------- foods */
  function viewFoods() {
    const root = h("div");
    root.append(subhead("My Foods", iconBtn("plus", "New food", () => foodForm(), "flat")));
    if (!S.custom.length) root.append(h("div", { class: "card" }, h("div", { class: "empty-state" }, h("b", null, "Nothing saved yet"), "Add your own dishes here, or scan a barcode — scanned products are saved automatically.")));
    else root.append(h("div", { class: "card" }, S.custom.map(f => h("button", { class: "res", onclick: () => foodForm(f) },
      h("div", { class: "n" }, f.n), h("div", { class: "s" }, `per ${f.unit} · ${f0(f.p)}P ${f0(f.f)}F ${f0(f.c)}C${f.barcode ? " · barcode" : ""}`),
      h("div", { class: "k" }, f0(f.kcal), h("small", null, "kcal"))))));
    root.append(h("p", { class: "note" }, "The built-in hawker figures are estimates, and portions vary a lot between stalls. For dishes you eat often, check them against HPB's SG FoodID and save your own version here. Your version shows first in search."));
    return root;
  }

  /* ---------------------------------------------------------- data */
  function viewData() {
    const root = h("div");
    root.append(subhead("Your Data"));
    const nW = Object.keys(S.weights).length, nD = Object.keys(S.intake).length;
    const persisted = h("span", null, "checking…");
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(p => persisted.textContent = p ? "Protected" : "Can be cleared by the browser").catch(() => persisted.textContent = "Unknown");
    else persisted.textContent = "Unknown";
    root.append(h("div", { class: "card" },
      kv("Weigh-ins", nW), kv("Days logged", nD), kv("Check-ins", S.program.checkins.length), kv("Custom foods", S.custom.length),
      kv("Last backup", S.settings.lastExport ? dLong(S.settings.lastExport) : "Never"),
      h("div", { class: "kv" }, h("span", null, "Storage"), persisted)));
    root.append(h("div", { class: "flag warn", style: { marginTop: "12px" } }, h("i"), h("div", null,
      "Everything is stored in this browser only. Safari can clear storage for sites you haven't opened in a while, and clearing website data wipes it at once. Adding Setpoint to your Home Screen helps; a regular export is the real backup.")));
    const raw = h("div");
    root.append(h("button", { class: "btn primary block", style: { marginTop: "16px", height: "54px" }, html: svg(I.share) + "Back up to Files / iCloud", onclick: () => shareBackup() }));
    root.append(h("div", { class: "row", style: { padding: "14px 0 0", borderTop: 0 } }, h("span", { class: "rt" }, h("b", null, "Remind me every")),
      seg(["3 days", "Week", "2 weeks", "Off"], [3, 7, 14, 0].indexOf(S.settings.backupDays ?? 7), i => { S.settings.backupDays = [3, 7, 14, 0][i]; save(); }, "sm")));
    root.append(h("div", { class: "btnrow", style: { marginTop: "16px" } },
      h("button", { class: "btn", html: svg(I.down) + "Download", onclick: () => doExport(raw) }),
      h("button", { class: "btn", html: svg(I.up) + "Import", onclick: () => $("#importFile").click() }),
      h("button", { class: "btn", onclick: () => showRaw(raw) }, "Copy as text")),
      h("input", { type: "file", id: "importFile", accept: "application/json,.json", hidden: true, onchange: e => doImport(e.target.files[0]) }),
      raw);
    root.append(section("Danger Zone"));
    root.append(h("button", { class: "btn danger", html: svg(I.trash) + "Erase everything", onclick: () =>
      confirmSheet("Erase everything?", "Deletes every weigh-in, food entry, check-in and custom food in this browser. This cannot be undone. Export first if you want a copy.", "Erase", () => { const th = S.settings.theme; S = blank(); S.settings.theme = th; save(); STACK = []; TAB = "dash"; render(true); toast("All data erased"); }) }));
    return root;
  }
  /* Share-sheet backup. On iPhone this opens the system sheet where
     "Save to Files" puts the JSON in iCloud Drive. Falls back to a
     download where sharing files isn't supported. */
  async function shareBackup() {
    const name = `setpoint-${today()}.json`;
    let file = null;
    try { file = new File([exportText()], name, { type: "application/json" }); } catch (e) { }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Setpoint backup" });
        S.settings.lastExport = today(); save(); render(false); toast("Backed up");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") { toast("Backup cancelled"); return; }
      }
    }
    doExport(null); render(false);
  }
  function exportText() { return JSON.stringify(Object.assign({}, S, { exportedAt: new Date().toISOString(), app: "setpoint" }), null, 1); }
  function doExport(box) {
    const stamp = today();
    try {
      const blob = new Blob([exportText()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: `setpoint-${stamp}.json` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) { }
    S.settings.lastExport = stamp; save();
    toast("Export started");
    if (!box) return;
    box.innerHTML = "";
    box.append(h("p", { class: "note" }, "If no file appeared, this browser blocked the download. Use Copy as text and paste it into a note instead."));
  }
  function showRaw(box) {
    box.innerHTML = "";
    const ta = h("textarea", { class: "inp", rows: "8", readonly: true, style: { marginTop: "14px" } });
    ta.value = exportText();
    box.append(ta, h("button", { class: "btn sm", style: { marginTop: "8px" }, onclick: () => {
      ta.select();
      const done = () => { S.settings.lastExport = today(); save(); toast("Copied"); };
      if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(done).catch(() => toast("Selected — copy it manually"));
      else toast("Selected — copy it manually");
    } }, "Copy"));
  }
  function doImport(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const p = JSON.parse(fr.result);
        if (p && p.v === 2) S = merge(p);
        else if (p && p.v === 1) S = migrateV1(p);
        else throw new Error("unknown");
        S.settings.demo = false; save(); applyTheme(); render(true); toast("Imported");
      } catch (e) { toast("That file isn't a Setpoint export. Nothing changed."); }
    };
    fr.readAsText(file);
  }

  /* --------------------------------------------------------- method */
  function viewMethod() {
    const root = h("div");
    root.append(subhead("How It Works"));
    const P = (t) => h("p", { class: "note" }, t);
    root.append(h("div", { class: "card" },
      h("h3", { style: { margin: "0 0 4px", fontSize: "19px" } }, "Expenditure is measured"),
      P("Most apps estimate expenditure from a formula and an activity guess, then never revisit it. Setpoint works backwards from what happened: over the last two to five weeks, it fits a straight line through your raw weigh-ins and compares the rate of change with what you ate."),
      h("p", { class: "note" }, h("code", null, "expenditure = mean intake − slope × 7700 kcal/kg")),
      P("The fit also gives the standard error of the slope, so every expenditure figure comes with a ±1σ band. Early on the band is wide, and that's accurate: two weeks of scale noise doesn't pin anything down tightly."),
      P("While data is thin, the measurement is blended with a formula estimate (Mifflin-St Jeor, or Katch-McArdle when you have a body-fat reading). The blend shifts toward the measurement as weigh-ins and logging coverage build up.")));
    root.append(h("div", { class: "card" },
      h("h3", { style: { margin: "0 0 4px", fontSize: "19px" } }, "Weekly check-ins"),
      P("Targets stay fixed for a week so you have something stable to aim at. At each check-in they're recalculated from the latest expenditure and your goal rate, and the check-in screen breaks down exactly what moved them."),
      P("Two limits are enforced rather than just suggested: intake never drops below your estimated resting rate, and anything faster than about 1% of bodyweight a week triggers a warning.")));
    root.append(h("div", { class: "card" },
      h("h3", { style: { margin: "0 0 4px", fontSize: "19px" } }, "What throws it off"),
      P("Under-logging makes the estimate read low by the same amount, and so does the target. The loop still works, but the number isn't your true expenditure."),
      P("Skipping the heavy days is worse. Mean intake only covers logged days, while the weight change covers every day. If you can't log a day properly, log a rough guess or mark nothing — don't log only the clean days."),
      P("Hawker portions vary a lot between stalls. The built-in values are estimates. Check your regulars against HPB's SG FoodID and save your own versions.")));
    root.append(h("div", { class: "card" },
      h("h3", { style: { margin: "0 0 4px", fontSize: "19px" } }, "Sources"),
      P("Mifflin MD et al. A new predictive equation for resting energy expenditure. Am J Clin Nutr 1990;51:241-7."),
      P("Katch-McArdle: RMR = 370 + 21.6 × fat-free mass (kg)."),
      P("Protein 1.6–2.2 g/kg for lean-mass retention: Morton RW et al., Br J Sports Med 2018;52:376-84; Helms ER et al., JISSN 2014;11:20."),
      P("Barcode data: Open Food Facts, open database (ODbL)."),
      P("None of this is medical advice. It's a calculator whose source you can read. If it disagrees with your doctor or dietitian, go with them.")));
    return root;
  }

  const SCREENS = { detail: viewDetail, body: viewBody, calendar: viewCalendar, profile: viewProfile, program: viewProgram, foods: viewFoods, data: viewData, method: viewMethod,
    sync: (...a) => viewSync(...a), shortcut: (...a) => viewShortcut(...a) };
  // training screens are added at boot, once the module is initialised

  /* =================================================================
     SHEETS
     ================================================================= */
  let sheetOnClose = null;
  function openSheet(build, onClose) {
    closeSheet(true);
    const layer = $("#layer");
    const scrim = h("div", { class: "scrim", onclick: () => closeSheet() });
    const sh = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, h("div", { class: "grab" }));
    build(sh);
    layer.append(scrim, sh);
    sheetOnClose = onClose || null;
    document.body.style.overflow = "hidden";
    // swipe-down to close from the grab bar
    let sy = null;
    sh.querySelector(".grab").addEventListener("pointerdown", e => { sy = e.clientY; });
    window.addEventListener("pointerup", function up(e) { if (sy != null && e.clientY - sy > 60) closeSheet(); sy = null; window.removeEventListener("pointerup", up); });
    return sh;
  }
  function closeSheet(instant) {
    const layer = $("#layer"); if (!layer || !layer.children.length) return;
    stopScan();
    document.body.style.overflow = "";
    const cb = sheetOnClose; sheetOnClose = null;
    if (instant) { layer.innerHTML = ""; if (cb) cb(); return; }
    layer.querySelectorAll(".sheet, .scrim, .menu").forEach(e => e.classList.add("closing"));
    setTimeout(() => { layer.innerHTML = ""; if (cb) cb(); }, 230);
  }
  function openMenu(items) {
    closeSheet(true);
    const layer = $("#layer");
    const scrim = h("div", { class: "scrim", style: { background: "rgba(0,0,0,.25)" }, onclick: () => closeSheet() });
    const m = h("div", { class: "menu", role: "menu" }, items.filter(Boolean).map(([ic, label, fn]) =>
      h("button", { class: "row", role: "menuitem", onclick: () => { closeSheet(true); fn(); } }, h("span", { class: "ri", html: svg(I[ic]) }), h("span", { class: "rt" }, h("b", null, label)))));
    layer.append(scrim, m);
  }
  function fabMenu() {
    const t0 = today();
    openMenu([
      ["search", "Log food", () => logSheet({})],
      ["barcode", "Scan barcode", () => logSheet({ tab: "scan" })],
      ["spark", "AI photo estimate", () => logSheet({ tab: "ai" })],
      ["bolt", "Quick add calories", () => logSheet({ tab: "quick" })],
      ["scale", "Log weigh-in", () => weighSheet()],
      ["train", S.train && S.train.active ? "Resume workout" : "Start next workout", () => TR.startNext()],
      S.train && S.train.active ? null : ["body", "Freestyle from body map", () => { go("train"); setTimeout(() => TR.openFreestyle(), 50); }],
      S.intake[addDays(SEL, -1)] ? ["copy", `Copy ${SEL === t0 ? "yesterday" : dShort(addDays(SEL, -1))} to ${SEL === t0 ? "today" : dShort(SEL)}`, () => copyDay(addDays(SEL, -1), SEL)] : null
    ]);
  }
  function confirmSheet(title, body, cta, fn) {
    openSheet(sh => {
      sh.append(h("div", { class: "sheet-body" },
        h("h3", { style: { margin: "4px 0 8px", fontSize: "22px" } }, title),
        h("p", { class: "note", style: { fontSize: "16px" } }, body),
        h("div", { class: "btnrow", style: { marginTop: "20px" } },
          h("button", { class: "btn primary", style: { background: "var(--bad)", color: "#fff" }, onclick: () => { closeSheet(true); fn(); } }, cta),
          h("button", { class: "btn", onclick: () => closeSheet() }, "Cancel"))));
    });
  }

  /* ------------------------------------------------------ log food */
  function freqMap() {
    if (CACHE.fq) return CACHE.fq;
    const m = {}, since = addDays(today(), -60);
    for (const d in S.intake) if (d >= since) for (const e of S.intake[d]) {
      const x = m[e.name] || (m[e.name] = { n: 0, last: d, e });
      x.n++; if (d >= x.last) { x.last = d; x.e = e; }
    }
    return (CACHE.fq = m);
  }
  function searchFoods(q) {
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    const fq = freqMap(), out = [];
    for (const f of S.custom.concat(FOODS)) {
      const hay = (f.n + " " + (f.alias || "")).toLowerCase();
      if (!toks.every(t => hay.includes(t))) continue;
      const nm = f.n.toLowerCase();
      let s = nm.startsWith(toks[0]) ? 0 : nm.includes(" " + toks[0]) ? 1 : 2;
      if (f.tag === "custom") s -= 0.6;
      s -= Math.min(1.2, (fq[f.n] ? fq[f.n].n : 0) / 4);
      out.push({ f, s });
    }
    return out.sort((a, b) => a.s - b.s || a.f.n.length - b.f.n.length).slice(0, 40).map(x => x.f);
  }
  function foodFromEntry(e) { return { n: e.name, kcal: e.base.kcal, p: e.base.p, f: e.base.f, c: e.base.c, unit: e.unit, g: e.g || 0, tag: "recent" }; }

  function logSheet(opt) {
    opt = opt || {};
    const st = { tab: opt.tab || "search", hour: opt.hour ?? (SEL === today() ? new Date().getHours() : 12), q: "" };
    openSheet(sh => {
      const top = h("div", { class: "sheet-top" });
      const tabs = h("div", { class: "tabs", role: "tablist" });
      const body = h("div", { class: "sheet-body" });
      const foot = h("div", { class: "sheet-foot" });
      sh.append(top, tabs, body, foot);
      const paintTop = () => {
        const tot = E.dayTotals(S, SEL), tg = tgtFor(SEL);
        top.innerHTML = "";
        top.append(
          h("button", { class: "chip round", "aria-label": "Close", html: svg(I.x), onclick: () => closeSheet() }),
          h("label", { class: "chip" }, h("span", { html: svg(I.clock) }),
            h("select", { "aria-label": "Time", onchange: e => { st.hour = +e.target.value; } },
              Array.from({ length: 24 }, (_, i) => h("option", { value: i, selected: i === st.hour ? true : null }, hourLabel(i))))),
          h("div", { class: "chip outline", style: { marginLeft: "auto" } }, h("span", { html: flame() }), `${f0(tot.kcal)} / ${tg ? f0(tg.kcal) : "—"}`));
      };
      const TABS = [["search", "Search", "search"], ["meals", "Meals", "fork"], ["scan", "Scan", "barcode"], ["ai", "AI Photo", "spark"], ["quick", "Quick Add", "bolt"], ["recent", "Recent", "clock"], ["mine", "My Foods", "list"]];
      const paintTabs = () => {
        tabs.innerHTML = "";
        TABS.forEach(([id, label, ic]) => tabs.append(h("button", { class: st.tab === id ? "on" : null, role: "tab", html: svg(I[ic]) + label,
          onclick: () => { st.tab = id; paintTabs(); paintBody(); } })));
      };
      const pickFood = f => portion(f);
      const resRow = (f, sub) => h("button", { class: "res", onclick: () => pickFood(f) },
        h("div", { class: "n" }, f.n),
        h("div", { class: "s" }, f.src === "hpb" ? h("span", { class: "src" }, "HPB") : f.tag === "custom" ? h("span", { class: "src mine" }, "Mine") : null,
          sub || `${f.unit}${f.g && !/100 (g|ml)/.test(f.unit) ? ` · ${f.g} g` : ""} · ${f0(f.p)}P ${f0(f.f)}F ${f0(f.c)}C`),
        h("div", { class: "k" }, f0(f.kcal), h("small", null, "kcal")));
      const mealTotal = m => m.items.reduce((a, it) => { const k = it.grams ? it.grams / (it.g || 100) : it.qty; return { kcal: a.kcal + it.kcal * k, p: a.p + it.p * k, f: a.f + it.f * k, c: a.c + it.c * k }; }, { kcal: 0, p: 0, f: 0, c: 0 });
      const mealRow = m => { const t = mealTotal(m); return h("button", { class: "res", onclick: () => mealPreview(m) },
        h("div", { class: "n" }, m.name),
        h("div", { class: "s" }, h("span", { class: "src meal" }, "Meal"), `${m.items.length} items · ${f0(t.p)}P ${f0(t.f)}F ${f0(t.c)}C`),
        h("div", { class: "k" }, f0(t.kcal), h("small", null, "kcal"))); };
      const mealPreview = m => {
        stopScan();
        body.innerHTML = ""; foot.innerHTML = ""; foot.hidden = false;
        let mult = 1;
        const tot = h("div", { class: "muted" });
        const paintTot = () => { const t = mealTotal(m); tot.textContent = `${f0(t.kcal * mult)} kcal · ${f0(t.p * mult)}P ${f0(t.f * mult)}F ${f0(t.c * mult)}C`; };
        const q = h("div", { class: "quick" });
        const paintQ = () => { q.innerHTML = ""; [0.5, 1, 1.5, 2].forEach(v => q.append(h("button", { class: v === mult ? "on" : null, onclick: () => { mult = v; paintQ(); paintTot(); } }, `${v}×`))); };
        body.append(
          h("button", { class: "btn sm", style: { marginBottom: "14px" }, html: svg(I.back) + "Back", onclick: () => paintBody() }),
          h("div", { class: "portion" }, h("h3", null, m.name), tot),
          q,
          h("div", { class: "card", style: { marginTop: "14px" } }, m.items.map(it => kv(it.n, `${it.grams ? it.grams + " g" : qtyTxt(it.qty) + " " + it.unit} · ${f0(it.kcal * (it.grams ? it.grams / (it.g || 100) : it.qty))} kcal`))),
          h("button", { class: "btn danger sm", style: { marginTop: "14px" }, html: svg(I.trash) + "Delete meal", onclick: () => { S.meals = S.meals.filter(x => x.id !== m.id); save(); paintBody(); toast("Meal deleted"); } }));
        paintQ(); paintTot();
        foot.append(h("button", { class: "btn primary block", style: { height: "54px" }, onclick: () => {
          m.items.forEach(it => {
            const f = { n: it.n, kcal: it.kcal, p: it.p, f: it.f, c: it.c, unit: it.unit, g: it.g };
            const k = (it.grams ? it.grams / (it.g || 100) : it.qty) * mult;
            addEntry(f, k, it.grams ? it.grams * mult : null, true);
          });
          save(); paintTop(); toast(`Logged ${m.name}`); LOGGED = true; paintBody();
        } }, "Log meal"));
      };

      const paintBody = () => {
        stopScan();
        body.innerHTML = ""; foot.innerHTML = ""; foot.hidden = false;
        if (st.tab === "search") {
          const list = h("div");
          const input = h("input", { class: "inp", type: "search", placeholder: "Search for a food", value: st.q, autocomplete: "off", enterkeyhint: "search",
            oninput: e => { st.q = e.target.value; paintList(); } });
          const paintList = () => {
            list.innerHTML = "";
            if (st.q.trim().length < 2) {
              const fq = Object.values(freqMap()).sort((a, b) => b.n - a.n).slice(0, 12);
              if (fq.length) { list.append(h("div", { class: "muted", style: { fontSize: "14px", margin: "0 0 4px" } }, "Frequent")); fq.forEach(x => list.append(resRow(foodFromEntry(x.e), `${x.n}× in 60 days · ${qtyTxt(x.e.qty)} ${x.e.unit}`))); }
              else list.append(h("div", { class: "empty-state" }, h("b", null, "No history yet"), "Search for foods below"));
              return;
            }
            const toks = st.q.toLowerCase().split(/\s+/).filter(Boolean);
            (S.meals || []).filter(m => toks.every(t => m.name.toLowerCase().includes(t))).forEach(m => list.append(mealRow(m)));
            const r = searchFoods(st.q);
            if (!r.length && !list.children.length) list.append(h("div", { class: "empty-state" }, h("b", null, `Nothing matches "${st.q}"`), "Try fewer words, or use Quick Add.",
              h("div", { style: { marginTop: "12px" } }, h("button", { class: "btn sm", onclick: () => foodForm({ n: st.q }) }, "Create this food"))));
            r.forEach(f => list.append(resRow(f)));
          };
          paintList();
          body.append(list);
          foot.append(input);
          setTimeout(() => input.focus(), 30);
        } else if (st.tab === "meals") {
          foot.hidden = true;
          const src = (S.intake[SEL] || []);
          body.append(h("button", { class: "btn block", style: { marginBottom: "10px" }, html: svg(I.plus) + "New meal from this day's log", disabled: src.length ? null : true, onclick: () => { closeSheet(true); mealForm(src); } }));
          if (!(S.meals || []).length) body.append(h("div", { class: "empty-state" }, h("b", null, "No saved meals"), "Group foods you often eat together — your usual kopitiam breakfast, say — and log them in one tap."));
          (S.meals || []).forEach(m => body.append(mealRow(m)));
        } else if (st.tab === "recent") {
          foot.hidden = true;
          const fq = Object.values(freqMap()).sort((a, b) => b.last.localeCompare(a.last) || b.n - a.n);
          if (!fq.length) body.append(h("div", { class: "empty-state" }, h("b", null, "No recent foods"), "Foods you log show up here."));
          fq.forEach(x => body.append(resRow(foodFromEntry(x.e), `${dShort(x.last)} · ${qtyTxt(x.e.qty)} ${x.e.unit} · ${f0(x.e.kcal)} kcal`)));
        } else if (st.tab === "mine") {
          foot.hidden = true;
          body.append(h("button", { class: "btn block", style: { marginBottom: "10px" }, html: svg(I.plus) + "New food", onclick: () => foodForm(null, f => portion(f)) }));
          if (!S.custom.length) body.append(h("div", { class: "empty-state" }, "Your saved and scanned foods appear here."));
          S.custom.forEach(f => body.append(resRow(f)));
        } else if (st.tab === "ai") {
          foot.hidden = true;
          st.ai = st.ai || { text: "", off: new Set() };
          const out = h("div");
          const ta = h("textarea", { class: "inp aipaste", rows: 5, placeholder: "Paste ChatGPT's SETPOINT block here", value: st.ai.text,
            oninput: e => { st.ai.text = e.target.value; st.ai.off = new Set(); paintAi(); } });
          ta.value = st.ai.text;
          const paintAi = () => {
            out.innerHTML = "";
            if (!st.ai.text.trim()) return;
            const r = E.parseAiEstimate(st.ai.text);
            if (!r.items.length) { out.append(h("div", { class: "empty-state" }, h("b", null, "Couldn't find any food lines"), "Copy the whole code block ChatGPT sent back, starting at SETPOINT.")); return; }
            const on = r.items.filter((_, i) => !st.ai.off.has(i));
            const sum = on.reduce((a, x) => ({ kcal: a.kcal + x.kcal, p: a.p + x.p, f: a.f + x.f, c: a.c + x.c }), { kcal: 0, p: 0, f: 0, c: 0 });
            out.append(h("div", { class: "aires" }, r.items.map((x, i) => h("label", { class: "airow" + (st.ai.off.has(i) ? " off" : "") },
              h("input", { type: "checkbox", checked: st.ai.off.has(i) ? null : true, onchange: e => { if (e.target.checked) st.ai.off.delete(i); else st.ai.off.add(i); paintAi(); } }),
              h("div", null, h("b", null, x.name), h("span", null, [x.portion, `P ${x.p} · F ${x.f} · C ${x.c}`].filter(Boolean).join(" · ")),
                x.mismatch ? h("em", null, `Macros add up to ${r0(x.p * 4 + x.f * 9 + x.c * 4)} kcal, not ${x.kcal}. Worth a second look.`) : null),
              h("strong", null, x.kcal)))));
            if (r.confidence || r.notes) out.append(h("p", { class: "note" }, [r.confidence ? `Confidence: ${r.confidence}${r.error ? " (" + r.error + ")" : ""}.` : "", r.notes || ""].filter(Boolean).join(" ")));
            out.append(h("button", { class: "btn primary block", style: { marginTop: "12px" }, disabled: on.length ? null : true, onclick: () => {
              on.forEach(x => addEntry({ n: x.name, kcal: x.kcal, p: x.p, f: x.f, c: x.c, unit: x.portion || "portion", g: 0 }, 1, null, true));
              save(); paintTop(); LOGGED = true;
              toast(`Logged ${on.length} item${on.length > 1 ? "s" : ""} · ${r0(sum.kcal)} kcal`);
              st.ai = { text: "", off: new Set() }; paintBody();
            } }, `Log ${on.length} item${on.length === 1 ? "" : "s"} · ${r0(sum.kcal)} kcal`));
          };
          body.append(
            h("div", { class: "aistep" }, h("i", null, "1"), h("div", null, h("b", null, "Copy the prompt"), h("span", null, "It tells ChatGPT (or Claude, Gemini) to reply in a format Setpoint can read."))),
            h("div", { style: { display: "flex", gap: "8px", margin: "8px 0 14px 40px" } },
              h("button", { class: "btn sm", onclick: () => { (navigator.clipboard ? navigator.clipboard.writeText(E.AI_PROMPT) : Promise.reject()).then(() => toast("Prompt copied")).catch(() => { ta.value = E.AI_PROMPT; ta.select(); toast("Select all and copy it from the box"); }); } }, "Copy prompt"),
              h("a", { class: "btn sm", href: "https://chatgpt.com/", target: "_blank", rel: "noopener" }, "Open ChatGPT")),
            h("div", { class: "aistep" }, h("i", null, "2"), h("div", null, h("b", null, "Send it with your photo"), h("span", null, "Attach the photo, paste the prompt, send. Tap the copy button on the code block it sends back."))),
            h("div", { class: "aistep", style: { marginTop: "14px" } }, h("i", null, "3"), h("div", null, h("b", null, "Paste the answer here"), h("span", null, "Untick anything you didn't eat. Edit amounts afterwards in the log if needed."))),
            h("div", { style: { margin: "8px 0 0 40px" } },
              navigator.clipboard && navigator.clipboard.readText ? h("button", { class: "btn sm", style: { marginBottom: "8px" }, onclick: () => navigator.clipboard.readText().then(t => { st.ai.text = t; ta.value = t; st.ai.off = new Set(); paintAi(); }).catch(() => toast("Long-press the box and choose Paste")) }, "Paste") : null,
              ta),
            out);
          paintAi();
        } else if (st.tab === "quick") {
          foot.hidden = true;
          const v = { n: "", k: null, p: null, f: null, c: null };
          const calc = h("div", { class: "muted small", style: { marginTop: "10px" } });
          const upd = () => { const m = (v.p || 0) * 4 + (v.f || 0) * 9 + (v.c || 0) * 4; calc.textContent = m ? `Macros add up to ${r0(m)} kcal${v.k ? "" : " — used if you leave calories empty"}.` : ""; };
          body.append(
            field("Name (optional)", h("input", { class: "inp", type: "text", placeholder: "Dinner at mum's", oninput: e => v.n = e.target.value })),
            h("div", { class: "fields", style: { marginTop: "12px" } },
              field("Calories", numIn("qa_k", "", 1, x => { v.k = x; upd(); }, "kcal")),
              field("Protein (g)", numIn("qa_p", "", 1, x => { v.p = x; upd(); }))),
            h("div", { class: "fields", style: { marginTop: "12px" } },
              field("Fat (g)", numIn("qa_f", "", 1, x => { v.f = x; upd(); })),
              field("Carbs (g)", numIn("qa_c", "", 1, x => { v.c = x; upd(); }))),
            calc,
            h("button", { class: "btn primary block", style: { marginTop: "16px" }, onclick: () => {
              ["qa_k", "qa_p", "qa_f", "qa_c"].forEach(id => { const el = $("#" + id); if (el) el.dispatchEvent(new Event("change")); });
              const kcal = v.k || r0((v.p || 0) * 4 + (v.f || 0) * 9 + (v.c || 0) * 4);
              if (!kcal) { toast("Enter calories or macros"); return; }
              addEntry({ n: v.n.trim() || "Quick add", kcal, p: v.p || 0, f: v.f || 0, c: v.c || 0, unit: "entry", g: 0 }, 1, false);
              paintBody();
            } }, "Log"));
        } else if (st.tab === "scan") {
          foot.hidden = true;
          scanPane(body, f => portion(f));
        }
      };

      const portion = f => {
        stopScan();
        body.innerHTML = ""; foot.innerHTML = ""; foot.hidden = false;
        const canG = f.g > 0 && !/^100 (g|ml)$/.test(f.unit);
        const isPer100 = /^100 (g|ml)$/.test(f.unit);
        const pst = { mode: isPer100 ? "g" : "u", q: isPer100 ? 100 : 1 };
        const factor = () => pst.mode === "g" ? pst.q / (f.g || 100) : pst.q;
        const inp = h("input", { class: "inp", type: "number", inputmode: "decimal", step: "any", value: pst.q, oninput: e => { pst.q = +e.target.value || 0; paintRings(); } });
        const rings = h("div", { class: "mring" });
        const tg = tgtFor(SEL), tot = E.dayTotals(S, SEL);
        const paintRings = () => {
          const k = factor();
          rings.innerHTML = "";
          MAC.forEach(m => {
            const v = f[m.k] * k, t = tg ? tg[m.k] : null;
            const before = t ? clamp(tot[m.k] / t, 0, 1) : 0, add = t ? clamp(v / t, 0, 1 - before) : 0;
            const R = 22, L = 2 * Math.PI * R;
            rings.append(h("div", null,
              h("div", { html: `<svg viewBox="0 0 54 54"><circle cx="27" cy="27" r="${R}" fill="none" stroke-width="6" class="rtrack"/>` +
                `<circle cx="27" cy="27" r="${R}" fill="none" stroke-width="6" stroke="${m.color}" stroke-opacity=".35" class="rfill" stroke-dasharray="${L * before} ${L}" transform="rotate(-90 27 27)"/>` +
                `<circle cx="27" cy="27" r="${R}" fill="none" stroke-width="6" stroke="${m.color}" class="rfill" stroke-dasharray="${L * add} ${L}" transform="rotate(${-90 + before * 360} 27 27)"/></svg>` }),
              h("b", null, f0(v)), h("span", null, m.k === "kcal" ? "kcal" : m.label)));
          });
        };
        const step = dir => {
          const s = pst.mode === "g" ? 10 : pst.q < 1 || (dir < 0 && pst.q <= 1) ? 0.25 : 0.5;
          pst.q = Math.max(0, Math.round((pst.q + dir * s) * 100) / 100); inp.value = pst.q; paintRings();
        };
        const quick = h("div", { class: "quick" });
        const paintQuick = () => {
          quick.innerHTML = "";
          const opts = pst.mode === "g" ? [50, 100, 150, 200, 300].map(q => [`${q} g`, q])
            : f.tag === "sg" && /plate|bowl|set|pot/.test(f.unit) ? [["Small", 0.75], ["Regular", 1], ["Large", 1.25], ["Upsized", 1.5], ["2×", 2]]
            : [0.5, 1, 1.5, 2, 3].map(q => [`${q}×`, q]);
          opts.forEach(([l, q]) => quick.append(h("button", { class: q === pst.q ? "on" : null, onclick: () => { pst.q = q; inp.value = q; paintRings(); paintQuick(); } }, l)));
        };
        body.append(
          h("button", { class: "btn sm", style: { marginBottom: "14px" }, html: svg(I.back) + "Back", onclick: () => paintBody() }),
          h("div", { class: "portion" },
            h("h3", null, f.n),
            h("div", { class: "muted" }, `${f0(f.kcal)} kcal per ${f.unit}${canG ? ` (${f.g} g)` : ""}`),
            f.src === "hpb" ? h("div", { class: "srcnote" }, h("span", { class: "src" }, "HPB"), "Calories from Health Promotion Board figures (standard portion). Protein, fat and carbs are estimated.")
              : f.src === "est" ? h("div", { class: "srcnote" }, h("span", { class: "src est" }, "Est."), "Setpoint's estimate. Stall portions vary; save your own version if you eat this often.") : null,
            canG ? h("div", { style: { marginTop: "14px" } }, seg([f.unit, "grams"], 0, i => {
              const k = factor(); pst.mode = i ? "g" : "u"; pst.q = i ? r0(k * f.g) : Math.round(k * 100) / 100; inp.value = pst.q; paintQuick(); paintRings();
            }, "sm")) : null,
            h("div", { class: "stepper" }, h("button", { "aria-label": "Less", onclick: () => step(-1) }, "−"), inp, h("button", { "aria-label": "More", onclick: () => step(1) }, "+")),
            quick, rings));
        paintQuick(); paintRings();
        foot.append(h("button", { class: "btn primary block", style: { height: "54px" }, onclick: () => {
          if (!pst.q) return;
          addEntry(f, factor(), pst.mode === "g" ? pst.q : null);
          paintBody();
        } }, "Log food"));
      };

      const addEntry = (f, k, grams, quiet) => {
        const e = { id: uid(), name: f.n, unit: f.unit, g: f.g || 0, qty: Math.round(k * 100) / 100,
          base: { kcal: f.kcal, p: f.p, f: f.f, c: f.c },
          kcal: r0(f.kcal * k), p: r1(f.p * k), f: r1(f.f * k), c: r1(f.c * k), t: pad2(st.hour) + ":00" };
        if (grams) e.grams = r0(grams);
        (S.intake[SEL] = S.intake[SEL] || []).push(e);
        delete S.fasted[SEL];
        if (quiet) return;
        save(); paintTop(); toast(`Logged ${e.name} · ${e.kcal} kcal`);
        LOGGED = true;
      };

      paintTop(); paintTabs(); paintBody();
    }, () => { if (LOGGED) { LOGGED = false; render(false); } });
  }
  let LOGGED = false;

  /* ------------------------------------------------------ meal form */
  function mealForm(entries) {
    const picked = new Set(entries.map(e => e.id));
    let name = "";
    openSheet(sh => {
      const body = h("div", { class: "sheet-body" });
      const total = h("div", { class: "muted", style: { marginTop: "10px" } });
      const paintT = () => { const t = entries.filter(e => picked.has(e.id)).reduce((a, e) => a + e.kcal, 0); total.textContent = `${picked.size} items · ${f0(t)} kcal`; };
      const all = (S.intake[SEL] || []);
      body.append(h("h3", { style: { margin: "4px 0 14px", fontSize: "22px" } }, "Save as meal"),
        field("Meal name", h("input", { class: "inp", type: "text", placeholder: "Kopitiam breakfast", oninput: e => name = e.target.value })),
        h("div", { class: "lbl" }, "Foods"),
        h("div", { class: "card" }, all.map(e => h("label", { class: "row", style: { padding: "12px 0" } },
          h("input", { type: "checkbox", checked: picked.has(e.id) ? true : null, style: { width: "20px", height: "20px", accentColor: "var(--text)" },
            onchange: ev => { if (ev.target.checked) picked.add(e.id); else picked.delete(e.id); paintT(); } }),
          h("span", { class: "rt" }, h("b", { style: { fontSize: "16px" } }, e.name), h("span", null, `${e.grams ? e.grams + " g" : qtyTxt(e.qty) + " " + e.unit} · ${f0(e.kcal)} kcal`))))),
        total,
        h("button", { class: "btn primary block", style: { marginTop: "18px" }, onclick: () => {
          const items = all.filter(e => picked.has(e.id)).map(e => ({ n: e.name, kcal: e.base.kcal, p: e.base.p, f: e.base.f, c: e.base.c, unit: e.unit, g: e.g || 0, qty: e.qty, grams: e.grams || null }));
          if (!items.length) { toast("Pick at least one food"); return; }
          S.meals = S.meals || [];
          S.meals.unshift({ id: uid(), name: name.trim() || items.map(i => i.n.split(",")[0]).slice(0, 2).join(" + "), items });
          save(); closeSheet(); render(false); toast("Meal saved");
        } }, "Save meal"));
      paintT();
      sh.append(body);
    });
  }

  /* ------------------------------------------------------ edit entry */
  function entrySheet(e) {
    openSheet(sh => {
      const st = { q: e.grams || e.qty, hour: parseInt(e.t, 10), g: !!e.grams };
      const inp = h("input", { class: "inp", type: "number", inputmode: "decimal", step: "any", value: st.q, oninput: ev => { st.q = +ev.target.value || 0; paint(); } });
      const out = h("div", { class: "muted", style: { marginTop: "10px" } });
      const k = () => st.g ? st.q / (e.g || 100) : st.q;
      const paint = () => { const x = k(); out.textContent = `${r0(e.base.kcal * x)} kcal · ${r0(e.base.p * x)}P ${r0(e.base.f * x)}F ${r0(e.base.c * x)}C`; };
      paint();
      sh.append(h("div", { class: "sheet-body" },
        h("div", { class: "portion" }, h("h3", null, e.name), h("div", { class: "muted" }, `${f0(e.base.kcal)} kcal per ${e.unit}`)),
        h("div", { class: "fields", style: { marginTop: "16px" } },
          field(st.g ? "Grams" : `Amount (${e.unit})`, inp),
          field("Time", h("select", { class: "inp", onchange: ev => st.hour = +ev.target.value }, Array.from({ length: 24 }, (_, i) => h("option", { value: i, selected: i === st.hour ? true : null }, hourLabel(i)))))),
        out,
        h("button", { class: "btn primary block", style: { marginTop: "18px" }, onclick: () => {
          const x = k(); if (!x) return;
          Object.assign(e, { qty: st.g ? Math.round(x * 100) / 100 : st.q, kcal: r0(e.base.kcal * x), p: r1(e.base.p * x), f: r1(e.base.f * x), c: r1(e.base.c * x), t: pad2(st.hour) + ":" + (e.t.split(":")[1] || "00") });
          if (st.g) e.grams = r0(st.q);
          save(); closeSheet(); render(false); toast("Updated");
        } }, "Save"),
        h("div", { class: "btnrow", style: { marginTop: "10px" } },
          h("button", { class: "btn", html: svg(I.copy) + "Duplicate", onclick: () => { S.intake[SEL].push(Object.assign({}, e, { id: uid(), base: Object.assign({}, e.base) })); save(); closeSheet(); render(false); toast("Duplicated"); } }),
          h("button", { class: "btn", html: svg(I.list) + "Save as my food", onclick: () => {
            if (!S.custom.some(f => f.n === e.name)) S.custom.unshift({ id: uid(), n: e.name, kcal: r0(e.base.kcal), p: r1(e.base.p), f: r1(e.base.f), c: r1(e.base.c), unit: e.unit, g: e.g || 0, tag: "custom" });
            save(); toast("Saved to My Foods");
          } }),
          h("button", { class: "btn danger", html: svg(I.trash) + "Delete", onclick: () => {
            S.intake[SEL] = S.intake[SEL].filter(x => x.id !== e.id);
            if (!S.intake[SEL].length) delete S.intake[SEL];
            save(); closeSheet(); render(false); toast("Deleted");
          } }))));
    });
  }

  /* ----------------------------------------------------- food form */
  function foodForm(f, after) {
    const isNew = !f || !f.id;
    const v = Object.assign({ n: "", kcal: null, p: null, f: null, c: null, unit: "serving", g: 0 }, f || {});
    openSheet(sh => {
      sh.append(h("div", { class: "sheet-body" },
        h("h3", { style: { margin: "4px 0 14px", fontSize: "22px" } }, isNew ? "New food" : "Edit food"),
        field("Name", h("input", { class: "inp", type: "text", value: v.n, oninput: e => v.n = e.target.value })),
        h("div", { class: "fields", style: { marginTop: "12px" } },
          field("Unit", h("input", { class: "inp", type: "text", value: v.unit, placeholder: "serving, bowl, 100 g", oninput: e => v.unit = e.target.value })),
          field("Grams per unit (optional)", numIn("ff_g", v.g || "", 1, x => v.g = x || 0))),
        h("div", { class: "fields", style: { marginTop: "12px" } },
          field("Calories", numIn("ff_k", v.kcal, 1, x => v.kcal = x)),
          field("Protein (g)", numIn("ff_p", v.p, 0.1, x => v.p = x))),
        h("div", { class: "fields", style: { marginTop: "12px" } },
          field("Fat (g)", numIn("ff_f", v.f, 0.1, x => v.f = x)),
          field("Carbs (g)", numIn("ff_c", v.c, 0.1, x => v.c = x))),
        h("button", { class: "btn primary block", style: { marginTop: "18px" }, onclick: () => {
          ["ff_g", "ff_k", "ff_p", "ff_f", "ff_c"].forEach(id => { const el = $("#" + id); if (el) el.dispatchEvent(new Event("change")); });
          if (!v.n.trim()) { toast("Give it a name"); return; }
          const kcal = v.kcal || r0((v.p || 0) * 4 + (v.f || 0) * 9 + (v.c || 0) * 4);
          const food = { id: v.id || uid(), n: v.n.trim(), kcal, p: v.p || 0, f: v.f || 0, c: v.c || 0, unit: v.unit.trim() || "serving", g: v.g || 0, tag: "custom", barcode: v.barcode || null };
          const i = S.custom.findIndex(x => x.id === food.id);
          if (i >= 0) S.custom[i] = food; else S.custom.unshift(food);
          save(); closeSheet(true); toast("Saved");
          if (after) logSheet({ tab: "mine" }); else render(false);
        } }, "Save"),
        !isNew ? h("button", { class: "btn danger block", style: { marginTop: "10px" }, onclick: () => { S.custom = S.custom.filter(x => x.id !== v.id); save(); closeSheet(); render(false); toast("Deleted"); } }, "Delete") : null));
    });
  }

  /* -------------------------------------------------------- weigh-in */
  function weighSheet(date, then) {
    openSheet(sh => {
      const st = { d: date || today() };
      const cur = () => S.weights[st.d] || {};
      const v = { kg: cur().kg ?? null, bf: cur().bf ?? null, mm: cur().mm ?? null };
      const lw = E.latestWeight(S);
      const body = h("div", { class: "sheet-body" });
      sh.append(body);
      body.append(
        h("h3", { style: { margin: "4px 0 4px", fontSize: "22px" } }, "Log weigh-in"),
        h("div", { class: "muted", style: { marginBottom: "16px" } }, lw ? `Last: ${f1(lw.kg)} kg on ${dShort(lw.date)}` : "First weigh-in"),
        field("Date", h("input", { class: "inp", type: "date", value: st.d, max: today(), onchange: e => { st.d = e.target.value || today(); } })),
        h("div", { class: "fields three", style: { marginTop: "12px" } },
          field("Weight (kg)", numIn("w_kg", v.kg, 0.1, x => v.kg = x)),
          field("Body fat (%)", numIn("w_bf", v.bf, 0.1, x => v.bf = x, "optional")),
          field("Muscle (kg)", numIn("w_mm", v.mm, 0.1, x => v.mm = x, "optional"))),
        h("p", { class: "note" }, "Weigh first thing after the toilet, before eating or drinking. The trend smooths the rest."),
        h("button", { class: "btn primary block", style: { marginTop: "16px" }, onclick: () => {
          ["w_kg", "w_bf", "w_mm"].forEach(id => { const el = $("#" + id); if (el) el.dispatchEvent(new Event("change")); });
          if (!v.kg || v.kg < 25 || v.kg > 350) { toast("Enter a weight between 25 and 350 kg"); return; }
          S.weights[st.d] = { kg: r1(v.kg), bf: v.bf != null ? r1(v.bf) : null, mm: v.mm != null ? r1(v.mm) : null };   // typed by you: beats Apple Health
          if (!S.goal.startWeight) { S.goal.startWeight = r1(v.kg); S.goal.startDate = st.d; }
          save(); closeSheet(true); render(false); toast(`Saved ${f1(v.kg)} kg`);
          if (then) then();
        } }, "Save"),
        S.weights[st.d] ? h("button", { class: "btn danger block", style: { marginTop: "10px" }, onclick: () => { delete S.weights[st.d]; save(); closeSheet(); render(false); toast("Deleted"); } }, "Delete this weigh-in") : null);
      setTimeout(() => { const i = $("#w_kg"); if (i && !v.kg) i.focus(); }, 60);
    });
  }

  /* ------------------------------------------------------------ goal */
  function goalSheet(isNew) {
    const g = Object.assign({}, S.goal);
    const tr = E.trendAt(S, today(), trendSer());
    if (isNew && g.mode === "maintain") g.mode = "loss";
    openSheet(sh => {
      const body = h("div", { class: "sheet-body" });
      sh.append(body);
      const prev = h("div");
      const paint = () => {
        prev.innerHTML = "";
        if (!tr) { prev.append(h("p", { class: "note" }, "Log a weigh-in first to preview this goal.")); return; }
        const saved = S.goal; S.goal = g; invalidate();
        const t = E.computeTargets(S);
        S.goal = saved; invalidate();
        const rows = [kv("Current trend", `${f1(tr.trend)} kg`)];
        if (t.ready) {
          rows.push(kv("Average daily target", `${t.kcal} kcal`), kv("Rate", `${t.rateKgWk > 0 ? "+" : ""}${t.rateKgWk.toFixed(2)} kg/wk`));
          if (g.mode !== "maintain" && g.goalWeight && Math.sign(g.goalWeight - tr.trend) === Math.sign(t.rateKgWk) && t.rateKgWk) {
            rows.push(kv("Estimated arrival", dLong(addDays(today(), Math.round((g.goalWeight - tr.trend) / t.rateKgWk * 7)))));
          }
        }
        prev.append(h("div", { class: "card", style: { marginTop: "14px" } }, rows));
        if (t.ready) prev.append(h("div", { style: { marginTop: "10px" } }, flags(t.flags.filter(f => f.t !== "ok"))));
        const ib = g.mode !== "maintain" ? E.impliedBf(S, g.goalWeight) : null;
        if (ib != null && ib < (S.profile.sex === "m" ? 8 : 15)) prev.append(h("div", { class: "flag bad", style: { marginTop: "8px" } }, h("i"),
          h("div", null, `${f1(g.goalWeight)} kg would mean about ${Math.max(0, r0(ib))}% body fat even with zero muscle loss. Check the Goal Weight table in Body composition for a realistic number.`)));
      };
      const rateOut = h("b");
      const rateRow = h("div", { style: { marginTop: "18px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between" } }, h("span", { class: "muted" }, "Rate per week"), rateOut),
        h("input", { type: "range", min: 0.1, max: 1.5, step: 0.05, value: g.ratePct, style: { width: "100%", accentColor: "var(--text)", marginTop: "8px" },
          oninput: e => { g.ratePct = +e.target.value; paintRate(); paint(); } }),
        h("div", { class: "quick" }, [["Gentle", 0.25], ["Moderate", 0.5], ["Brisk", 0.75], ["Aggressive", 1.0]].map(([l, v]) =>
          h("button", { onclick: () => { g.ratePct = v; rateRow.querySelector("input").value = v; paintRate(); paint(); } }, `${l} ${v}%`))));
      const paintRate = () => { rateOut.textContent = `${g.ratePct.toFixed(2)}%${tr ? ` · ${(g.ratePct / 100 * tr.trend).toFixed(2)} kg` : ""}`; };
      const gwField = field("Goal weight (kg)", numIn("g_w", g.goalWeight, 0.1, x => { g.goalWeight = x; paint(); }));
      const showMode = () => { rateRow.hidden = g.mode === "maintain"; gwField.hidden = g.mode === "maintain"; };
      body.append(
        h("h3", { style: { margin: "4px 0 14px", fontSize: "22px" } }, isNew ? "New goal" : "Edit goal"),
        seg(["Lose", "Maintain", "Gain"], ["loss", "maintain", "gain"].indexOf(g.mode), i => { g.mode = ["loss", "maintain", "gain"][i]; showMode(); paint(); }),
        h("div", { style: { marginTop: "16px" } }, gwField),
        rateRow, prev,
        h("button", { class: "btn primary block", style: { marginTop: "18px" }, onclick: () => {
          const el = $("#g_w"); if (el) el.dispatchEvent(new Event("change"));
          Object.assign(S.goal, { mode: g.mode, goalWeight: g.mode === "maintain" ? null : g.goalWeight, ratePct: g.ratePct });
          if (isNew || !S.goal.startDate) { S.goal.startWeight = tr ? r1(tr.trend) : null; S.goal.startDate = today(); }
          save(); closeSheet(true);
          const c = E.makeCheckin(S);
          if (c) applyCheckin(c, "Goal saved, targets updated"); else { render(true); toast("Goal saved"); }
        } }, "Save goal"));
      paintRate(); showMode(); paint();
    });
  }

  /* --------------------------------------------------------- check-in */
  function applyCheckin(c, msg) {
    if (!c) { toast("Add a weigh-in first"); return; }
    S.program.checkins = S.program.checkins.filter(x => x.date !== c.date).concat([c]).sort((a, b) => a.date.localeCompare(b.date));
    save(); render(true); toast(msg || "Targets updated");
  }
  function checkinSheet(early) {
    const c = E.makeCheckin(S);
    if (!c) { toast("Add your profile and a weigh-in first"); return; }
    const prev = E.lastCheckin(S);
    const e = expAt(today());
    openSheet(sh => {
      const body = h("div", { class: "sheet-body" });
      sh.append(body);
      body.append(
        h("h3", { style: { margin: "4px 0 2px", fontSize: "24px" } }, early ? "Check in early" : "Weekly check-in"),
        h("div", { class: "muted" }, dLong(c.date)),
        h("div", { class: "card", style: { marginTop: "16px" } },
          h("div", { class: "stats3", style: { gridTemplateColumns: "1fr 1fr" } },
            h("div", { class: "stat" }, h("span", null, "New daily average"), h("b", null, num(c.kcal), h("small", null, "kcal"))),
            h("div", { class: "stat" }, h("span", null, "Change"), h("b", { style: { color: c.delta ? (c.delta.kcal > 0 ? "var(--good)" : c.delta.kcal < 0 ? "var(--pro)" : null) : null } }, c.delta ? sgn(c.delta.kcal) : "—", h("small", null, "kcal")))),
          programCols(c.weekday, c.weekend)));
      body.append(section("What moved"));
      const why = h("div", { class: "card" });
      if (c.delta) {
        why.append(
          kv("Expenditure", `${prev.exp} → ${c.exp} kcal (${sgn(c.delta.exp)})`),
          kv("Goal rate effect", `${sgn(c.delta.rateEffect)} kcal`),
          kv(`Trend weight, ${c.delta.days} days`, c.delta.trendKg != null ? `${c.delta.trendKg > 0 ? "+" : ""}${c.delta.trendKg.toFixed(1)} kg` : "—"));
      } else why.append(kv("Expenditure", `${c.exp} kcal`), kv("Target rate", `${c.rateKgWk.toFixed(2)} kg/wk`));
      why.append(
        kv("Confidence", e.se ? `± ${e.se} kcal (1σ)` : "formula only"),
        kv("Data used", e.window ? `${e.weighIns} weigh-ins · ${r0(e.coverage * 100)}% of days logged` : "not enough yet"));
      if (e.source !== "measured") why.append(h("p", { class: "note" }, "Still partly formula-based. It needs about two weeks of daily weigh-ins and logging before the measurement fully takes over."));
      body.append(why);
      if (c.flags.length) body.append(h("div", { style: { marginTop: "12px" } }, flags(c.flags)));
      body.append(h("div", { class: "btnrow", style: { marginTop: "18px" } },
        h("button", { class: "btn primary", style: { flex: 1 }, onclick: () => { closeSheet(true); applyCheckin(c, "Check-in complete"); } }, "Apply new targets"),
        h("button", { class: "btn", onclick: () => closeSheet() }, "Not now")));
    });
  }

  /* ---------------------------------------------------------- barcode */
  const ZXING = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js";
  let SCAN = null;
  function stopScan() {
    if (!SCAN) return;
    try { SCAN.stop && SCAN.stop(); } catch (e) { }
    try { SCAN.stream && SCAN.stream.getTracks().forEach(t => t.stop()); } catch (e) { }
    SCAN.dead = true; SCAN = null;
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function scanPane(body, onFood) {
    const status = h("div", { class: "muted", style: { marginTop: "12px", minHeight: "22px" } });
    const video = h("video", { playsinline: true, muted: true, autoplay: true });
    const box = h("div", { class: "scanbox" }, video, h("div", { class: "frame" }), h("div", { class: "laser" }));
    const manual = { code: "" };
    body.append(box, status,
      h("div", { class: "fields", style: { marginTop: "14px", gridTemplateColumns: "1fr auto", alignItems: "end" } },
        field("Or type the barcode", h("input", { class: "inp", type: "text", inputmode: "numeric", placeholder: "e.g. 8888196173103", oninput: e => manual.code = e.target.value.replace(/\D/g, "") })),
        h("button", { class: "btn primary", style: { height: "50px" }, onclick: () => manual.code && found(manual.code) }, "Look up")));
    const found = async code => {
      stopScan();
      box.hidden = true;
      status.textContent = `Looking up ${code}…`;
      const local = S.custom.find(f => f.barcode === code);
      if (local) { onFood(local); return; }
      try {
        const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_quantity`);
        const j = await r.json();
        if (j.status !== 1 || !j.product) throw new Error("nf");
        const p = j.product, n = p.nutriments || {};
        const k100 = n["energy-kcal_100g"] ?? (n["energy_100g"] ? n["energy_100g"] / 4.184 : null);
        if (k100 == null) throw new Error("nokcal");
        const sq = +p.serving_quantity || 0;
        const per = sq > 0 ? sq / 100 : 1;
        const food = { id: uid(), barcode: code, tag: "custom",
          n: [p.product_name, p.brands && p.brands.split(",")[0]].filter(Boolean).join(" · ") || `Product ${code}`,
          kcal: r0(k100 * per), p: r1((n.proteins_100g || 0) * per), f: r1((n.fat_100g || 0) * per), c: r1((n.carbohydrates_100g || 0) * per),
          unit: sq > 0 ? "serving" : "100 g", g: sq > 0 ? sq : 100 };
        S.custom.unshift(food); save();
        toast("Found and saved to My Foods");
        onFood(food);
      } catch (e) {
        status.innerHTML = "";
        status.append(`No match for ${code} in Open Food Facts. `,
          h("button", { class: "link", style: { fontSize: "15px" }, onclick: () => foodForm({ n: "", barcode: code }) }, "Add it yourself"));
      }
    };
    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { box.hidden = true; status.textContent = "Camera isn't available here. Type the barcode instead."; return; }
      const me = SCAN = { dead: false };
      try {
        if ("BarcodeDetector" in window) {
          const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
          me.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          if (me.dead) { me.stream.getTracks().forEach(t => t.stop()); return; }
          video.srcObject = me.stream; await video.play();
          status.textContent = "Point at a barcode";
          const tick = async () => {
            if (me.dead) return;
            try { const c = await det.detect(video); if (c && c.length) { found(c[0].rawValue); return; } } catch (e) { }
            setTimeout(tick, 180);
          };
          tick();
        } else {
          status.textContent = "Starting camera…";
          await loadScript(ZXING);
          if (me.dead) return;
          const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video, (res, err, ctl) => {
            if (res && !me.dead) { ctl.stop(); found(res.getText()); }
          });
          me.stop = () => controls.stop();
          if (me.dead) controls.stop(); else status.textContent = "Point at a barcode";
        }
      } catch (e) {
        box.hidden = true;
        status.textContent = "Couldn't open the camera (permission denied, or not allowed here). Type the barcode instead.";
      }
    })();
  }

  /* =================================================================
     SYNC — Cloudflare Worker, encrypted. Config lives in its own
     localStorage key (never synced); the derived AES key lives in
     IndexedDB as a non-extractable CryptoKey, so the passphrase itself
     is never stored anywhere.
     ================================================================= */
  const SKEY = "setpoint.sync";
  let SC = (() => { try { return JSON.parse(localStorage.getItem(SKEY) || "{}"); } catch (e) { return {}; } })();
  const saveSC = () => { try { localStorage.setItem(SKEY, JSON.stringify(SC)); } catch (e) { } };
  let CKEY = null, SYNCING = false, syncT = null;
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("setpoint", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("keys");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function keyGet() { try { const db = await idb(); return await new Promise(res => { const q = db.transaction("keys").objectStore("keys").get("sync"); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } }
  async function keyPut(k) { try { const db = await idb(); await new Promise(res => { const t = db.transaction("keys", "readwrite"); t.objectStore("keys").put(k, "sync"); t.oncomplete = res; t.onerror = res; }); } catch (e) { } }
  async function keyDel() { try { const db = await idb(); await new Promise(res => { const t = db.transaction("keys", "readwrite"); t.objectStore("keys").delete("sync"); t.oncomplete = res; t.onerror = res; }); } catch (e) { } }
  function scheduleSync() {
    if (!SC.enabled) return;
    clearTimeout(syncT); syncT = setTimeout(() => runSync("change"), 4000);
  }
  async function runSync(reason) {
    if (!SC.enabled || SYNCING) return;
    if (!navigator.onLine && reason !== "manual") return;
    CKEY = CKEY || await keyGet();
    if (!CKEY) { SC.lastErr = "Enter your passphrase again on this device."; saveSC(); paintSyncDot(); return; }
    SYNCING = true; paintSyncDot();
    try {
      const r = await Y.syncOnce(S, { cli: Y.client(SC), key: CKEY, salt: SC.salt });
      if (r.changed) {
        S = merge(r.S); SNAP = Y.hashes(S); persist(); render(false);
        if (r.health) toast(`Apple Health: ${r.health} update${r.health === 1 ? "" : "s"} added`);
      }
      SC.lastSync = Date.now(); SC.lastErr = null; SC.ver = r.ver;
      if (reason === "manual") toast("Synced");
    } catch (e) {
      SC.lastErr = e.message;
      if (reason === "manual" || e.code === "AUTH" || e.code === "BAD_PASS") toast(e.message);
    } finally { SYNCING = false; saveSC(); paintSyncDot(); }
  }
  function syncLabel() {
    if (!SC.enabled) return "Not set up";
    if (SYNCING) return "Syncing…";
    if (SC.lastErr) return SC.lastErr;
    if (!SC.lastSync) return "Connected";
    const m = Math.round((Date.now() - SC.lastSync) / 60000);
    return m < 1 ? "Synced just now" : m < 60 ? `Synced ${m} min ago` : `Synced ${dShort(E.isoDate(new Date(SC.lastSync)))}`;
  }
  function paintSyncDot() { document.querySelectorAll("[data-syncstatus]").forEach(el => { if (!el.classList.contains("sdot")) el.textContent = syncLabel(); el.dataset.state = !SC.enabled ? "off" : SC.lastErr ? "err" : SYNCING ? "busy" : "ok"; }); }

  function viewSync() {
    const root = h("div");
    root.append(subhead("Sync & Apple Health"));
    const f = { url: SC.url || "", appKey: SC.appKey || "", inboxKey: SC.inboxKey || "", pass: "", pass2: "" };
    root.append(h("div", { class: "card syncstatus" },
      h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, h("i", { class: "sdot", "data-syncstatus": "", "data-state": "off" }), h("b", { "data-syncstatus": "" }, syncLabel())),
      SC.enabled ? h("div", { class: "btnrow", style: { marginTop: "12px" } },
        h("button", { class: "btn primary", onclick: () => runSync("manual") }, "Sync now"),
        h("button", { class: "btn", onclick: () => confirmSheet("Disconnect this device?", "Stops syncing on this device and forgets the key. Your data stays here and in the cloud.", "Disconnect", async () => { SC.enabled = false; CKEY = null; await keyDel(); saveSC(); render(false); }) }, "Disconnect")) : null));
    setTimeout(paintSyncDot, 0);

    if (!SC.enabled) {
      const keysOut = h("div");
      root.append(section("1 · Worker"));
      root.append(h("div", { class: "card" },
        h("p", { class: "note", style: { marginTop: 0 } }, "Deploy the Worker in the repo's worker folder to your free Cloudflare account (walkthrough in worker/README.md), then paste its address here."),
        field("Worker address", h("input", { class: "inp", type: "url", placeholder: "https://setpoint-sync.yourname.workers.dev", value: f.url, oninput: e => f.url = e.target.value.trim() })),
        h("div", { style: { height: "12px" } }),
        field("App key", h("input", { class: "inp", id: "sy_app", type: "text", autocomplete: "off", value: f.appKey, oninput: e => f.appKey = e.target.value.trim() })),
        h("button", { class: "btn sm", style: { marginTop: "12px" }, onclick: () => {
          f.appKey = Y.randomKey(); f.inboxKey = Y.randomKey(); $("#sy_app").value = f.appKey;
          keysOut.innerHTML = "";
          keysOut.append(h("p", { class: "note" }, "New keys. In Cloudflare, add both as secrets on the Worker (Settings → Variables and Secrets), with exactly these names:"),
            copyRow("APP_KEY", f.appKey), copyRow("INBOX_KEY", f.inboxKey),
            h("p", { class: "note" }, "They're saved on this device when you connect. On your other devices, paste the same app key rather than generating new ones."));
        } }, "Generate keys for a new Worker"),
        keysOut));
      root.append(section("2 · Passphrase"));
      root.append(h("div", { class: "card" },
        h("p", { class: "note", style: { marginTop: 0 } }, "Your data is encrypted with this before it leaves the phone. Cloudflare never sees it. Use the same passphrase on every device. If you lose it, the cloud copy can't be recovered (this device's copy is unaffected)."),
        field("Passphrase", h("input", { class: "inp", type: "password", autocomplete: "new-password", oninput: e => f.pass = e.target.value })),
        h("div", { style: { height: "12px" } }),
        field("Confirm", h("input", { class: "inp", type: "password", autocomplete: "new-password", oninput: e => f.pass2 = e.target.value }))));
      root.append(h("button", { class: "btn primary block", style: { marginTop: "16px", height: "54px" }, onclick: () => connect(f) }, "Connect this device"));
    } else {
      root.append(section("Apple Health"));
      root.append(h("div", { class: "card" },
        h("p", { class: "note", style: { marginTop: 0 } }, "A Shortcut on your iPhone sends each morning's weigh-in, body fat and steps to the Worker's inbox. Setpoint picks them up the next time it syncs. A weight you type yourself always wins over the Health reading for that day."),
        SC.inboxKey ? copyRow("Inbox key (for the Shortcut)", SC.inboxKey) : h("p", { class: "note" }, "The inbox key was generated on another device. Copy it from there, or from Cloudflare."),
        copyRow("Inbox address", (SC.url || "").replace(/\/+$/, "") + "/inbox"),
        h("button", { class: "btn block", style: { marginTop: "12px" }, onclick: () => push({ v: "shortcut" }) }, "Set up the Shortcut")));
      root.append(section("This device"));
      root.append(h("div", { class: "card" }, kv("Worker", (SC.url || "").replace(/^https?:\/\//, "")), kv("Cloud version", SC.ver || "—"), kv("Encryption", "AES-GCM 256, key from your passphrase")));
    }
    return root;
  }
  function copyRow(label, value) {
    return h("div", { class: "copyrow" }, h("span", null, label), h("code", null, value),
      h("button", { class: "btn sm", onclick: () => { if (navigator.clipboard) navigator.clipboard.writeText(value).then(() => toast("Copied")).catch(() => toast("Select and copy it manually")); else toast("Select and copy it manually"); } }, "Copy"));
  }
  async function connect(f) {
    if (!/^https:\/\/.+/.test(f.url)) { toast("Enter the Worker's https address"); return; }
    if (!f.appKey || f.appKey.length < 16) { toast("Enter the app key (or generate one)"); return; }
    if (f.pass.length < 8) { toast("Use a passphrase of at least 8 characters"); return; }
    if (f.pass !== f.pass2) { toast("The two passphrases don't match"); return; }
    toast("Connecting…");
    const cli = Y.client({ url: f.url, appKey: f.appKey });
    try {
      const info = await cli.ping();
      if (!info || info.service !== "setpoint-sync") throw new Error("That address isn't a Setpoint Worker.");
      if (!info.configured) throw new Error("The Worker is missing its secrets or KV binding. See worker/README.md.");
      const cur = await cli.getState();
      const salt = cur.blob ? cur.blob.salt : Y.randomB64(16);
      const key = await Y.deriveKey(f.pass, salt);
      let remote = null;
      if (cur.blob) remote = await Y.open(cur.blob, key);   // throws BAD_PASS on the wrong passphrase
      const finish = async (mode) => {
        if (mode === "replace" && remote) { S = merge(remote); S.settings.demo = false; SNAP = Y.hashes(S); persist(); }
        else if (S.settings.demo) { const th = S.settings.theme; S = blank(); S.settings.theme = th; SNAP = Y.hashes(S); persist(); }
        Object.assign(SC, { url: f.url, appKey: f.appKey, inboxKey: f.inboxKey || SC.inboxKey || "", salt, enabled: true, lastErr: null });
        CKEY = key; await keyPut(key); saveSC();
        await runSync("manual"); render(true);
      };
      if (remote) {
        const nW = Object.keys(remote.weights || {}).length, nD = Object.keys(remote.intake || {}).length;
        openSheet(sh => sh.append(h("div", { class: "sheet-body" },
          h("h3", { class: "stitle" }, "Cloud copy found"),
          h("p", { class: "note" }, `${nW} weigh-ins and ${nD} logged days are already in the cloud. What should happen to this device's data?`),
          h("button", { class: "btn primary block", style: { marginTop: "14px" }, onclick: () => { closeSheet(true); finish("replace"); } }, "Use the cloud copy"),
          S.settings.demo ? null : h("button", { class: "btn block", style: { marginTop: "10px" }, onclick: () => { closeSheet(true); finish("merge"); } }, "Merge both"),
          h("p", { class: "note" }, S.settings.demo ? "This device only has example data, so it'll be replaced." : "Merge keeps everything from both. Pick this if you've logged on this device too."))));
      } else await finish("merge");
    } catch (e) { toast(e.message); }
  }

  function viewShortcut() {
    const root = h("div");
    root.append(subhead("Apple Health Shortcut"));
    const step = (n, title, body) => h("div", { class: "step" }, h("i", null, n), h("div", null, h("b", null, title), body));
    const url = (SC.url || "https://YOUR-WORKER.workers.dev").replace(/\/+$/, "") + "/inbox";
    root.append(h("div", { class: "card" },
      h("p", { class: "note", style: { marginTop: 0 } }, "About five minutes, once. Every morning after that: step on the scale, open Zepp Life so it syncs, close it. The Shortcut runs by itself when Zepp Life closes. Apple Health can't be read while the phone is locked, which is why it triggers on closing Zepp Life rather than at a set time."),
      h("p", { class: "note" }, "First check Zepp Life shares with Health: Health app → your profile → Apps → Zepp Life → turn on Weight and Body Fat Percentage.")));
    root.append(h("div", { class: "card steps-card" },
      step(1, "Create the Shortcut", h("span", null, "Shortcuts app → + → name it “Setpoint Health”.")),
      step(2, "Latest weight", h("span", null, "Add ", h("em", null, "Find Health Samples"), ": Type = Weight, Sort by Start Date, Order Latest First, Limit 1. Then ", h("em", null, "Get Details of Health Sample"), " → Value. Rename that variable “Weight”.")),
      step(3, "Latest body fat", h("span", null, "Repeat with Type = Body Fat Percentage → Value. Rename it “BodyFat”.")),
      step(4, "Today's steps", h("span", null, "Add ", h("em", null, "Find Health Samples"), ": Type = Steps, Start Date is today. Then ", h("em", null, "Calculate Statistics"), " → Sum. Rename it “Steps”.")),
      step(5, "Date", h("span", null, "Add ", h("em", null, "Format Date"), " on Current Date, Custom format ", h("code", null, "yyyy-MM-dd"), ". Rename it “Day”.")),
      step(6, "Send it", h("span", null, "Add ", h("em", null, "Get Contents of URL"), ":", h("br"), "URL: ", h("code", null, url), h("br"), "Method: POST", h("br"),
        "Headers: ", h("code", null, "Authorization"), " = ", h("code", null, "Bearer " + (SC.inboxKey || "YOUR-INBOX-KEY")), h("br"),
        "Request Body: JSON with fields ", h("code", null, "date"), " = Day, ", h("code", null, "weight"), " = Weight, ", h("code", null, "bodyFat"), " = BodyFat, ", h("code", null, "steps"), " = Steps.")),
      step(7, "Test it", h("span", null, "Tap ▶. You should see ", h("code", null, "{\"ok\":true,…}"), ". Open Setpoint and the weigh-in appears after it syncs.")),
      step(8, "Automate it", h("span", null, "Automation tab → + → App → Zepp Life → ", h("em", null, "Is Closed"), " → Run Immediately → pick “Setpoint Health”."))));
    root.append(h("p", { class: "note" }, "The inbox key can only add readings. If it ever leaks, the worst anyone can do is add a fake weigh-in, which you can delete. Units are handled: pounds are converted, and body fat as 0.32 or 32% both work."));
    if (SC.inboxKey) root.append(copyRow("Inbox key", SC.inboxKey));
    return root;
  }

  /* =================================================================
     boot
     ================================================================= */
  function boot() {
    const X = {
      h, svg, I, $, E, C, S: () => S, save, render, push, back, go, top: () => (STACK[STACK.length - 1] || {}).v,
      openSheet, closeSheet, openMenu, confirmSheet, toast, seg, head, subhead, iconBtn, section, kv, flags, field, numIn, selIn,
      tile, num, countUps, CW, uid, dShort, dLong, DOW, DOW1, f0, f1
    };
    TR = window.SPTrain(X);
    Object.assign(SCREENS, TR.screens);
    if (!load()) seedDemo();
    applyTheme();
    $("#dockSearch").addEventListener("click", e => { if (!e.target.closest(".scan")) logSheet({}); });
    $("#dockScan").addEventListener("click", e => { e.stopPropagation(); logSheet({ tab: "scan" }); });
    $("#dockPlus").addEventListener("click", () => fabMenu());
    if (location.hash === "#log") TAB = "log";
    else if (location.hash === "#train") TAB = "train";
    else if (location.hash === "#strategy") TAB = "strategy";
    render(true);
    let rw = window.innerWidth, rt;
    window.addEventListener("resize", () => { if (Math.abs(window.innerWidth - rw) < 24) return; rw = window.innerWidth; clearTimeout(rt); rt = setTimeout(() => render(false), 160); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && SEL > today()) { SEL = today(); render(false); }
    });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
    if (SC.enabled) setTimeout(() => runSync("open"), 600);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") runSync("focus"); });
    window.addEventListener("online", () => runSync("online"));
  }
  window.Setpoint = { get state() { return S; }, render, seedDemo };
  boot();
})();
