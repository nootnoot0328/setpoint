/* ==========================================================================
   Setpoint — training module.
   Plan builder, workout logger with reps-in-reserve, double progression,
   rest timer, session difficulty rating, HIIT interval timer with voice
   cues and screen wake lock, exercise library.

   Registers itself as window.SPTrain; app.js calls it with shared helpers
   (ctx) before first render. Maths lives in engine.js so it can be tested.
   ========================================================================== */
(function () {
  "use strict";
  window.SPTrain = function (X) {
    const { h, svg, I, $, E, C } = X;
    const EX = window.SP_EX;
    const S = () => X.S();
    const T = () => { const s = S(); if (!s.train) s.train = { profile: null, plan: null, log: [], active: null }; if (!s.train.log) s.train.log = []; return s.train; };
    const ALL = () => window.SP_EXALL || null;
    const exOf = id => EX.ex[id] || (ALL() && ALL()[id]) || { id, n: String(id).replace(/_/g, " "), type: "reps", pats: [], steps: [], img: false, eq: "bw", eqn: "Other", inc: 0, mus: [], sec: [] };
    let allP = null;
    function ensureAll() {
      if (ALL()) return Promise.resolve(ALL());
      if (!allP) allP = new Promise((res, rej) => {
        const sc = document.createElement("script"); sc.src = "js/exlib-full.js";
        sc.onload = () => res(ALL()); sc.onerror = () => { allP = null; rej(new Error("Couldn't load the exercise library")); };
        document.head.appendChild(sc);
      });
      return allP;
    }
    const EQUIP = ["Bodyweight", "Pull-up bar", "Dumbbell", "Kettlebell", "Band", "Barbell", "Cable", "Machine", "Other"];
    function defaultEquip() {
      const p = (T().profile && T().profile.equip) || [];
      const s = new Set(["Bodyweight"]);
      if (p.includes("bar")) s.add("Pull-up bar");
      if (p.includes("db")) ["Dumbbell", "Kettlebell", "Band"].forEach(x => s.add(x));
      if (p.includes("gym")) EQUIP.forEach(x => s.add(x));
      return [...s];
    }
    const EQ_LABEL = { bw: "Bodyweight", bar: "Pull-up bar", db: "Dumbbells", gym: "Gym" };
    const RATING = ["Way too easy", "Easy", "Just right", "Hard", "Way too hard"];
    const TI = {
      dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
      run: '<circle cx="14" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v4M6 12l3-4 4 1 3 4 3 1M11 15l-2-3"/>',
      play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
      pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
      skip: '<path d="M6 5l10 7-10 7zM18 5v14"/>',
      check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
      voice: '<path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/>',
      mute: '<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/>'
    };
    const mins = ms => Math.max(1, Math.round(ms / 60000));
    const mmss = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

    /* ---------------------------------------------------- demo images
       Two-frame loop (start / end position) makes a lightweight "GIF". */
    /* Images load from the exercise database's own GitHub copy via the
       jsDelivr CDN (pinned commit), falling back to raw.githubusercontent,
       then to an icon. The service worker caches each one after first use. */
    function imgSrc(id, i, raw) { return (raw ? EX.IMG.raw : EX.IMG.cdn) + encodeURIComponent(id) + "/" + i + ".jpg"; }
    function demo(ex, cls) {
      const icon = svg(ex.pats && ex.pats.includes("hiit") ? TI.run : TI.dumbbell);
      if (!ex.img) return h("div", { class: "demo none " + (cls || ""), html: icon });
      const d = h("div", { class: "demo " + (cls || "") });
      const mk = (i, extra) => {
        const im = h("img", { src: imgSrc(ex.id, i), alt: i ? "" : ex.n + " demonstration", loading: "lazy", decoding: "async", class: extra || null });
        im.onerror = () => {
          if (!im.dataset.raw) { im.dataset.raw = "1"; im.src = imgSrc(ex.id, i, true); }
          else if (!i) { d.classList.add("none"); d.innerHTML = icon; }
          else im.remove();
        };
        return im;
      };
      d.append(mk(0), mk(1, "f2"));
      return d;
    }

    function lastFor(exId, beforeId) {
      const log = T().log;
      for (let i = log.length - 1; i >= 0; i--) {
        const s = log[i];
        if (s.type !== "lift" || s.id === beforeId) continue;
        const e = s.ex.find(x => x.ex === exId && x.sets.some(y => y.done));
        if (e) return Object.assign({ date: s.date }, e);
      }
      return null;
    }
    function targetText(slot, ex, t) {
      if (ex.type === "time") return `${slot.sets} × ${t.reps}`;
      return `${slot.sets} × ${t.reps}${t.w != null && ex.type === "load" ? ` · ${t.w} kg` : ""}`;
    }
    function lastText(last, ex) {
      if (!last) return null;
      const ds = last.sets.filter(s => s.done);
      const body = ex.type === "load"
        ? `${ds[0].w ?? "?"} kg × ${ds.map(s => s.reps).join(", ")}`
        : ex.type === "time" ? ds.map(s => s.reps + "s").join(", ") : `${ds.map(s => s.reps).join(", ")} reps`;
      return `Last (${X.dShort(last.date)}): ${body}`;
    }

    /* ============================================================ RECOVERY */
    let MAPVIEW = 0;
    const hrs = n => n >= 24 ? `${Math.floor(n / 24)} d ${n % 24} h` : `${n} h`;
    function recoveryBlock(rec) {
      const tired = Object.entries(rec).filter(([, v]) => v.status !== "ready").sort((a, b) => b[1].fatigue - a[1].fatigue);
      const out = [bodyMap({ recovery: rec }), legend()];
      if (tired.length) out.push(h("div", { class: "musclelist" }, tired.map(([r, v], i) => h("div", { class: "hb rec" },
        h("span", null, E.REGION_NAME[r]),
        h("div", { class: "hbt" }, h("i", { class: "r-" + v.status, style: { width: `${Math.min(100, v.fatigue * 100)}%`, "--i": i } })),
        h("b", null, hrs(v.hoursLeft))))));
      else out.push(h("div", { class: "empty-state" }, "Everything's recovered. Train whatever you like."));
      out.push(h("p", { class: "note" }, "An estimate from what you logged, not a measurement. Hard sets in the last few days load each muscle; the load fades over about 72 h for big groups (legs, back, chest) and 48 h for smaller ones. Sets near failure count more. Times show when a muscle drops back to ready. If you feel fine sooner, you probably are."));
      return out;
    }
    function legend() {
      return h("div", { class: "rlegend" }, [["m-off", "Ready"], ["r-nearly", "Nearly ready"], ["r-recovering", "Recovering"], ["m-on", "Selected"]]
        .map(([c, t]) => h("span", null, h("i", { class: c }), t)));
    }
    // regions a plan day works that are still recovering
    function dayConflicts(day, rec) {
      const regs = new Set();
      day.slots.forEach(sl => { const x = exOf(sl.ex); (x.mus || []).map(E.muscleToRegion).filter(Boolean).forEach(r => regs.add(r)); if (E.PAT_GROUP_REGION[sl.pat]) regs.add(E.PAT_GROUP_REGION[sl.pat]); });
      return [...regs].filter(r => rec[r] && rec[r].status === "recovering").sort((a, b) => rec[b].fatigue - rec[a].fatigue);
    }

    /* ============================================================ HOME */
    function viewTrain() {
      const tr = T(), root = h("div");
      root.append(X.head("Train", X.iconBtn("dots", "Training options", () => X.openMenu([
        ["sliders", tr.plan ? "Rebuild plan" : "Build a plan", () => planWizard()],
        ["book", "Exercise library", () => X.push({ v: "library" })],
        tr.log.length ? ["clock", "All sessions", () => X.push({ v: "trainhist" })] : null
      ]))));

      if (tr.active) root.append(h("button", { class: "banner", style: { width: "100%", textAlign: "left" }, onclick: () => X.push({ v: "workout" }) },
        h("span", null, `${tr.active.name} in progress · started ${new Date(tr.active.started).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`),
        h("b", { style: { marginLeft: "auto" } }, "Resume")));

      if (!tr.plan) {
        root.append(h("div", { class: "card" },
          h("h3", { class: "ctitle" }, "Build your plan"),
          h("p", { class: "note", style: { marginTop: "6px" } }, "Tell Setpoint your goal, how often you can train and what equipment you have. It picks exercises for each movement pattern, sets rep ranges, and moves you up as you get stronger."),
          h("button", { class: "btn primary block", style: { marginTop: "16px" }, onclick: () => planWizard() }, "Build plan")));
      } else {
        const plan = tr.plan;
        let pick = plan.next % plan.days.length;
        root.append(X.section("Next Workout"));
        const card = h("div", { class: "card" });
        const paint = () => {
          card.innerHTML = "";
          const day = plan.days[pick];
          card.append(h("div", { class: "daychips" }, plan.days.map((d, i) => h("button", { class: "chip" + (i === pick ? " on" : ""), onclick: () => { pick = i; paint(); } }, d.name))));
          card.append(h("div", { class: "plist" }, day.slots.map(sl => {
            const ex = exOf(sl.ex), t = E.nextTarget(sl, ex, lastFor(sl.ex));
            return h("button", { class: "pex", onclick: () => exInfo(ex) }, demo(ex, "sm"),
              h("div", { class: "pt" }, h("b", null, ex.n), h("span", null, targetText(sl, ex, t))),
              h("span", { html: svg(I.chev, "chev") }));
          })));
          const rec = E.recovery(S()), clash = dayConflicts(day, rec);
          if (clash.length) {
            const others = plan.days.map((d, i) => ({ i, n: dayConflicts(d, rec).length })).filter(o => o.i !== pick).sort((a, b) => a.n - b.n);
            const better = others.find(o => o.n === 0);
            const names = clash.slice(0, 3).map(r => E.REGION_NAME[r]);
            card.append(h("div", { class: "recwarn" },
              h("b", null, `${names.join(", ")} still recovering`),
              h("span", null, `About ${hrs(rec[clash[0]].hoursLeft)} to go. ` + (better ? `${plan.days[better.i].name} works fresher muscles today.` : "Going ahead is fine if you feel good; expect to be a little weaker, and don't chase a new best.")),
              better ? h("button", { class: "chip static", onclick: () => { pick = better.i; paint(); } }, `Switch to ${plan.days[better.i].name}`) : null));
          }
          const est = day.slots.reduce((a, s) => a + s.sets * (s.rest + 45), 0);
          card.append(h("button", { class: "btn primary block", style: { marginTop: "14px", height: "54px" }, disabled: tr.active ? true : null, onclick: () => startWorkout(pick) },
            h("span", { html: svg(TI.play) }), `Start ${day.name}`, h("span", { class: "muted small", style: { fontWeight: 400 } }, ` · ~${Math.round(est / 60)} min`)));
        };
        paint();
        root.append(card);
      }

      // freestyle
      root.append(X.section("Freestyle"));
      root.append(h("button", { class: "card fscard", onclick: () => X.push({ v: "freestyle" }) },
        bodyMap({ recovery: E.recovery(S()) }),
        h("div", null, h("b", null, "Pick muscles, get a workout"), h("span", null, "Tap the body diagram and Setpoint picks exercises for the equipment you have today, steering around muscles that are still recovering."),
          h("span", { class: "go" }, "Open body map ›"))));
      ensureAll().catch(() => { });   // warm the full library in the background

      // conditioning
      root.append(X.section("Conditioning"));
      root.append(h("div", { class: "presets" }, Object.entries(PRESETS).map(([k, p]) =>
        h("button", { class: "preset", onclick: () => hiitSheet(k) },
          h("b", null, p.name), h("span", null, `${p.work}s on · ${p.rest}s off`),
          h("span", null, `${p.rounds} rounds · ${mmss(10 + p.rounds * p.work + (p.rounds - 1) * p.rest)}`)))));

      // this week
      root.append(X.section("This Week"));
      const ws = E.weekStart(E.today()), days = E.range(ws, E.addDays(ws, 6));
      const wk = tr.log.filter(s => s.date >= ws && s.date <= days[6]);
      const lifts = wk.filter(s => s.type === "lift").length, hiits = wk.filter(s => s.type === "hiit").length;
      const planned = tr.plan ? Math.min(tr.plan.perWeek, 4) : null;
      const heat = E.muscleSets(S(), ws, days[6]);
      const heatList = Object.entries(heat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      root.append(h("div", { class: "card" },
        h("div", { class: "weekdots" }, days.map(d => {
          const ss = wk.filter(s => s.date === d);
          return h("div", { class: "wd" + (d === E.today() ? " today" : "") },
            h("i", { class: ss.some(s => s.type === "lift") ? "lift" : ss.some(s => s.type === "hiit") ? "hiit" : "" }), X.DOW1[E.weekday(d)]);
        })),
        h("div", { class: "muted", style: { textAlign: "center", marginTop: "10px", fontSize: "15px" } },
          `${lifts} lifting${planned ? ` of ${planned} planned` : ""} · ${hiits} conditioning`),
        h("div", { class: "divider" }),
        (() => {
          const box = h("div");
          const paintMap = () => {
            box.innerHTML = "";
            box.append(X.seg(["Recovery", "Weekly sets"], MAPVIEW, i => { MAPVIEW = i; paintMap(); }, "mapseg"));
            if (MAPVIEW === 0) box.append(...recoveryBlock(E.recovery(S())));
            else box.append(bodyMap({ heat }),
              heatList.length ? h("div", { class: "musclelist" }, heatList.map(([r, v], i) => h("div", { class: "hb" },
                h("span", null, E.REGION_NAME[r]),
                h("div", { class: "hbt" }, h("i", { style: { width: `${Math.min(100, v / 20 * 100)}%`, "--i": i } }), h("em", { style: { left: "50%" } })),
                h("b", null, Math.round(v * 10) / 10))))
                : h("div", { class: "empty-state" }, "No lifting logged this week yet."),
              h("p", { class: "note" }, "Hard sets per muscle this week; secondary muscles count as half a set. The tick marks 10 sets, roughly where most of the growth benefit shows up in the research (Schoenfeld et al., J Sports Sci 2017). Fewer still works; it's just slower."));
          };
          paintMap();
          return box;
        })()));

      // history
      if (tr.log.length) {
        root.append(X.section("Recent", "See all", () => X.push({ v: "trainhist" })));
        root.append(h("div", { class: "card" }, tr.log.slice(-5).reverse().map(histRow)));
      }
      return root;
    }
    function histRow(s) {
      const nsets = s.type === "lift" ? s.ex.reduce((a, e) => a + e.sets.filter(x => x.done).length, 0) : null;
      return h("button", { class: "hist", style: { width: "100%", textAlign: "left" }, onclick: () => sessionSheet(s) },
        h("div", { class: "d" }, X.dLong(s.date)),
        h("div", { class: "w", style: { fontSize: "19px" } }, s.name),
        h("div", { class: "r" }, h("b", null, `${s.dur} min`), s.type === "lift" ? `${nsets} sets` : `${s.rounds} rounds`, s.rating ? h("div", null, RATING[s.rating - 1]) : null));
    }
    function viewHist() {
      const root = h("div");
      root.append(X.subhead("Sessions"));
      const log = T().log.slice().reverse();
      root.append(h("div", { class: "card" }, log.length ? log.map(histRow) : h("div", { class: "empty-state" }, "No sessions yet.")));
      return root;
    }
    function sessionSheet(s) {
      X.openSheet(sh => {
        const body = h("div", { class: "sheet-body" });
        body.append(h("h3", { class: "stitle" }, s.name), h("div", { class: "muted" }, `${X.dLong(s.date)} · ${s.dur} min${s.rating ? " · " + RATING[s.rating - 1] : ""}`));
        const kg = (E.latestWeight(S()) || {}).kg;
        if (kg) body.append(h("p", { class: "note" }, `About ${E.sessionKcal(s.type, s.dur, kg)} kcal by MET estimate. That's already inside your measured expenditure, so Setpoint doesn't add it to your food budget.`));
        if (s.type === "lift") body.append(h("div", { class: "card", style: { marginTop: "12px" } }, s.ex.map(e => {
          const ex = exOf(e.ex), ds = e.sets.filter(x => x.done);
          return X.kv(ex.n, ds.length ? ds.map(x => ex.type === "load" ? `${x.w ?? 0}×${x.reps}` : ex.type === "time" ? `${x.reps}s` : `${x.reps}`).join("  ") : "skipped");
        })));
        else body.append(h("div", { class: "card", style: { marginTop: "12px" } }, X.kv("Intervals", `${s.work}s on · ${s.rest}s off`), X.kv("Rounds", s.rounds)));
        body.append(h("button", { class: "btn danger", style: { marginTop: "16px" }, html: svg(I.trash) + "Delete session", onclick: () => {
          X.closeSheet(true);
          X.confirmSheet("Delete this session?", "Removes it from your history and weekly totals.", "Delete", () => {
            T().log = T().log.filter(x => x.id !== s.id); X.save(); X.render(false); X.toast("Session deleted");
          });
        } }));
        sh.append(body);
      });
    }

    /* ===================================================== plan wizard */
    function planWizard() {
      const tr = T();
      const p = Object.assign({ goal: "muscle", days: 3, equip: ["db"], level: "beginner" }, tr.profile || {});
      X.openSheet(sh => {
        const body = h("div", { class: "sheet-body" });
        sh.append(body);
        const preview = h("div");
        const paint = () => {
          const plan = E.buildPlan(EX, p);
          preview.innerHTML = "";
          plan.days.forEach(d => preview.append(h("div", { class: "card", style: { marginTop: "10px" } },
            h("b", null, d.name),
            h("div", { class: "muted small", style: { marginTop: "4px", lineHeight: 1.6 } }, d.slots.map(s => `${exOf(s.ex).n} ${s.sets}×${exOf(s.ex).type === "time" ? s.lo + "s" : s.lo + "–" + s.hi}`).join(" · ")))));
          if (p.goal === "fatloss") preview.append(h("p", { class: "note" }, "While you're in a deficit, lifting is there to keep your muscle; the calorie deficit does the fat loss. Add one or two conditioning sessions if you want the fitness too."));
          if (p.days >= 5) preview.append(h("p", { class: "note" }, "Five days: run the four lifting days and use the fifth for conditioning."));
          if (p.days <= 3) preview.append(h("p", { class: "note" }, "Full-body days alternate A, B, A, B across the weeks, so each muscle gets trained two to three times a week."));
        };
        const chip = (label, on, fn) => h("button", { class: "chip" + (on ? " on" : ""), onclick: fn }, label);
        const equipRow = h("div", { class: "daychips" });
        const paintEq = () => {
          equipRow.innerHTML = "";
          [["bar", "Pull-up bar"], ["db", "Dumbbells & bench"], ["gym", "Full gym"]].forEach(([k, l]) => equipRow.append(chip(l, p.equip.includes(k), () => {
            p.equip = p.equip.includes(k) ? p.equip.filter(x => x !== k) : p.equip.concat([k]); paintEq(); paint();
          })));
        };
        body.append(
          h("h3", { class: "stitle" }, "Your training plan"),
          h("div", { class: "lbl" }, "Goal"),
          X.seg(["Build muscle", "Lose fat", "General"], ["muscle", "fatloss", "general"].indexOf(p.goal), i => { p.goal = ["muscle", "fatloss", "general"][i]; paint(); }),
          h("div", { class: "lbl" }, "Days per week"),
          X.seg(["2", "3", "4", "5"], [2, 3, 4, 5].indexOf(p.days), i => { p.days = [2, 3, 4, 5][i]; paint(); }),
          h("div", { class: "lbl" }, "Equipment (bodyweight is always included)"), equipRow,
          h("div", { class: "lbl" }, "Experience"),
          X.seg(["Beginner", "Intermediate"], p.level === "beginner" ? 0 : 1, i => { p.level = i ? "intermediate" : "beginner"; paint(); }),
          h("div", { class: "lbl" }, "Preview"), preview,
          h("button", { class: "btn primary block", style: { marginTop: "18px" }, onclick: () => {
            tr.profile = Object.assign({}, p); tr.plan = E.buildPlan(EX, p); X.save(); X.closeSheet(true); X.render(true); X.toast("Plan ready");
          } }, tr.plan ? "Replace plan" : "Save plan"));
        paintEq(); paint();
      });
    }


    /* ===================================================== body map
       Hand-drawn front/back figure. Each muscle shape carries data-r =
       region key (engine.REGION). mode "select": tap to toggle; mode
       "heat": shade by hard sets this week. */
    /* Anatomical figure, drawn for Setpoint. Each shape is the viewer's-left
       half; mir() adds the mirror image about x = 100. */
    const mir = p => `${p}<g transform="matrix(-1 0 0 1 200 0)">${p}</g>`;
    const SIL = mir(`<path d="M100 10 C88 10 82 20 82 32 C82 44 87 53 93 56 L93 64 C84 68 70 70 60 74 C50 78 45 88 45 100 C43 118 42 135 41 150 C39 165 36 178 34 195 C32 212 31 226 31 236 C28 244 29 256 34 261 C39 263 42 255 41 246 C42 237 44 226 46 212 C49 196 52 181 54 168 C56 150 59 132 62 118 C64 140 67 160 69 176 C68 192 64 204 64 218 C63 250 66 290 70 318 C70 340 66 360 68 382 C70 396 70 402 69 408 C66 414 69 419 80 419 C88 419 91 415 89 407 C87 391 90 372 91 350 C92 336 91 326 93 318 C95 290 97 262 98 244 L100 240 Z"/>`);
    const FRONT = [
      ["traps", mir(`<path d="M94 62 C88 66 78 69 68 72 C78 73 88 72 95 70 Z"/>`)],
      ["shoulders", mir(`<path d="M62 75 C51 79 46 89 46 101 C46 109 48 115 50 119 C54 110 60 99 67 90 C70 84 68 77 62 75 Z"/>`)],
      ["chest", mir(`<path d="M98 76 C88 74 76 75 68 82 C63 89 62 99 64 108 C72 118 87 120 98 114 Z"/>`)],
      ["biceps", mir(`<path d="M51 121 C47 133 46 146 48 158 C51 164 55 162 56 156 C58 142 60 129 60 119 C57 114 53 115 51 121 Z"/>`)],
      ["forearms", mir(`<path d="M43 172 C39 188 36 204 35 224 C37 230 41 230 43 224 C46 208 50 192 53 176 C51 168 46 166 43 172 Z"/>`)],
      ["abs", mir(`<rect x="88" y="121" width="10" height="17" rx="4"/><rect x="88" y="141" width="10" height="17" rx="4"/><rect x="88" y="161" width="10" height="18" rx="4"/><path d="M88 182 L98 182 L98 214 C94 212 90 204 88 196 Z"/><path d="M69 124 C75 136 81 152 85 176 C85 190 83 200 81 206 C75 196 71 186 70 176 C70 160 69 142 69 124 Z"/>`)],
      ["abductors", mir(`<path d="M66 206 C64 216 64 226 66 236 C70 234 74 224 76 214 C74 207 70 203 66 206 Z"/>`)],
      ["adductors", mir(`<path d="M87 236 C89 251 90 266 90 279 C94 272 96 259 97 246 C96 239 92 235 87 236 Z"/>`)],
      ["quads", mir(`<path d="M66 222 C63 248 64 282 70 312 C74 318 79 314 79 304 C79 278 78 252 76 232 C73 226 69 222 66 222 Z"/><path d="M78 226 C76 250 77 278 80 302 C82 308 86 308 88 300 C89 278 89 252 87 234 C85 228 81 224 78 226 Z"/><path d="M90 276 C88 290 88 304 91 316 C96 317 98 308 97 296 C96 286 94 279 90 276 Z"/>`)],
      ["calves", mir(`<path d="M70 331 C67 346 67 362 70 376 C73 372 75 360 76 347 C76 339 74 333 70 331 Z"/><path d="M90 331 C92 345 92 360 89 374 C86 366 85 350 86 339 Z"/>`)]
    ];
    const BACK = [
      ["traps", mir(`<path d="M100 56 C96 63 90 67 80 70 C71 72 64 74 61 76 C73 80 84 87 92 100 C95 112 98 124 100 133 Z"/>`)],
      ["shoulders", mir(`<path d="M60 77 C50 81 46 91 46 102 C47 111 49 116 51 119 C56 107 62 95 71 87 C69 81 65 77 60 77 Z"/>`)],
      ["upperback", mir(`<path d="M73 89 C67 97 65 107 67 116 C75 119 85 115 90 105 C87 97 81 91 73 89 Z"/>`)],
      ["lats", mir(`<path d="M67 120 C67 137 69 156 72 173 C78 184 86 190 94 195 C92 176 90 156 89 137 C83 129 75 123 67 120 Z"/>`)],
      ["triceps", mir(`<path d="M46 120 C43 133 43 147 46 160 C50 166 54 162 56 154 C57 141 59 129 60 119 C55 113 49 113 46 120 Z"/>`)],
      ["forearms", mir(`<path d="M43 172 C39 188 36 204 35 224 C37 230 41 230 43 224 C46 208 50 192 53 176 C51 168 46 166 43 172 Z"/>`)],
      ["lowerback", mir(`<path d="M93 140 C91 160 91 180 93 200 C95 204 98 204 99 200 L99 140 Z"/>`)],
      ["glutes", mir(`<path d="M71 201 C65 213 65 230 71 240 C79 248 92 248 99 240 L99 207 C91 199 79 197 71 201 Z"/>`)],
      ["hamstrings", mir(`<path d="M66 246 C64 270 66 296 72 316 C77 319 80 313 80 302 C80 282 79 264 77 248 C73 244 69 244 66 246 Z"/><path d="M80 248 C80 272 82 296 86 314 C91 317 96 310 96 298 C96 280 96 262 97 248 C91 244 85 244 80 248 Z"/>`)],
      ["calves", mir(`<path d="M71 327 C67 341 67 357 71 371 C75 375 79 369 80 359 C81 347 79 335 75 327 Z"/><path d="M81 327 C81 341 83 357 87 373 C91 375 93 367 92 355 C92 343 91 333 87 327 Z"/>`)]
    ];
    /* opts.selected: Set of regions (select mode)
       opts.recovery: engine.recovery() result, tints unselected muscles
       opts.heat: {region: sets} for the weekly-volume view
       opts.onToggle(region): makes muscles tappable */
    function bodyMap(opts) {
      const sel = opts.selected || new Set(), heat = opts.heat || null, rec = opts.recovery || null;
      const shade = r => {
        if (heat) { const v = heat[r] || 0; return v ? `class="mg" fill="var(--pro)" fill-opacity="${(0.25 + Math.min(1, v / 12) * 0.75).toFixed(2)}"` : `class="mg m-off"`; }
        if (sel.has(r)) return `class="mg m-on"`;
        if (rec && rec[r] && rec[r].status !== "ready") return `class="mg r-${rec[r].status}"`;
        return `class="mg m-off"`;
      };
      const label = r => {
        let t = E.REGION_NAME[r];
        if (heat) t += ` · ${Math.round((heat[r] || 0) * 10) / 10} sets`;
        else if (rec && rec[r] && rec[r].status !== "ready") t += ` · recovering, about ${rec[r].hoursLeft} h left`;
        return t;
      };
      const group = (list, dx) => list.map(([r, shapes]) =>
        `<g data-r="${r}" ${shade(r)} transform="translate(${dx} 0)" role="button" tabindex="0" aria-label="${label(r)}${sel.has(r) ? ", selected" : ""}"><title>${label(r)}</title>${shapes}</g>`).join("");
      const wrap = document.createElement("div");
      wrap.className = "bodymap" + (heat ? " heat" : "");
      wrap.innerHTML = `<svg viewBox="0 0 420 440" role="group" aria-label="Body diagram">
        <g class="sil">${SIL}</g><g class="sil" transform="translate(220 0)">${SIL}</g>
        ${group(FRONT, 0)}${group(BACK, 220)}
        <text x="100" y="436" text-anchor="middle">Front</text><text x="320" y="436" text-anchor="middle">Back</text></svg>`;
      if (opts.onToggle) wrap.querySelectorAll(".mg").forEach(g => {
        const go = () => opts.onToggle(g.dataset.r);
        g.addEventListener("click", go);
        g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      });
      return wrap;
    }

    /* ================================================== freestyle */
    const FS = { regions: new Set(), picks: null, seed: 1 };
    function viewFreestyle() {
      const tr = T(), root = h("div");
      root.append(X.subhead("Freestyle"));
      if (!ALL()) {
        root.append(h("div", { class: "card" }, h("div", { class: "empty-state" }, h("b", null, "Loading 740 exercises…"), "One moment.")));
        ensureAll().then(() => X.render(false)).catch(e => X.toast(e.message));
        return root;
      }
      tr.freeEquip = tr.freeEquip || defaultEquip();
      const level = (tr.profile && tr.profile.level) || "beginner";
      const rec = E.recovery(S());
      const repick = () => { FS.picks = FS.regions.size ? E.pickForMuscles(ALL(), [...FS.regions], tr.freeEquip, level, { seed: FS.seed, fatigue: rec }) : null; };

      root.append(h("p", { class: "note", style: { marginTop: "-6px", textAlign: "center" } }, "Tap the muscles you want to train. Yellow and red are still recovering."));
      root.append(bodyMap({ selected: FS.regions, recovery: rec, onToggle: r => { if (FS.regions.has(r)) FS.regions.delete(r); else FS.regions.add(r); FS.picks = null; X.render(false); } }));
      root.append(legend());
      root.append(h("div", { style: { display: "flex", justifyContent: "center", margin: "4px 0 10px" } },
        h("button", { class: "btn sm", onclick: () => { FS.regions = new Set(E.suggestRegions(S())); FS.picks = null; FS.seed = (FS.seed * 48271 + 11) % 2147483647; X.render(false); } }, "Suggest muscles for me")));
      const tiredSel = [...FS.regions].filter(r => rec[r] && rec[r].status !== "ready");
      if (tiredSel.length) root.append(h("div", { class: "recwarn" },
        h("b", null, `${tiredSel.map(r => E.REGION_NAME[r]).join(", ")} ${tiredSel.length > 1 ? "are" : "is"} still recovering`),
        h("span", null, `About ${hrs(Math.max(...tiredSel.map(r => rec[r].hoursLeft)))} to go. Training ${tiredSel.length > 1 ? "them" : "it"} hard again now mostly adds fatigue. Pick something else, or keep it light (fewer sets, stop 3 reps short).`)));
      root.append(h("div", { class: "daychips", style: { justifyContent: "center", minHeight: "40px" } },
        FS.regions.size ? [...FS.regions].map(r => h("button", { class: "chip on", onclick: () => { FS.regions.delete(r); FS.picks = null; X.render(false); } }, E.REGION_NAME[r] + "  ×"))
          : h("span", { class: "muted" }, "Nothing selected yet")));

      root.append(h("div", { class: "lbl" }, "Equipment you have today"));
      root.append(h("div", { class: "daychips" }, EQUIP.map(q => h("button", { class: "chip" + (tr.freeEquip.includes(q) ? " on" : ""), onclick: () => {
        tr.freeEquip = tr.freeEquip.includes(q) ? tr.freeEquip.filter(x => x !== q) : tr.freeEquip.concat([q]);
        if (!tr.freeEquip.length) tr.freeEquip = ["Bodyweight"];
        X.save(); FS.picks = null; X.render(false);
      } }, q))));

      if (FS.regions.size && !FS.picks) repick();
      if (FS.picks) {
        root.append(X.section("Your session", "Shuffle", () => { FS.seed = (FS.seed * 48271 + 7) % 2147483647; repick(); X.render(false); }));
        if (!FS.picks.length) root.append(h("div", { class: "card" }, h("div", { class: "empty-state" }, "Nothing matches those muscles with this equipment. Add some equipment above.")));
        FS.picks.forEach((p, i) => {
          const x = exOf(p.ex), sc = E.freestyleScheme(x);
          root.append(h("div", { class: "pick" },
            h("button", { onclick: () => exInfo(x), "aria-label": "How to do " + x.n }, demo(x, "md")),
            h("div", { class: "pt" }, h("span", { class: "tag" }, E.REGION_NAME[p.region]), h("b", null, x.n),
              h("span", null, `${x.eqn} · ${sc.sets} × ${x.type === "time" ? sc.lo + "s" : sc.lo + "–" + sc.hi}`)),
            h("div", { class: "pk" },
              h("button", { class: "icon-btn flat", "aria-label": "Swap " + x.n, html: svg(TI.swap), onclick: () => {
                const alt = E.pickForMuscles(ALL(), [p.region], tr.freeEquip, level, { seed: Date.now() % 99991, avoid: FS.picks.map(q => q.ex) })[0];
                if (alt) { FS.picks[i] = alt; X.render(false); } else X.toast("No other option with this equipment");
              } }),
              h("button", { class: "icon-btn flat", "aria-label": "Remove " + x.n, html: svg(I.x), onclick: () => { FS.picks.splice(i, 1); X.render(false); } }))));
        });
        if (FS.picks.length) {
          const est = FS.picks.reduce((a, p) => { const sc = E.freestyleScheme(exOf(p.ex)); return a + sc.sets * (sc.rest + 45); }, 0);
          root.append(h("button", { class: "btn primary block", style: { marginTop: "14px", height: "56px" }, disabled: tr.active ? true : null, onclick: () => startFreestyle() },
            h("span", { html: svg(TI.play) }), "Start workout", h("span", { class: "muted small", style: { fontWeight: 400 } }, ` · ~${Math.round(est / 60)} min`)));
          if (tr.active) root.append(h("p", { class: "note", style: { textAlign: "center" } }, "Finish or discard your current workout first."));
        }
      }
      return root;
    }
    function startFreestyle() {
      const tr = T();
      const names = [...FS.regions].map(r => E.REGION_NAME[r]);
      tr.active = {
        id: X.uid(), dayIdx: null, freestyle: true, started: Date.now(),
        name: names.length > 2 ? `Freestyle · ${names.slice(0, 2).join(", ")} +${names.length - 2}` : `Freestyle · ${names.join(" & ")}`,
        ex: FS.picks.map(p => {
          const x = exOf(p.ex), sc = E.freestyleScheme(x), t = E.nextTarget(sc, x, lastFor(p.ex));
          return { ex: p.ex, n: x.n, mus: x.mus || [], sec: x.sec || [], region: p.region, pat: null, lo: sc.lo, hi: sc.hi, rest: sc.rest,
            sets: Array.from({ length: sc.sets }, () => ({ w: t.w, reps: null, rir: null, done: false })) };
        })
      };
      FS.regions = new Set(); FS.picks = null;
      X.save(); X.back(); setTimeout(() => X.push({ v: "workout" }), 60);
    }

    /* Add any exercise mid-workout: search + muscle + equipment filters. */
    function addExerciseSheet() {
      const tr = T();
      X.openSheet(sh => {
        const body = h("div", { class: "sheet-body" });
        sh.append(body);
        const st = { q: "", r: null, eq: new Set(tr.freeEquip || defaultEquip()) };
        const list = h("div");
        const paint = () => {
          list.innerHTML = "";
          if (!ALL()) { list.append(h("div", { class: "empty-state" }, "Loading library…")); return; }
          const q = st.q.toLowerCase().split(/\s+/).filter(Boolean);
          const target = st.r ? E.REGION[st.r] : null;
          const xs = Object.values(ALL()).filter(x => st.eq.has(x.eqn) && (!target || (x.mus || []).some(m => target.includes(m))) && q.every(t => x.n.toLowerCase().includes(t)))
            .sort((a, b) => (b.core ? 1 : 0) - (a.core ? 1 : 0) || a.n.localeCompare(b.n)).slice(0, 60);
          if (!xs.length) list.append(h("div", { class: "empty-state" }, "Nothing matches. Loosen a filter."));
          xs.forEach(x => list.append(h("button", { class: "pex", onclick: () => {
            const reg = st.r || E.muscleToRegion((x.mus || [])[0]);
            const sc = E.freestyleScheme(x), t = E.nextTarget(sc, x, lastFor(x.id));
            tr.active.ex.push({ ex: x.id, n: x.n, mus: x.mus || [], sec: x.sec || [], region: reg, pat: null, lo: sc.lo, hi: sc.hi, rest: sc.rest,
              sets: Array.from({ length: sc.sets }, () => ({ w: t.w, reps: null, rir: null, done: false })) });
            X.save(); X.closeSheet(true); X.render(false); X.toast(`Added ${x.n}`);
          } }, demo(x, "sm"), h("div", { class: "pt" }, h("b", null, x.n), h("span", null, `${x.eqn} · ${(x.mus || []).join(", ")}`)))));
        };
        body.append(h("h3", { class: "stitle" }, "Add exercise"),
          h("input", { class: "inp", type: "search", placeholder: "Search 740 exercises", oninput: e => { st.q = e.target.value; paint(); } }),
          h("div", { class: "lbl" }, "Muscle"),
          h("div", { class: "daychips scrollx" }, [h("button", { class: "chip on", "data-r": "", onclick: e => pickR(null, e) }, "All"),
            ...Object.keys(E.REGION).map(r => h("button", { class: "chip", "data-r": r, onclick: e => pickR(r, e) }, E.REGION_NAME[r]))]),
          h("div", { class: "lbl" }, "Equipment"),
          h("div", { class: "daychips scrollx" }, EQUIP.map(q => h("button", { class: "chip" + (st.eq.has(q) ? " on" : ""), onclick: e => {
            if (st.eq.has(q)) st.eq.delete(q); else st.eq.add(q); e.currentTarget.classList.toggle("on"); paint(); } }, q))),
          list);
        function pickR(r, e) { st.r = r; e.currentTarget.parentNode.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", (c.dataset.r || null) === (r || null) || (!r && !c.dataset.r))); paint(); }
        paint();
        ensureAll().then(paint).catch(() => { });
      });
    }

    /* ======================================================== workout */
    function startWorkout(dayIdx) {
      const tr = T(), day = tr.plan.days[dayIdx];
      tr.active = {
        id: X.uid(), dayIdx, name: day.name, started: Date.now(),
        ex: day.slots.map(sl => {
          const ex = exOf(sl.ex), t = E.nextTarget(sl, ex, lastFor(sl.ex));
          return { ex: sl.ex, n: ex.n, mus: ex.mus || [], sec: ex.sec || [], pat: sl.pat, lo: sl.lo, hi: sl.hi, rest: sl.rest, sets: Array.from({ length: sl.sets }, () => ({ w: t.w, reps: null, rir: null, done: false })) };
        })
      };
      X.save(); X.push({ v: "workout" });
    }

    let REST = null, restTimer = null, clockTimer = null;
    function restBar() { return $("#restbar"); }
    function startRest(sec) {
      REST = { end: Date.now() + sec * 1000, total: sec };
      let bar = restBar();
      if (!bar) {
        bar = h("div", { class: "restbar", id: "restbar" },
          h("div", { class: "rt" }, h("span", null, "Rest"), h("b", { id: "restT" }, mmss(sec))),
          h("div", { class: "rp" }, h("i", { id: "restP" })),
          h("div", { class: "rb" },
            h("button", { class: "chip", onclick: () => { REST.end -= 15000; } }, "−15"),
            h("button", { class: "chip", onclick: () => { REST.end += 15000; REST.total += 15; } }, "+15"),
            h("button", { class: "chip", onclick: stopRest }, "Skip")));
        document.body.appendChild(bar);
      }
      clearInterval(restTimer);
      restTimer = setInterval(() => {
        if (!REST) return;
        const left = (REST.end - Date.now()) / 1000;
        const t = $("#restT"), p = $("#restP");
        if (t) t.textContent = mmss(left);
        if (p) p.style.width = `${Math.max(0, left / REST.total * 100)}%`;
        if (left <= 0) { beep(880, 0.25); setTimeout(() => beep(1320, 0.3), 280); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { } X.toast("Rest's up. Next set"); stopRest(); }
      }, 250);
    }
    function stopRest() { REST = null; clearInterval(restTimer); const b = restBar(); if (b) b.remove(); }

    function viewWorkout() {
      const tr = T(), A = tr.active, root = h("div");
      if (!A) { root.append(X.subhead("Workout"), h("div", { class: "card" }, h("div", { class: "empty-state" }, "No workout in progress."))); return root; }
      const clock = h("span", { class: "clockchip" }, mmss((Date.now() - A.started) / 1000));
      root.append(X.subhead(A.name, clock));
      clearInterval(clockTimer);
      clockTimer = setInterval(() => { if (!document.body.contains(clock)) { clearInterval(clockTimer); return; } clock.textContent = mmss((Date.now() - A.started) / 1000); }, 1000);
      let saveT;
      const soon = () => { clearTimeout(saveT); saveT = setTimeout(() => X.save(), 400); };

      A.ex.forEach((e, ei) => {
        const ex = exOf(e.ex), last = lastFor(e.ex, A.id);
        const slot = { lo: e.lo, hi: e.hi, sets: e.sets.length };
        const t = E.nextTarget(slot, ex, last);
        const card = h("div", { class: "wex" });
        card.append(h("div", { class: "wh" },
          h("button", { onclick: () => exInfo(ex), "aria-label": "How to do " + ex.n }, demo(ex, "md")),
          h("div", { class: "wt" }, h("b", null, ex.n), h("span", null, targetText(slot, ex, t)),
            lastText(last, ex) ? h("span", { class: "muted" }, lastText(last, ex)) : null)));
        if (t.note) card.append(h("div", { class: "tnote" }, t.note));
        if (t.harder) card.append(h("button", { class: "btn sm", style: { margin: "0 0 10px" }, onclick: () => doSwap(ei, t.harder, true) }, `Switch to ${exOf(t.harder).n}`));
        const head = h("div", { class: "srow sh" }, h("span", null, "Set"), ex.type === "load" ? h("span", null, "kg") : h("span"), h("span", null, ex.type === "time" ? "sec" : "reps"), h("span", null, "Reps left"), h("span"));
        card.append(head);
        e.sets.forEach((st, si) => {
          const row = h("div", { class: "srow" + (st.done ? " done" : "") });
          const kg = ex.type === "load" ? h("input", { class: "inp sm", type: "number", inputmode: "decimal", step: "any", value: st.w ?? "", placeholder: "kg", "aria-label": `Set ${si + 1} weight`, oninput: ev => { st.w = ev.target.value === "" ? null : +ev.target.value; soon(); } }) : h("span");
          const reps = h("input", { class: "inp sm", type: "number", inputmode: "numeric", value: st.reps ?? "", placeholder: ex.type === "time" ? String(e.lo) : String(e.hi), "aria-label": `Set ${si + 1} ${ex.type === "time" ? "seconds" : "reps"}`, oninput: ev => { st.reps = ev.target.value === "" ? null : +ev.target.value; soon(); } });
          const rir = h("div", { class: "rir" }, [0, 1, 2, 3, 4].map(v => h("button", { class: st.rir === v ? "on" : null, "aria-label": `${v}${v === 4 ? " or more" : ""} reps left`, onclick: ev => {
            st.rir = st.rir === v ? null : v; ev.currentTarget.parentNode.querySelectorAll("button").forEach((b, j) => b.classList.toggle("on", st.rir === j)); soon();
          } }, v === 4 ? "4+" : String(v))));
          const ok = h("button", { class: "tick" + (st.done ? " on" : ""), "aria-label": `Mark set ${si + 1} done`, html: svg(TI.check), onclick: () => {
            if (!st.done) {
              if (st.reps == null) { st.reps = +reps.placeholder; reps.value = st.reps; }
              if (ex.type === "load" && st.w == null && si > 0) { st.w = e.sets[si - 1].w; kg.value = st.w ?? ""; }
              st.done = true; row.classList.add("done"); ok.classList.add("on");
              // carry this set's numbers forward to the next empty set
              const nx = e.sets[si + 1];
              if (nx && !nx.done && ex.type === "load" && nx.w == null) { nx.w = st.w; const inp = row.nextSibling && row.nextSibling.querySelector("input"); if (inp) inp.value = nx.w ?? ""; }
              X.save();
              const allDone = A.ex.every(x => x.sets.every(y => y.done));
              if (!allDone) startRest(ex.type === "time" ? 45 : e.rest);
              else { stopRest(); X.toast("All sets done. Finish when you're ready"); }
            } else { st.done = false; row.classList.remove("done"); ok.classList.remove("on"); X.save(); }
          } });
          row.append(h("span", { class: "sn" }, si + 1), kg, reps, rir, ok);
          card.append(row);
        });
        card.append(h("div", { class: "btnrow", style: { marginTop: "10px" } },
          h("button", { class: "btn sm", html: svg(I.plus) + "Set", onclick: () => { const l = e.sets[e.sets.length - 1]; e.sets.push({ w: l ? l.w : null, reps: null, rir: null, done: false }); X.save(); X.render(false); } }),
          e.sets.length > 1 ? h("button", { class: "btn sm", onclick: () => { e.sets.pop(); X.save(); X.render(false); } }, "Remove set") : null,
          h("button", { class: "btn sm", html: svg(TI.swap) + "Swap", onclick: () => swapSheet(ei) })));
        root.append(card);
      });

      root.append(h("button", { class: "btn block", style: { marginTop: "4px", height: "52px" }, html: svg(I.plus) + "Add exercise", onclick: () => addExerciseSheet() }));
      root.append(h("button", { class: "btn primary block", style: { marginTop: "12px", height: "56px" }, onclick: finishSheet }, "Finish workout"),
        h("button", { class: "btn block", style: { marginTop: "10px", color: "var(--bad)" }, onclick: () => X.confirmSheet("Discard this workout?", "Nothing from this session will be saved.", "Discard", () => { stopRest(); T().active = null; X.save(); X.go("train"); }) }, "Discard"));
      return root;
    }

    function doSwap(ei, newId, updatePlan) {
      const tr = T(), A = tr.active, e = A.ex[ei];
      const ex = exOf(newId), t = E.nextTarget({ lo: e.lo, hi: e.hi }, ex, lastFor(newId, A.id));
      e.ex = newId; e.n = ex.n; e.mus = ex.mus || []; e.sec = ex.sec || [];
      if (ex.type === "time") { e.lo = 30; e.hi = 60; }
      e.sets = e.sets.map(s => s.done ? s : { w: t.w, reps: null, rir: null, done: false });
      if (updatePlan && tr.plan && A.dayIdx != null) {
        const slot = tr.plan.days[A.dayIdx].slots.find(s => s.pat === e.pat);
        if (slot) { slot.ex = newId; if (ex.type === "time") { slot.lo = 30; slot.hi = 60; } }
      }
      X.save(); X.render(false); X.toast(`Swapped to ${ex.n}`);
    }
    function swapSheet(ei) {
      const tr = T(), e = tr.active.ex[ei];
      const alts = e.region && ALL()
        ? E.pickForMuscles(ALL(), [e.region], tr.freeEquip || defaultEquip(), (tr.profile && tr.profile.level) || "beginner", { seed: Date.now() % 9973, avoid: tr.active.ex.map(x => x.ex) }).concat(
            E.pickForMuscles(ALL(), [e.region], tr.freeEquip || defaultEquip(), "intermediate", { seed: 31, avoid: tr.active.ex.map(x => x.ex) })).map(p => exOf(p.ex)).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).slice(0, 10)
        : E.alternatives(EX, e.pat, (tr.profile && tr.profile.equip) || ["gym"]).filter(x => x.id !== e.ex);
      let keep = true;
      X.openSheet(sh => {
        const body = h("div", { class: "sheet-body" });
        body.append(h("h3", { class: "stitle" }, "Swap exercise"),
          h("div", { class: "muted", style: { marginBottom: "12px" } }, `Same movement pattern, using your equipment. Replacing ${exOf(e.ex).n}.`),
          h("label", { class: "row", style: { padding: "10px 0", borderTop: 0 } },
            h("input", { type: "checkbox", checked: true, onchange: ev => keep = ev.target.checked, style: { width: "20px", height: "20px", accentColor: "var(--text)" } }),
            h("span", { class: "rt" }, h("b", { style: { fontSize: "16px" } }, "Use it in my plan from now on"))));
        if (!alts.length) body.append(h("div", { class: "empty-state" }, "No alternatives with your equipment. Add equipment in Rebuild plan."));
        alts.forEach(x => body.append(h("button", { class: "pex", onclick: () => { X.closeSheet(true); doSwap(ei, x.id, keep); } }, demo(x, "sm"),
          h("div", { class: "pt" }, h("b", null, x.n), h("span", null, `${x.eqn || EQ_LABEL[x.eq]} · ${x.lvl}`)))));
        sh.append(body);
      });
    }

    function finishSheet() {
      const tr = T(), A = tr.active;
      const done = A.ex.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
      if (!done) { X.toast("Tick off at least one set first"); return; }
      const dur = mins(Date.now() - A.started);
      const vol = A.ex.reduce((a, e) => a + e.sets.filter(s => s.done).reduce((b, s) => b + (s.w || 0) * (s.reps || 0), 0), 0);
      let rating = 3;
      X.openSheet(sh => {
        const body = h("div", { class: "sheet-body" });
        const rb = h("div", { class: "ratings" });
        const paintR = () => { rb.innerHTML = ""; RATING.forEach((r, i) => rb.append(h("button", { class: i + 1 === rating ? "on" : null, onclick: () => { rating = i + 1; paintR(); } }, r))); };
        paintR();
        body.append(h("h3", { class: "stitle" }, "How did that feel?"),
          h("div", { class: "muted" }, "Setpoint adjusts next time's volume for this day from your answer."),
          rb,
          h("div", { class: "stats3", style: { marginTop: "18px" } },
            h("div", { class: "stat" }, h("b", null, dur, h("small", null, "min")), h("span", null, "Duration")),
            h("div", { class: "stat" }, h("b", null, done), h("span", null, "Sets")),
            h("div", { class: "stat" }, h("b", null, Math.round(vol), h("small", null, "kg")), h("span", null, "Volume"))),
          h("button", { class: "btn primary block", style: { marginTop: "20px" }, onclick: () => {
            stopRest();
            const entry = { id: A.id, type: "lift", date: E.today(), at: Date.now(), name: A.name, dayIdx: A.dayIdx, dur, rating,
              ex: A.ex.map(e => { const x = exOf(e.ex); return { ex: e.ex, n: x.n, mus: x.mus || e.mus || [], sec: x.sec || e.sec || [], pat: e.pat, region: e.region, lo: e.lo, hi: e.hi, sets: e.sets.map(s => Object.assign({}, s)) }; }) };
            tr.log.push(entry);
            let msg = "Workout saved";
            if (tr.plan && A.dayIdx != null && tr.plan.days[A.dayIdx]) {
              E.applyRating(tr.plan.days[A.dayIdx], rating);
              if (rating === 1) msg = "Saved. Next time: one more set per exercise";
              if (rating === 5) msg = "Saved. Next time: one fewer set per exercise";
              tr.plan.next = (A.dayIdx + 1) % tr.plan.days.length;
            }
            tr.active = null; X.save(); X.closeSheet(true); X.go("train"); X.toast(msg);
          } }, "Save workout"));
        sh.append(body);
      });
    }

    /* =================================================== exercise info */
    function exInfo(ex) {
      X.openSheet(sh => {
        const body = h("div", { class: "sheet-body" });
        body.append(demo(ex, "lg"),
          h("h3", { class: "stitle", style: { marginTop: "14px" } }, ex.n),
          h("div", { class: "daychips" }, [ex.eqn || EQ_LABEL[ex.eq], ex.lvl, ...(ex.mus || [])].filter(Boolean).map(t => h("span", { class: "chip static" }, t))),
          (ex.sec || []).length ? h("div", { class: "muted small" }, "Also works: " + ex.sec.join(", ")) : null,
          h("ol", { class: "steps" }, (ex.steps || []).map(s => h("li", null, s))),
          ex.img ? h("p", { class: "note" }, "Images and instructions: free-exercise-db (public domain).") : null);
        sh.append(body);
      });
    }
    function viewLibrary() {
      const root = h("div");
      root.append(X.subhead("Exercises"));
      if (!ALL()) { root.append(h("div", { class: "empty-state" }, "Loading library…")); ensureAll().then(() => X.render(false)).catch(e => X.toast(e.message)); return root; }
      const st2 = { q: "", r: null, eq: null };
      const list2 = h("div", { class: "card" });
      const paint2 = () => {
        list2.innerHTML = "";
        const q = st2.q.toLowerCase().split(/\s+/).filter(Boolean), target = st2.r ? E.REGION[st2.r] : null;
        const xs = Object.values(ALL()).filter(x => (!st2.eq || x.eqn === st2.eq) && (!target || (x.mus || []).some(m => target.includes(m))) && q.every(t => x.n.toLowerCase().includes(t)))
          .sort((a, b) => (b.core ? 1 : 0) - (a.core ? 1 : 0) || a.n.localeCompare(b.n));
        list2.append(h("div", { class: "muted small", style: { marginBottom: "6px" } }, `${xs.length} exercises`));
        xs.slice(0, 80).forEach(x => list2.append(h("button", { class: "pex", onclick: () => exInfo(x) }, demo(x, "sm"),
          h("div", { class: "pt" }, h("b", null, x.n), h("span", null, `${x.eqn} · ${(x.mus || []).join(", ")}`)))));
        if (xs.length > 80) list2.append(h("div", { class: "empty-state" }, "Showing the first 80. Search or filter to narrow it down."));
      };
      root.append(h("input", { class: "inp", type: "search", placeholder: "Search 740 exercises", oninput: ev => { st2.q = ev.target.value; paint2(); } }));
      root.append(h("div", { class: "lbl" }, "Muscle"), h("div", { class: "daychips scrollx" }, [null, ...Object.keys(E.REGION)].map(r =>
        h("button", { class: "chip" + (r === st2.r ? " on" : ""), onclick: ev => { st2.r = r; ev.currentTarget.parentNode.querySelectorAll(".chip").forEach(c => c.classList.remove("on")); ev.currentTarget.classList.add("on"); paint2(); } }, r ? E.REGION_NAME[r] : "All"))));
      root.append(h("div", { class: "lbl" }, "Equipment"), h("div", { class: "daychips scrollx" }, [null, ...EQUIP].map(q =>
        h("button", { class: "chip" + (q === st2.eq ? " on" : ""), onclick: ev => { st2.eq = q; ev.currentTarget.parentNode.querySelectorAll(".chip").forEach(c => c.classList.remove("on")); ev.currentTarget.classList.add("on"); paint2(); } }, q || "All"))));
      root.append(list2);
      paint2();
      return root;
    }
    function viewLibraryOld() {
      const root = h("div");
      root.append(X.subhead("Exercises"));
      const st = { q: "", eq: "all" };
      const list = h("div", { class: "card" });
      const paint = () => {
        list.innerHTML = "";
        const q = st.q.toLowerCase();
        const PN = { squat: "Squat", hinge: "Hinge", lunge: "Lunge", hpush: "Horizontal push", hpull: "Horizontal pull", vpush: "Vertical push", vpull: "Vertical pull", core: "Core", bi: "Biceps", tri: "Triceps", delts: "Shoulders", calves: "Calves", hiit: "Conditioning" };
        let n = 0;
        for (const [pat, ids] of Object.entries(EX.patterns)) {
          const xs = ids.map(exOf).filter(x => (st.eq === "all" || x.eq === st.eq) && (!q || x.n.toLowerCase().includes(q)));
          if (!xs.length) continue;
          list.append(h("div", { class: "lbl", style: { marginTop: n ? "16px" : 0 } }, PN[pat] || pat));
          xs.forEach(x => { n++; list.append(h("button", { class: "pex", onclick: () => exInfo(x) }, demo(x, "sm"), h("div", { class: "pt" }, h("b", null, x.n), h("span", null, `${EQ_LABEL[x.eq]} · ${x.lvl}`)))); });
        }
        if (!n) list.append(h("div", { class: "empty-state" }, "Nothing matches."));
      };
      root.append(h("input", { class: "inp", type: "search", placeholder: "Search exercises", oninput: ev => { st.q = ev.target.value; paint(); } }),
        h("div", { style: { margin: "12px 0" } }, X.seg(["All", "Body", "Bar", "DB", "Gym"], 0, i => { st.eq = ["all", "bw", "bar", "db", "gym"][i]; paint(); }, "sm")),
        list);
      paint();
      return root;
    }

    /* ============================================================ HIIT */
    const PRESETS = {
      low: { name: "Low impact", work: 20, rest: 40, rounds: 8, moves: ["Jumping_Jacks", "Bodyweight_Squat", "High_Knees", "Mountain_Climbers", "Butt_Kicks", "Plank"], tip: "Step instead of jumping. Keep it brisk but conversational." },
      mid: { name: "Intermediate", work: 30, rest: 30, rounds: 10, moves: ["Jumping_Jacks", "Freehand_Jump_Squat", "Mountain_Climbers", "Skater_Hops", "High_Knees", "Butt_Kicks"], tip: "Hard enough that talking is difficult by the end of each interval." },
      adv: { name: "Advanced", work: 40, rest: 20, rounds: 12, moves: ["Burpee", "Freehand_Jump_Squat", "Split_Jump", "Mountain_Climbers", "Knee_Tuck_Jump", "Skater_Hops", "Frog_Hops"], tip: "Near-maximal work. Warm up first and land softly." },
      tabata: { name: "Tabata", work: 20, rest: 10, rounds: 8, moves: ["Burpee", "Freehand_Jump_Squat"], tip: "Four minutes, all-out intervals. Warm up for five minutes first." }
    };
    let HP = null;   // pending HIIT config
    function hiitSheet(key) {
      const p = JSON.parse(JSON.stringify(PRESETS[key]));
      const set = S().settings;
      X.openSheet(sh => {
        const body = h("div", { class: "sheet-body" });
        const total = h("b");
        const paintT = () => { total.textContent = mmss(10 + p.rounds * p.work + (p.rounds - 1) * p.rest); };
        const slider = (label, key, min, max, step, unit) => {
          const out = h("b", null, `${p[key]}${unit}`);
          return h("div", { style: { marginTop: "14px" } },
            h("div", { style: { display: "flex", justifyContent: "space-between" } }, h("span", { class: "muted" }, label), out),
            h("input", { type: "range", min, max, step, value: p[key], class: "range", oninput: ev => { p[key] = +ev.target.value; out.textContent = `${p[key]}${unit}`; paintT(); } }));
        };
        body.append(h("h3", { class: "stitle" }, p.name), h("p", { class: "note", style: { marginTop: "2px" } }, p.tip),
          slider("Work", "work", 10, 60, 5, "s"), slider("Rest", "rest", 5, 90, 5, "s"), slider("Rounds", "rounds", 4, 20, 1, ""),
          h("div", { class: "lbl" }, "Moves (they rotate each round)"),
          h("div", { class: "plist" }, p.moves.map(id => { const x = exOf(id); return h("button", { class: "pex", onclick: () => exInfo(x) }, demo(x, "sm"), h("div", { class: "pt" }, h("b", null, x.n), h("span", null, x.steps[0] || ""))); })),
          h("div", { class: "row", style: { padding: "12px 0 0", borderTop: 0 } },
            h("span", { class: "rt" }, h("b", null, "Voice cues")),
            X.seg(["On", "Off"], set.voice === false ? 1 : 0, i => { set.voice = !i; X.save(); }, "sm")),
          h("div", { class: "kv", style: { marginTop: "10px" } }, h("span", null, "Total time"), total),
          h("button", { class: "btn primary block", style: { marginTop: "16px", height: "56px" }, onclick: () => {
            HP = p; primeAudio(); X.closeSheet(true); X.push({ v: "hiit" });
          } }, h("span", { html: svg(TI.play) }), "Start"));
        paintT();
        sh.append(body);
      });
    }

    let AC = null;
    function primeAudio() {
      try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume && AC.resume(); } catch (e) { AC = null; }
      try { if (S().settings.voice !== false && window.speechSynthesis) { const u = new SpeechSynthesisUtterance("Get ready"); u.rate = 1.05; speechSynthesis.speak(u); } } catch (e) { }
    }
    function beep(freq, dur) {
      if (!AC || S().settings.sound === false) return;
      try {
        const o = AC.createOscillator(), g = AC.createGain();
        o.frequency.value = freq; o.type = "sine"; o.connect(g); g.connect(AC.destination);
        const t = AC.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (e) { }
    }
    function say(text) {
      if (S().settings.voice === false || !window.speechSynthesis) return;
      try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.speak(u); } catch (e) { }
    }
    let WL = null;
    async function wake(on) {
      try {
        if (on && "wakeLock" in navigator) { WL = await navigator.wakeLock.request("screen"); }
        else if (!on && WL) { await WL.release(); WL = null; }
      } catch (e) { WL = null; }
    }

    let RUN = null;
    function viewHiit() {
      const root = h("div", { class: "hiit" });
      if (!HP && !RUN) { root.append(X.subhead("Intervals"), h("div", { class: "empty-state" }, "Pick a conditioning preset on the Train tab.")); return root; }
      if (!RUN) {
        const p = HP, phases = [{ k: "ready", d: 10, m: p.moves[0], r: 0 }];
        for (let r = 1; r <= p.rounds; r++) {
          phases.push({ k: "work", d: p.work, m: p.moves[(r - 1) % p.moves.length], r });
          if (r < p.rounds) phases.push({ k: "rest", d: p.rest, m: p.moves[r % p.moves.length], r });
        }
        RUN = { p, phases, i: 0, t0: Date.now(), start: Date.now(), paused: false, pausedAt: 0, lastSec: null, done: false };
        wake(true);
        cue();
      }
      const R = 120, L = 2 * Math.PI * R;
      const phaseEl = h("div", { class: "hphase" }), numEl = h("div", { class: "hnum" }), moveEl = h("div", { class: "hmove" }), nextEl = h("div", { class: "hnext" });
      const roundEl = h("div", { class: "hround" }), leftEl = h("div", { class: "hleft" });
      const ring = h("div", { class: "hring", html: `<svg viewBox="0 0 260 260"><circle cx="130" cy="130" r="${R}" class="trk"/><circle cx="130" cy="130" r="${R}" class="prg" transform="rotate(-90 130 130)" stroke-dasharray="${L}" stroke-dashoffset="0"/></svg>` });
      ring.append(numEl);
      const demoBox = h("div", { class: "hdemo" });
      const pauseBtn = h("button", { class: "hbtn big", "aria-label": "Pause", html: svg(TI.pause), onclick: togglePause });
      const voiceBtn = h("button", { class: "icon-btn flat", "aria-label": "Voice on or off", html: svg(S().settings.voice === false ? TI.mute : TI.voice), onclick: () => {
        const s = S().settings; s.voice = s.voice === false; X.save(); voiceBtn.innerHTML = svg(s.voice === false ? TI.mute : TI.voice); if (s.voice === false && window.speechSynthesis) speechSynthesis.cancel();
      } });
      root.append(
        h("div", { class: "head sub" },
          h("button", { class: "back", "aria-label": "Stop", html: svg(I.x), onclick: () => X.confirmSheet("Stop the workout?", "You can save what you've done so far.", "Stop and save", () => finishHiit(true)) }),
          h("h1", null, RUN.p.name), voiceBtn),
        phaseEl, ring, moveEl, demoBox, nextEl,
        h("div", { class: "hstats" }, roundEl, leftEl),
        h("div", { class: "hctl" },
          h("button", { class: "hbtn", "aria-label": "Skip", html: svg(TI.skip), onclick: () => { advance(); } }),
          pauseBtn,
          h("button", { class: "hbtn", "aria-label": "Finish", html: svg(TI.check), onclick: () => X.confirmSheet("Finish now?", "Saves the rounds you've completed.", "Finish", () => finishHiit(true)) })));

      let lastMove = null;
      function paint() {
        if (!RUN || !document.body.contains(root)) return false;
        if (RUN.done) return false;
        const ph = RUN.phases[RUN.i], now = RUN.paused ? RUN.pausedAt : Date.now();
        const left = ph.d - (now - RUN.t0) / 1000;
        const col = ph.k === "work" ? "var(--pro)" : ph.k === "rest" ? "var(--carb)" : "var(--kcal)";
        root.style.setProperty("--hc", col);
        phaseEl.textContent = ph.k === "work" ? "WORK" : ph.k === "rest" ? "REST" : "GET READY";
        numEl.textContent = Math.max(0, Math.ceil(left));
        ring.querySelector(".prg").setAttribute("stroke-dashoffset", String(L * (1 - Math.max(0, left) / ph.d)));
        const mv = exOf(ph.m);
        moveEl.textContent = ph.k === "rest" ? "Breathe" : mv.n;
        const showId = ph.k === "rest" ? ph.m : ph.m;
        if (lastMove !== showId) { lastMove = showId; demoBox.innerHTML = ""; demoBox.append(demo(exOf(showId), "md")); }
        const nx = RUN.phases[RUN.i + 1];
        nextEl.textContent = ph.k === "rest" ? `Next: ${mv.n}` : nx && nx.k === "rest" && RUN.phases[RUN.i + 2] ? `Then rest, then ${exOf(RUN.phases[RUN.i + 2].m).n}` : nx ? "" : "Last interval";
        roundEl.textContent = `Round ${Math.max(1, ph.r)} / ${RUN.p.rounds}`;
        const rem = RUN.phases.slice(RUN.i + 1).reduce((a, x) => a + x.d, 0) + Math.max(0, left);
        leftEl.textContent = `${mmss(rem)} left`;
        pauseBtn.innerHTML = svg(RUN.paused ? TI.play : TI.pause);
        // countdown beeps at 3, 2, 1
        const sec = Math.ceil(left);
        if (!RUN.paused && sec !== RUN.lastSec) { RUN.lastSec = sec; if (sec <= 3 && sec >= 1) beep(660, 0.12); }
        if (!RUN.paused && left <= 0) advance();
        return true;
      }
      function loop() { if (paint()) requestAnimationFrame(loop); }
      root._after = () => { requestAnimationFrame(loop); };
      // backup ticker for when rAF is throttled
      const iv = setInterval(() => { if (!paint()) clearInterval(iv); }, 500);
      return root;
    }
    function cue() {
      const ph = RUN.phases[RUN.i], mv = exOf(ph.m);
      if (ph.k === "ready") say(`Get ready. First up, ${mv.n}.`);
      else if (ph.k === "work") { beep(1040, 0.35); say(ph.r === RUN.p.rounds ? `Last round. ${mv.n}. Go!` : ph.r === Math.ceil(RUN.p.rounds / 2) + 1 ? `Halfway. ${mv.n}. Go!` : `${mv.n}. Go!`); }
      else { beep(520, 0.4); say(`Rest. Next, ${mv.n}.`); }
    }
    function advance() {
      if (!RUN) return;
      if (RUN.i >= RUN.phases.length - 1) { finishHiit(false); return; }
      RUN.i++; RUN.t0 = Date.now(); RUN.lastSec = null; RUN.paused = false;
      cue();
    }
    function togglePause() {
      if (!RUN) return;
      if (RUN.paused) { RUN.t0 += Date.now() - RUN.pausedAt; RUN.paused = false; say("Resume"); }
      else { RUN.paused = true; RUN.pausedAt = Date.now(); if (window.speechSynthesis) speechSynthesis.cancel(); }
    }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && RUN && !RUN.done) wake(true); });

    function finishHiit(early) {
      if (!RUN) return;
      RUN.done = true;
      const ph = RUN.phases[RUN.i];
      const rounds = early ? Math.max(0, ph.k === "work" ? ph.r - 1 : ph.r) : RUN.p.rounds;
      const dur = mins(Date.now() - RUN.start);
      const p = RUN.p;
      if (!early) { beep(880, 0.2); setTimeout(() => beep(1175, 0.2), 220); setTimeout(() => beep(1568, 0.45), 440); say("Workout complete. Nice work."); }
      wake(false);
      RUN = null; HP = null;
      let rating = 3;
      X.openSheet(sh => {
        const body = h("div", { class: "sheet-body" });
        const rb = h("div", { class: "ratings" });
        const paintR = () => { rb.innerHTML = ""; RATING.forEach((r, i) => rb.append(h("button", { class: i + 1 === rating ? "on" : null, onclick: () => { rating = i + 1; paintR(); } }, r))); };
        paintR();
        const kg = (E.latestWeight(S()) || {}).kg;
        body.append(h("h3", { class: "stitle" }, early ? "Stopped" : "Done"),
          h("div", { class: "stats3", style: { marginTop: "10px" } },
            h("div", { class: "stat" }, h("b", null, dur, h("small", null, "min")), h("span", null, "Duration")),
            h("div", { class: "stat" }, h("b", null, rounds), h("span", null, "Rounds")),
            h("div", { class: "stat" }, h("b", null, kg ? E.sessionKcal("hiit", dur, kg) : "—", h("small", null, "kcal")), h("span", null, "Est. burn"))),
          h("p", { class: "note" }, "The burn estimate is for interest only. It's already inside your measured expenditure, so it isn't added to your food budget."),
          h("div", { class: "lbl" }, "How did that feel?"), rb,
          h("button", { class: "btn primary block", style: { marginTop: "18px" }, onclick: () => {
            if (rounds > 0) { T().log.push({ id: X.uid(), type: "hiit", date: E.today(), name: `${p.name} intervals`, dur, rounds, work: p.work, rest: p.rest, rating }); X.save(); }
            X.closeSheet(true); X.go("train"); X.toast(rounds > 0 ? "Session saved" : "Nothing to save");
          } }, rounds > 0 ? "Save session" : "Close"));
        sh.append(body);
      }, () => { if (X.top() === "hiit") X.go("train"); });
    }

    /* ======================================================= dashboard */
    function dashTiles(tw) {
      const tr = T(), ws = E.weekStart(E.today()), days = E.range(ws, E.addDays(ws, 6));
      const minsPerDay = days.map(d => { const m = tr.log.filter(s => s.date === d).reduce((a, s) => a + s.dur, 0); return m || null; });
      const n = tr.log.filter(s => s.date >= ws).length;
      const sets = Object.values(E.weeklySets(S())).reduce((a, b) => a + b, 0);
      return [
        X.tile("Training", "This week", C.spark({ w: tw, h: 58, xs: days, zero: 0, series: [{ type: "bars", data: minsPerDay, colorFn: () => "var(--pro)" }] }),
          X.num(n), n === 1 ? "session" : "sessions", () => X.go("train")),
        X.tile("Hard Sets", "This week", h("div", { class: "meter" }, h("i", { style: { width: `${Math.min(100, sets / 80 * 100)}%`, background: "var(--pro)" } })),
          X.num(sets), "sets", () => X.go("train"))
      ];
    }

    /* Example history for the demo dataset. */
    function seed(rnd) {
      const tr = T();
      tr.profile = { goal: "muscle", days: 3, equip: ["db", "bar"], level: "beginner" };
      tr.plan = E.buildPlan(EX, tr.profile);
      const dates = [-20, -18, -16, -13, -11, -9, -6, -4, -2];
      let idx = 0;
      const base = {};
      dates.forEach((off, k) => {
        const day = tr.plan.days[idx % tr.plan.days.length], date = E.addDays(E.today(), off);
        const ex = day.slots.map(sl => {
          const x = exOf(sl.ex);
          if (base[sl.ex] == null) base[sl.ex] = x.type === "load" ? (sl.pat === "squat" || sl.pat === "hinge" ? 16 : 10) : 0;
          const w = x.type === "load" ? base[sl.ex] : null;
          const sets = Array.from({ length: sl.sets }, (_, i) => ({ w, reps: x.type === "time" ? 30 + k * 3 : Math.min(sl.hi, sl.lo + Math.floor(k / 2) + (i === 0 ? 1 : 0)), rir: 2 - (i === sl.sets - 1 ? 1 : 0), done: true }));
          if (x.type === "load" && sets.every(s => s.reps >= sl.hi)) base[sl.ex] += x.inc;
          return { ex: sl.ex, n: x.n, mus: x.mus || [], sec: x.sec || [], pat: sl.pat, lo: sl.lo, hi: sl.hi, sets };
        });
        tr.log.push({ id: X.uid(), type: "lift", date, name: day.name, dayIdx: idx % tr.plan.days.length, dur: 42 + Math.round(rnd() * 12), rating: 3, ex });
        idx++;
        if (k === 3 || k === 7) tr.log.push({ id: X.uid(), type: "hiit", date: E.addDays(date, 1), name: "Intermediate intervals", dur: 12, rounds: 10, work: 30, rest: 30, rating: 4 });
      });
      tr.log.sort((a, b) => a.date.localeCompare(b.date));
      tr.plan.next = idx % tr.plan.days.length;
    }

    return {
      viewTrain, bodyMap, screens: { workout: viewWorkout, hiit: viewHiit, library: viewLibrary, trainhist: viewHist, freestyle: viewFreestyle },
      dashTiles, seed, ensureAll, openFreestyle: () => X.push({ v: "freestyle" }), startNext: () => { const tr = T(); if (tr.active) X.push({ v: "workout" }); else if (tr.plan) startWorkout(tr.plan.next % tr.plan.days.length); else { X.go("train"); planWizard(); } },
      stopAll: () => { stopRest(); }
    };
  };
})();
