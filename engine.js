/* ==========================================================================
   Setpoint engine — pure functions, no DOM.
   Loads in the browser as window.Engine and in Node via require().

   Core idea: expenditure is MEASURED, not predicted. Over a rolling window
   we fit a least-squares line through raw scale readings and invert the
   energy balance equation:

       expenditure = mean intake − (d[weight]/dt) × kcalPerKg

   The regression's standard error on the slope becomes an honest ±1σ band.

   Since v2.1 the default estimator is a two-state Kalman filter (weight,
   expenditure) that runs day by day, treats unlogged days as uncertain
   rather than skipping them, and updates smoothly. The window regression
   is kept as an alternative and as a cross-check.

   Sources
   - Mifflin-St Jeor: Mifflin MD et al., Am J Clin Nutr 1990;51:241-7
   - Katch-McArdle:   RMR = 370 + 21.6 × fat-free mass (kg)
   - 7700 kcal/kg:    conventional energy density of adipose tissue; an
                      approximation (early loss is glycogen + water).
   - Adaptive kcal/kg: Forbes GB, Ann NY Acad Sci 2000;904:359-65 (lean
                      share of weight change = 10.4 / (10.4 + fat mass));
                      Hall KD, Int J Obes 2008;32:573-6 (fat 9440 kcal/kg,
                      lean tissue 1816 kcal/kg).
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  /* ------------------------------------------------------------- basics */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r0 = v => Math.round(v);
  const r1 = v => Math.round(v * 10) / 10;

  function isoDate(d) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }
  function parse(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
  const today = () => isoDate(new Date());
  function addDays(iso, n) { const d = parse(iso); d.setDate(d.getDate() + n); return isoDate(d); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  const weekday = iso => parse(iso).getDay();              // 0 = Sunday
  const isWeekend = iso => { const w = weekday(iso); return w === 0 || w === 6; };
  const weekStart = iso => addDays(iso, -((weekday(iso) + 6) % 7)); // Monday
  function range(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }

  /* --------------------------------------------------------- physiology */
  function mifflin(p, kg) {
    const b = 10 * kg + 6.25 * p.heightCm - 5 * p.age;
    return p.sex === "m" ? b + 5 : b - 161;
  }
  const katch = ffm => 370 + 21.6 * ffm;

  function latestWeight(S, asOf) {
    asOf = asOf || today();
    let best = null;
    for (const k in S.weights) if (k <= asOf && (!best || k > best)) best = k;
    return best ? Object.assign({ date: best }, S.weights[best]) : null;
  }
  /* Body fat counts only if measured in the last 60 days. */
  function latestBf(S, asOf) {
    asOf = asOf || today();
    let best = null;
    for (const k in S.weights) {
      const w = S.weights[k];
      if (k <= asOf && w.bf != null && (!best || k > best)) best = k;
    }
    if (!best || daysBetween(best, asOf) > 60) return null;
    return { date: best, bf: S.weights[best].bf };
  }
  function restingRate(S, asOf) {
    const w = latestWeight(S, asOf);
    if (!w) return null;
    const bf = latestBf(S, asOf);
    if (bf && bf.bf > 3 && bf.bf < 65) return katch(w.kg * (1 - bf.bf / 100));
    return mifflin(S.profile, w.kg);
  }
  function fatFreeMass(S, asOf) {
    const w = latestWeight(S, asOf), bf = latestBf(S, asOf);
    return w && bf ? w.kg * (1 - bf.bf / 100) : null;
  }

  /* ------------------------------------------------------ least squares */
  function linreg(pts) {
    const n = pts.length;
    if (n < 3) return null;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= n; my /= n;
    let sxx = 0, sxy = 0;
    for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); }
    if (sxx === 0) return null;
    const slope = sxy / sxx, intercept = my - slope * mx;
    let sse = 0;
    for (const p of pts) { const r = p.y - (intercept + slope * p.x); sse += r * r; }
    const dof = n - 2, mse = dof > 0 ? sse / dof : 0;
    return { slope, intercept, n, seSlope: dof > 0 ? Math.sqrt(mse / sxx) : Infinity, rmse: Math.sqrt(mse) };
  }

  /* ------------------------------------------------------------- trend */
  /* EWMA over raw weigh-ins, with smoothing decayed across gaps so a long
     break doesn't over-anchor to an old reading. */
  function trendSeries(S) {
    const keys = Object.keys(S.weights).sort();
    const a = S.settings.alpha, out = [];
    let t = null, last = null;
    for (const k of keys) {
      const kg = S.weights[k].kg;
      if (t === null) t = kg;
      else {
        const gap = Math.max(1, daysBetween(last, k));
        t += (1 - Math.pow(1 - a, gap)) * (kg - t);
      }
      last = k;
      out.push({ date: k, raw: kg, trend: t, bf: S.weights[k].bf ?? null });
    }
    return out;
  }
  function trendAt(S, asOf, ser) {
    ser = ser || trendSeries(S);
    let hit = null;
    for (const p of ser) { if (p.date <= asOf) hit = p; else break; }
    return hit;
  }

  /* ------------------------------------------------------------ intake */
  function dayTotals(S, d) {
    const rows = S.intake[d] || [];
    return rows.reduce((a, r) => ({ kcal: a.kcal + r.kcal, p: a.p + r.p, f: a.f + r.f, c: a.c + r.c, n: a.n + 1 }),
      { kcal: 0, p: 0, f: 0, c: 0, n: 0 });
  }
  const isTracked = (S, d) => !!(S.intake[d] && S.intake[d].length) || !!(S.fasted && S.fasted[d]);
  function dayKcal(S, d) {
    if (S.fasted && S.fasted[d]) return 0;
    const rows = S.intake[d];
    return rows && rows.length ? rows.reduce((s, r) => s + r.kcal, 0) : null;
  }

  /* ------------------------------------------- expenditure estimator */
  /* ---------------------------------------- energy per kg of change
     Fixed (settings.kcalPerKg) unless settings.rho === "auto" and a recent
     body-fat reading exists. Then the lean share of any change follows the
     Forbes curve, and each share carries its own energy density (Hall). */
  function energyDensity(S, asOf) {
    const fixed = S.settings.kcalPerKg || 7700;
    if (S.settings.rho !== "auto") return fixed;
    const w = latestWeight(S, asOf), bf = latestBf(S, asOf);
    if (!w || !bf) return fixed;
    const fm = w.kg * bf.bf / 100;
    const lean = 10.4 / (10.4 + fm);
    return lean * 1816 + (1 - lean) * 9440;
  }

  function estimateExpenditure(S, asOf) {
    return (S.settings.estimator === "window") ? estimateWindow(S, asOf) : estimateKalman(S, asOf);
  }

  /* ------------------------------------------------------ Kalman filter
     State x = [w (kg), T (kcal/day)].  Each morning:
       1. update with the scale reading, if any:  z = w + v,  v ~ N(0, R)
       2. record the estimate for that day
       3. predict tomorrow using the day's intake I:
            w' = w + (I − T)/ρ      T' = T
          An unlogged day uses recent mean intake with a wide variance, so
          the filter knows it doesn't know, instead of pretending the day
          didn't happen.                                                   */
  const KF = { R: 0.55 * 0.55, qW: 0.02 * 0.02, qT: 22 * 22, sdPrior: 350, sdUnlogged: 600 };

  function kalmanRun(S, until) {
    until = until || today();
    const keys = Object.keys(S.weights).filter(k => k <= until).sort();
    if (!keys.length) return null;
    const start = keys[0];
    const rmr0 = restingRate(S, start);
    const T0 = rmr0 ? rmr0 * S.profile.activity : 2200;
    let w = S.weights[start].kg, T = T0;
    let P = [[KF.R, 0], [0, KF.sdPrior * KF.sdPrior]];
    let meanI = null;
    const out = [];
    for (let d = start; d <= until; d = addDays(d, 1)) {
      const rho = energyDensity(S, d);
      // 1. measurement update
      const z = S.weights[d] ? S.weights[d].kg : null;
      if (z != null) {
        const Sv = P[0][0] + KF.R;
        const K0 = P[0][0] / Sv, K1 = P[1][0] / Sv;
        const y = z - w;
        w += K0 * y; T += K1 * y;
        P = [[(1 - K0) * P[0][0], (1 - K0) * P[0][1]],
             [P[1][0] - K1 * P[0][0], P[1][1] - K1 * P[0][1]]];
      }
      out.push({ date: d, w, T, sdT: Math.sqrt(Math.max(0, P[1][1])), sdW: Math.sqrt(Math.max(0, P[0][0])), z, rho });
      // 3. predict to tomorrow
      const I = dayKcal(S, d);
      let Iu, varI = 0;
      if (I != null) { Iu = I; meanI = meanI == null ? I : meanI + 0.15 * (I - meanI); }
      else { Iu = T; varI = KF.sdUnlogged * KF.sdUnlogged; }   // unknown day: assume maintenance, wide variance
      const f = 1 / rho;
      w = w + (Iu - T) * f;
      // P' = F P F' + Q with F = [[1, -f],[0, 1]]
      const a = P[0][0], b = P[0][1], c = P[1][1];
      P = [[a - 2 * f * b + f * f * c + KF.qW + varI * f * f, b - f * c],
           [b - f * c, c + KF.qT]];
    }
    return { start, T0, rows: out };
  }

  function packageKalman(S, run, asOf) {
    const rmr = restingRate(S, asOf);
    const baseline = rmr ? r0(rmr * S.profile.activity) : null;
    const row = run && run.rows.find(r => r.date === asOf) || (run && run.rows[run.rows.length - 1]);
    if (!row || row.date > asOf) {
      return { kcal: baseline, se: null, source: "formula", baseline, credibility: 0, window: null, coverage: 0, weighIns: 0, slopeKgWk: null, measured: null, clamped: false, method: "kalman" };
    }
    let T = row.T, clamped = false;
    if (rmr) { const lo = rmr * 0.95, hi = rmr * 2.8; if (T < lo || T > hi) { T = clamp(T, lo, hi); clamped = true; } }
    // data quality over the last 28 days, for display
    const from = addDays(asOf, -27);
    let wi = 0, lg = 0; const pts = [];
    for (let i = 0; i < 28; i++) {
      const d = addDays(from, i);
      if (S.weights[d]) { wi++; pts.push({ x: i, y: S.weights[d].kg }); }
      if (dayKcal(S, d) != null) lg++;
    }
    const reg = pts.length >= 4 ? linreg(pts) : null;
    const days = daysBetween(run.start, asOf) + 1;
    const cred = clamp(1 - row.sdT / KF.sdPrior, 0, 1);
    return {
      kcal: r0(T), measured: r0(row.T), se: r0(row.sdT), baseline, credibility: cred,
      source: row.sdT < 140 && days >= 14 ? "measured" : row.sdT < 260 ? "blended" : "formula",
      window: Math.min(28, days), coverage: lg / 28, weighIns: wi, slopeKgWk: reg ? reg.slope * 7 : null,
      clamped, method: "kalman", rho: r0(row.rho), trendW: row.w
    };
  }
  function estimateKalman(S, asOf) {
    asOf = asOf || today();
    return packageKalman(S, kalmanRun(S, asOf), asOf);
  }

  function estimateWindow(S, asOf) {
    asOf = asOf || today();
    const kpk = energyDensity(S, asOf);
    const rmr = restingRate(S, asOf);
    const baseline = rmr ? rmr * S.profile.activity : null;

    // Keep the longest qualifying window. Slope and mean intake must cover
    // the SAME span, so the window is trimmed to the stretch actually
    // bracketed by weigh-ins and intake is averaged over exactly that.
    let best = null;
    for (const W of [14, 21, 28, 35]) {
      const start = addDays(asOf, -(W - 1));
      const wpts = [];
      for (let i = 0; i < W; i++) {
        const d = addDays(start, i);
        if (S.weights[d]) wpts.push({ x: i, y: S.weights[d].kg });
      }
      if (wpts.length < 8) continue;
      const first = wpts[0].x, last = wpts[wpts.length - 1].x, span = last - first + 1;
      if (span < W * 0.75) continue;
      const ik = [];
      for (let i = first; i <= last; i++) { const k = dayKcal(S, addDays(start, i)); if (k !== null) ik.push(k); }
      const coverage = ik.length / span;
      if (coverage < 0.6 || ik.length < 8) continue;
      const reg = linreg(wpts);
      if (!reg || !isFinite(reg.seSlope)) continue;
      const meanIntake = ik.reduce((a, b) => a + b, 0) / ik.length;
      best = {
        window: span, coverage, weighIns: wpts.length, meanIntake,
        raw: meanIntake - reg.slope * kpk, se: reg.seSlope * kpk, slopeKgWk: reg.slope * 7
      };
    }

    if (!best) {
      return {
        kcal: baseline ? r0(baseline) : null, se: null, source: "formula",
        baseline: baseline ? r0(baseline) : null, credibility: 0,
        window: null, coverage: 0, weighIns: 0, slopeKgWk: null, measured: null, clamped: false, method: "window"
      };
    }
    let measured = best.raw, clamped = false;
    if (rmr) {
      const lo = rmr * 0.95, hi = rmr * 2.8;
      if (measured < lo || measured > hi) { measured = clamp(measured, lo, hi); clamped = true; }
    }
    // Shrink toward the formula while data is thin.
    const cred = clamp((best.weighIns / 14) * best.coverage, 0, 1);
    const kcal = baseline ? cred * measured + (1 - cred) * baseline : measured;
    return {
      kcal: r0(kcal), measured: r0(measured), se: r0(best.se),
      baseline: baseline ? r0(baseline) : null, credibility: cred,
      source: cred > 0.75 ? "measured" : "blended",
      window: best.window, coverage: best.coverage, weighIns: best.weighIns,
      meanIntake: r0(best.meanIntake), slopeKgWk: best.slopeKgWk, clamped, method: "window", rho: r0(kpk)
    };
  }

  /* ------------------------------------------------------ target engine */
  function goalRateKgWk(S, trendKg) {
    const g = S.goal;
    if (g.mode === "maintain") return 0;
    const mag = Math.abs(g.ratePct) / 100 * trendKg;
    return g.mode === "loss" ? -mag : mag;
  }

  /* Split one day's calories: protein fixed, remainder shared between fat
     and carbs in the same ratio as the average day. */
  function splitDay(kcal, p, fAvg, cAvg) {
    const rest = Math.max(0, kcal - p * 4);
    const fk = fAvg * 9, ck = cAvg * 4, tot = fk + ck || 1;
    return { kcal: r0(kcal), p: r0(p), f: r0(rest * fk / tot / 9), c: r0(rest * ck / tot / 4) };
  }

  function computeTargets(S, asOf) {
    asOf = asOf || today();
    const exp = estimateExpenditure(S, asOf);
    const w = latestWeight(S, asOf);
    const tr = trendAt(S, asOf);
    const rmr = restingRate(S, asOf);
    const kpk = energyDensity(S, asOf);
    const flags = [];
    if (!exp.kcal || !w) return { exp, flags: [{ t: "warn", msg: "Add your profile and a weigh-in to get targets." }], ready: false };

    const trendKg = tr ? tr.trend : w.kg;
    const ffm = fatFreeMass(S, asOf);
    let rateKgWk = goalRateKgWk(S, trendKg);
    const g = S.goal;

    if (g.goalWeight && g.mode === "loss" && trendKg <= g.goalWeight) {
      rateKgWk = 0; flags.push({ t: "ok", msg: "Goal weight reached. Targets are now set to maintain." });
    } else if (g.goalWeight && g.mode === "gain" && trendKg >= g.goalWeight) {
      rateKgWk = 0; flags.push({ t: "ok", msg: "Goal weight reached. Targets are now set to maintain." });
    }

    const requested = rateKgWk;
    let kcal = exp.kcal + rateKgWk * kpk / 7;
    let floored = false;
    if (rmr && kcal < rmr) {
      kcal = rmr; floored = true;
      rateKgWk = (kcal - exp.kcal) * 7 / kpk;
      flags.push({ t: "bad", msg: `The requested ${Math.abs(requested).toFixed(2)} kg/wk would put intake below your estimated resting rate (${r0(rmr)} kcal). Targets are held at that floor, which gives about ${Math.abs(rateKgWk).toFixed(2)} kg/wk. Once your real burn is measured this may loosen.` });
    }
    const ratePctWk = rateKgWk / trendKg * 100;
    if (!floored && Math.abs(ratePctWk) > 1.0) flags.push({
      t: "warn", msg: `${r1(Math.abs(ratePctWk))}%/wk is above the ~1%/wk line where lean-mass loss climbs. Fine for a short block, not for months.`
    });

    const pRef = g.proteinMode === "lbm" && ffm ? ffm : trendKg;
    let protein = g.proteinPerKg * pRef;
    let fat = Math.max(g.fatPerKg, 0.5) * trendKg;
    let carbs = (kcal - protein * 4 - fat * 9) / 4;
    if (carbs < 30) {
      const pMin = 1.6 * pRef;
      protein = clamp((kcal - fat * 9 - 120) / 4, pMin, protein);
      carbs = (kcal - protein * 4 - fat * 9) / 4;
      if (carbs < 30) { fat = Math.max(0.5 * trendKg, (kcal - protein * 4 - 120) / 9); carbs = (kcal - protein * 4 - fat * 9) / 4; }
      flags.push({ t: "warn", msg: "Protein and fat nearly fill the calorie budget, so protein was trimmed to leave room for carbohydrate." });
    }

    const wk = (g.weekendPct || 0) / 100;
    const weekendK = kcal * (1 + wk), weekdayK = (kcal * 7 - weekendK * 2) / 5;
    if (wk > 0 && rmr && weekdayK < rmr) flags.push({ t: "warn", msg: "The weekend bump pushes weekday calories below your resting rate. Lower the bump." });

    return {
      ready: true, exp, rmr: rmr ? r0(rmr) : null, ffm, trendKg,
      kcal: r0(kcal), rateKgWk, ratePctWk, floored, flags,
      weekday: splitDay(weekdayK, protein, fat, carbs),
      weekend: splitDay(weekendK, protein, fat, carbs),
      avg: { kcal: r0(kcal), p: r0(protein), f: r0(fat), c: r0(carbs) }
    };
  }

  /* ------------------------------------------------------- check-ins */
  function lastCheckin(S, asOf) {
    const cs = (S.program && S.program.checkins) || [];
    let hit = null;
    for (const c of cs) if (!asOf || c.date <= asOf) hit = c;
    return hit;
  }
  function checkinStatus(S, asOf) {
    asOf = asOf || today();
    const last = lastCheckin(S);
    if (!last) return { due: true, daysSince: null, daysLeft: 0, last: null };
    const since = daysBetween(last.date, asOf);
    return { due: since >= 7, daysSince: since, daysLeft: Math.max(0, 7 - since), last };
  }
  function makeCheckin(S, asOf) {
    asOf = asOf || today();
    const t = computeTargets(S, asOf);
    if (!t.ready) return null;
    const prev = lastCheckin(S, addDays(asOf, -1));
    const trPrev = prev ? prev.trendKg : null;
    return {
      date: asOf, exp: t.exp.kcal, se: t.exp.se, source: t.exp.source,
      trendKg: r1(t.trendKg), rateKgWk: t.rateKgWk, ratePctWk: t.ratePctWk,
      kcal: t.kcal, weekday: t.weekday, weekend: t.weekend, floored: t.floored,
      flags: t.flags,
      delta: prev ? {
        exp: t.exp.kcal - prev.exp, kcal: t.kcal - prev.kcal,
        rateEffect: r0((t.rateKgWk - prev.rateKgWk) * energyDensity(S, asOf) / 7),
        trendKg: trPrev != null ? r1(t.trendKg - trPrev) : null,
        days: daysBetween(prev.date, asOf)
      } : null
    };
  }
  /* Targets in force on a given date: the check-in active then, otherwise
     a live computation. */
  function targetsFor(S, date) {
    const cs = (S.program && S.program.checkins) || [];
    let c = null;
    for (const x of cs) if (x.date <= date) c = x;
    if (!c && cs.length) c = cs[0];
    if (c) return isWeekend(date) ? c.weekend : c.weekday;
    const t = computeTargets(S, date);
    return t.ready ? (isWeekend(date) ? t.weekend : t.weekday) : null;
  }

  /* ------------------------------------------------------------ goals */
  function goalProgress(S, asOf) {
    asOf = asOf || today();
    const g = S.goal, tr = trendAt(S, asOf);
    if (!tr || !g.goalWeight || g.mode === "maintain") return null;
    const start = g.startWeight || trendSeries(S)[0].trend;
    const total = g.goalWeight - start, done = tr.trend - start;
    const pct = total === 0 ? 1 : clamp(done / total, 0, 1);
    const c = lastCheckin(S);
    const rate = c ? c.rateKgWk : goalRateKgWk(S, tr.trend);
    const remaining = g.goalWeight - tr.trend;
    let eta = null;
    if (rate && Math.sign(rate) === Math.sign(remaining)) eta = addDays(asOf, Math.round(remaining / rate * 7));
    return { start, current: tr.trend, goal: g.goalWeight, pct, remaining, rate, eta };
  }
  function goalFeasibility(S, asOf) {
    const w = latestWeight(S, asOf), bf = latestBf(S, asOf);
    if (!w || !bf) return null;
    const ffm = w.kg * (1 - bf.bf / 100);
    const levels = S.profile.sex === "m" ? [10, 12, 15, 18, 20, 25] : [18, 20, 23, 25, 28, 32];
    return { ffm, fat: w.kg - ffm, bf: bf.bf, weight: w.kg, rows: levels.map(b => ({ bf: b, kg: ffm / (1 - b / 100) })) };
  }
  /* Implied body fat at a goal weight if lean mass is fully kept. */
  function impliedBf(S, goalKg) {
    const ffm = fatFreeMass(S);
    if (!ffm || !goalKg) return null;
    return (1 - ffm / goalKg) * 100;
  }

  /* ----------------------------------------------------------- habits */
  function streak(S, asOf) {
    asOf = asOf || today();
    let d = isTracked(S, asOf) ? asOf : addDays(asOf, -1), n = 0;
    while (isTracked(S, d)) { n++; d = addDays(d, -1); }
    return n;
  }

  /* =================================================================
     TRAINING — plan builder and progression. Pure functions; the exercise
     library (exercises.js) is passed in so this runs under Node too.
     ================================================================= */
  const TEMPLATES = {
    FA: { name: "Full Body A", slots: [["squat", "C"], ["hpush", "C"], ["hpull", "C"], ["lunge", "A"], ["core", "A"], ["tri", "X"]] },
    FB: { name: "Full Body B", slots: [["hinge", "C"], ["vpush", "C"], ["vpull", "C"], ["delts", "A"], ["core", "A"], ["bi", "X"]] },
    UA: { name: "Upper A", slots: [["hpush", "C"], ["hpull", "C"], ["vpush", "C"], ["vpull", "C"], ["tri", "A"], ["bi", "A"]] },
    LA: { name: "Lower A", slots: [["squat", "C"], ["hinge", "C"], ["lunge", "A"], ["calves", "A"], ["core", "A"]] },
    UB: { name: "Upper B", slots: [["vpush", "C"], ["vpull", "C"], ["hpush", "C"], ["hpull", "C"], ["delts", "A"], ["core", "A"]] },
    LB: { name: "Lower B", slots: [["hinge", "C"], ["squat", "C"], ["lunge", "A"], ["calves", "A"], ["core", "A"]] }
  };
  const FALLBACK = { vpull: "hpull", delts: null, bi: null, calves: null };
  const LVL = { beginner: 0, intermediate: 1, expert: 2 };
  const TIERS = { bw: ["bw"], bar: ["bw", "bar"], db: ["bw", "db"], gym: ["bw", "bar", "db", "gym"] };

  function allowedTiers(equip) {
    const set = new Set(["bw"]);
    (equip || []).forEach(e => (TIERS[e] || [e]).forEach(t => set.add(t)));
    return set;
  }
  /* First exercise in the pattern's preference list that the equipment
     allows and that isn't above the lifter's level. */
  function pickExercise(LIB, pat, equip, level, avoid) {
    const ok = allowedTiers(equip), lv = LVL[level] ?? 0;
    const list = (LIB.patterns[pat] || []).map(id => LIB.ex[id]).filter(Boolean);
    const fits = list.filter(x => ok.has(x.eq) && !(avoid || []).includes(x.id));
    return fits.find(x => (LVL[x.lvl] ?? 0) <= lv) || fits.find(x => (LVL[x.lvl] ?? 0) <= lv + 1) || null;
  }
  function alternatives(LIB, pat, equip) {
    const ok = allowedTiers(equip);
    return (LIB.patterns[pat] || []).map(id => LIB.ex[id]).filter(x => x && ok.has(x.eq));
  }
  function slotScheme(role, goal, level, type) {
    const inter = level !== "beginner";
    if (type === "time") return { sets: role === "C" ? 3 : 2, lo: 30, hi: 60 };
    if (role === "C") return goal === "muscle" && inter ? { sets: 4, lo: 6, hi: 10 } : { sets: 3, lo: 8, hi: 12 };
    if (type === "reps") return { sets: role === "X" ? 2 : 3, lo: 10, hi: 20 };
    return { sets: role === "X" ? 2 : inter ? 3 : 2, lo: 10, hi: 15 };
  }
  function buildPlan(LIB, prof) {
    const d = prof.days || 3;
    const keys = d <= 3 ? ["FA", "FB"] : ["UA", "LA", "UB", "LB"];
    const days = keys.map(k => {
      const t = TEMPLATES[k], used = [];
      const slots = [];
      for (const [pat0, role] of t.slots) {
        if (role === "X" && prof.goal !== "muscle") continue;   // arm work only for a muscle goal
        let pat = pat0, ex = pickExercise(LIB, pat, prof.equip, prof.level, used);
        if (!ex && FALLBACK[pat0]) { pat = FALLBACK[pat0]; ex = pickExercise(LIB, pat, prof.equip, prof.level, used); }
        if (!ex) continue;
        used.push(ex.id);
        const sc = slotScheme(role, prof.goal, prof.level, ex.type);
        slots.push({ pat, role, ex: ex.id, sets: sc.sets, lo: sc.lo, hi: sc.hi, rest: role === "C" ? 120 : 75 });
      }
      return { key: k, name: t.name, slots };
    });
    return { created: today(), days, next: 0, perWeek: d };
  }

  /* Double progression.
     load: hit the top of the rep range on every set with ≥1 rep in reserve
           → add one weight step and restart at the bottom of the range.
           Fell below the range at failure → back off ~10%.
           Otherwise keep the weight and chase one more rep.
     reps: same idea, but the "weight step" is a harder variation.
     time: +5 s per session up to 90 s.                                   */
  function nextTarget(slot, ex, last) {
    const done = last ? last.sets.filter(s => s.done && s.reps != null) : [];
    const out = { w: null, reps: `${slot.lo}–${slot.hi}`, note: "", harder: null };
    if (!done.length) {
      if (ex.type === "load") out.note = `Pick a weight you could lift about ${slot.hi + 2} times. Stop each set with 1–2 reps left in the tank.`;
      else if (ex.type === "time") { out.reps = `${slot.lo}s`; out.note = "Hold with good form. Stop before your form breaks."; }
      else out.note = "Stop each set with 1–2 reps left in the tank.";
      return out;
    }
    const rir = s => s.rir == null ? 2 : s.rir;
    const avgRir = done.reduce((a, s) => a + rir(s), 0) / done.length;
    if (ex.type === "time") {
      const m = Math.min(...done.map(s => s.reps));
      const t = Math.min(90, m + 5);
      out.reps = `${t}s`; out.note = m >= 90 ? "Maxed at 90 s. Move to a harder variation or add load." : `Last time ${m}s. Aim for ${t}s.`;
      return out;
    }
    const top = done.every(s => s.reps >= slot.hi) && avgRir >= 1;
    const easyTop = done.every(s => s.reps >= slot.hi) && avgRir >= 3;
    const under = done.some(s => s.reps < slot.lo);
    const failed = done.every(s => rir(s) === 0);
    if (ex.type === "load") {
      const lw = done[done.length - 1].w || 0;
      const step = ex.inc || 2.5;
      if (top) {
        const jumps = easyTop ? 2 : 1;
        out.w = +(lw + step * jumps).toFixed(2); out.reps = `${slot.lo}–${slot.hi}`;
        out.note = `Hit ${slot.hi} on every set${easyTop ? " with plenty in reserve" : ""}. Up to ${out.w} kg.`;
      } else if (under && failed) {
        out.w = Math.max(0, Math.round(lw * 0.9 / step) * step); out.note = `Missed the range at failure. Drop to ${out.w} kg and build back up.`;
      } else {
        out.w = lw;
        const minR = Math.min(...done.map(s => s.reps));
        out.reps = `${Math.min(slot.hi, minR + 1)}+`;
        out.note = `Same weight. Aim for ${Math.min(slot.hi, minR + 1)}+ reps on every set.`;
      }
      return out;
    }
    // bodyweight reps
    const minR = Math.min(...done.map(s => s.reps));
    if (top && ex.harder) { out.harder = ex.harder; out.note = `Hit ${slot.hi} on every set. Ready for the harder version.`; }
    else if (top) { out.reps = `${slot.hi}+`; out.note = "Top of the range. Slow the lowering to 3 seconds to keep it hard."; }
    else out.note = `Aim for ${Math.min(slot.hi, minR + 1)}+ reps on every set.`;
    return out;
  }

  /* Session difficulty (1 way too easy … 5 way too hard) nudges volume for
     that plan day: ±1 set per exercise, clamped to 2–5 sets. */
  function applyRating(day, rating) {
    const d = rating <= 1 ? 1 : rating >= 5 ? -1 : 0;
    if (!d) return day;
    day.slots.forEach(s => { s.sets = clamp(s.sets + d, 2, 5); });
    return day;
  }

  /* Hard sets per muscle group for the week containing asOf. */
  const PAT_GROUP = { squat: "Quads", lunge: "Quads", hinge: "Glutes & hams", hpush: "Chest", vpush: "Shoulders", delts: "Shoulders", hpull: "Back", vpull: "Back", core: "Core", bi: "Arms", tri: "Arms", calves: "Calves" };
  function weeklySets(S, asOf) {
    const ws = weekStart(asOf || today()), we = addDays(ws, 6);
    const out = {};
    for (const s of (S.train && S.train.log) || []) {
      if (s.type !== "lift" || s.date < ws || s.date > we) continue;
      for (const e of s.ex) {
        const g = PAT_GROUP[e.pat]; if (!g) continue;
        out[g] = (out[g] || 0) + e.sets.filter(x => x.done).length;
      }
    }
    return out;
  }
  /* MET-based estimate, for information only (it is already inside the
     measured expenditure). Ainsworth BE et al., Compendium of Physical
     Activities, 2011: resistance training ~5.0, HIIT/calisthenics ~8.0. */
  function sessionKcal(type, minutes, kg) { return r0((type === "hiit" ? 8 : 5) * kg * minutes / 60); }

  /* ---------------------------------------------- freestyle picker
     Body-diagram regions map to free-exercise-db muscle names. The picker
     ranks candidates for each tapped muscle: curated core first, then
     compound over isolation, then exercises at or below your level, with
     a seeded shuffle so "Shuffle" gives a different but sensible pick.  */
  const REGION = {
    chest: ["chest"], shoulders: ["shoulders"], biceps: ["biceps"], triceps: ["triceps"], forearms: ["forearms"],
    abs: ["abdominals"], quads: ["quadriceps"], adductors: ["adductors"], abductors: ["abductors"], calves: ["calves"],
    traps: ["traps", "neck"], lats: ["lats"], upperback: ["middle back"], lowerback: ["lower back"],
    glutes: ["glutes"], hamstrings: ["hamstrings"]
  };
  const REGION_NAME = { chest: "Chest", shoulders: "Shoulders", biceps: "Biceps", triceps: "Triceps", forearms: "Forearms", abs: "Abs",
    quads: "Quads", adductors: "Adductors", abductors: "Abductors", calves: "Calves", traps: "Traps", lats: "Lats",
    upperback: "Upper back", lowerback: "Lower back", glutes: "Glutes", hamstrings: "Hamstrings" };
  function muscleToRegion(m) { for (const r in REGION) if (REGION[r].includes(m)) return r; return null; }

  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

  function pickForMuscles(ALL, regions, equipNames, level, opts) {
    opts = opts || {};
    const eq = new Set(equipNames || ["Bodyweight"]);
    const lv = LVL[level] ?? 0, r = rng(opts.seed || 1);
    const per = regions.length === 1 ? 4 : regions.length === 2 ? 3 : 2;
    const used = new Set(opts.avoid || []), out = [];
    for (const reg of regions) {
      const target = REGION[reg] || [];
      const cands = Object.values(ALL).filter(x =>
        x.mus && x.mus.some(m => target.includes(m)) && eq.has(x.eqn) && !used.has(x.id) &&
        (LVL[x.lvl] ?? 0) <= lv + (lv === 0 ? 0 : 1) && !(x.pats || []).includes("hiit"));
      const tired = x => (x.sec || []).reduce((a, m) => { const g = muscleToRegion(m); return a + (g && g !== reg && opts.fatigue && opts.fatigue[g] ? opts.fatigue[g].fatigue : 0); }, 0);
      const scored = cands.map(x => ({ x, s: (x.core ? -3 : 0) + (x.mech === "compound" ? -1 : 0) + ((LVL[x.lvl] ?? 0) > lv ? 1.5 : 0) + tired(x) * 2 + r() * 2.2 }));
      scored.sort((a, b) => a.s - b.s);
      let n = 0;
      for (const { x } of scored) {
        if (n >= per || out.length >= (opts.max || 8)) break;
        out.push({ ex: x.id, region: reg }); used.add(x.id); n++;
      }
    }
    return out;
  }
  function freestyleScheme(ex) {
    if (ex.type === "time") return { sets: 3, lo: 30, hi: 60, rest: 60 };
    if (ex.type === "reps") return { sets: 3, lo: 10, hi: 20, rest: 75 };
    return ex.mech === "compound" ? { sets: 3, lo: 8, hi: 12, rest: 120 } : { sets: 3, lo: 10, hi: 15, rest: 75 };
  }
  /* Hard sets per body region over [from, to]. Primary muscles count a full
     set; secondary muscles half a set (a common convention in training
     volume research). Uses the muscles stored on each logged exercise. */
  function muscleSets(S, from, to) {
    const out = {};
    for (const s of (S.train && S.train.log) || []) {
      if (s.type !== "lift" || s.date < from || s.date > to) continue;
      for (const e of s.ex) {
        const n = e.sets.filter(x => x.done).length; if (!n) continue;
        const prim = new Set((e.mus || []).map(muscleToRegion).filter(Boolean));
        if (!prim.size && PAT_GROUP_REGION[e.pat]) prim.add(PAT_GROUP_REGION[e.pat]);
        const sec = new Set((e.sec || []).map(muscleToRegion).filter(x => x && !prim.has(x)));
        prim.forEach(g => out[g] = (out[g] || 0) + n);
        sec.forEach(g => out[g] = (out[g] || 0) + n / 2);
      }
    }
    return out;
  }
  /* ---------- "What fits now" ----------
     Suggests a few things to eat next that fit what's left of today's
     targets. Candidates: built-in dishes, your custom foods and saved meals,
     plus a protein add-on when a dish alone leaves protein short. Scored on
     how well calories land on this meal's share of what's left, protein,
     and fat; foods you eat often get a nudge. A seed reshuffles. */
  const SLOTS = {
    breakfast: { name: "Breakfast", share: 0.3 }, lunch: { name: "Lunch", share: 0.45 },
    snack: { name: "Snack", share: 0.2 }, dinner: { name: "Dinner", share: 0.9 }, rest: { name: "Rest of day", share: 1 }
  };
  function slotFor(hour) { return hour < 11 ? "breakfast" : hour < 15 ? "lunch" : hour < 17 ? "snack" : hour < 22 ? "dinner" : "snack"; }
  const BREAKFAST_RX = /kaya|toast|prata|thosai|dosa|idli|chwee kueh|carrot cake|chai tow|porridge|congee|bee hoon|nasi lemak|lor mai kai|chee cheong|dim sum|siew mai|har gow|pau|bun|egg|oat|bread|yoghurt|yogurt|cereal|mee siam|lontong|min jiang|you tiao|tau huay|soya bean/i;
  const NOT_SNACK_RX = /rice|noodle|mee|kway teow|hor fun|briyani|biryani|set|plate|burger|pasta|steak/i;
  // protein add-ons that make sense at each meal
  const ADDONS = {
    breakfast: ["Soft-boiled eggs, 2", "Soya bean milk, unsweetened", "Greek yoghurt, 0%", "Whey protein"],
    snack: ["Whey protein", "Greek yoghurt, 0%", "Soft-boiled eggs, 2", "Soya bean milk, unsweetened"],
    meal: ["Soft-boiled eggs, 2", "Tofu, firm", "Chicken breast, cooked", "Soya bean milk, unsweetened"]
  };
  function fitsRemaining(S, date) {
    const tg = targetsFor(S, date); if (!tg) return null;
    const t = dayTotals(S, date);
    return { target: tg, eaten: t, kcal: tg.kcal - t.kcal, p: tg.p - t.p, f: tg.f - t.f, c: tg.c - t.c };
  }
  function suggestFits(S, FOODS, date, opts) {
    opts = opts || {};
    const rem = fitsRemaining(S, date); if (!rem) return { rem: null, options: [] };
    const slot = opts.slot || slotFor(opts.hour ?? new Date().getHours());
    const share = SLOTS[slot].share;
    const B = Math.max(0, rem.kcal) * share;                  // calories to aim for in this meal
    const Pn = Math.max(0, rem.p) * share;                    // protein to aim for
    const r = rng(opts.seed || 1), avoid = new Set(opts.exclude || []);
    // how often each food shows up in the last 60 days
    const fam = {};
    for (const d of Object.keys(S.intake || {})) if (daysBetween(d, date) <= 60 && d <= date) for (const e of S.intake[d]) fam[e.name] = (fam[e.name] || 0) + 1;
    const addons = (ADDONS[slot] || ADDONS.meal).map(n => FOODS.find(f => f.n === n)).filter(Boolean);
    const cands = [];
    const add = (key, label, items, src) => {
      if (avoid.has(key)) return;
      const t = items.reduce((a, it) => ({ kcal: a.kcal + it.f.kcal * it.qty, p: a.p + it.f.p * it.qty, f: a.f + it.f.f * it.qty, c: a.c + it.f.c * it.qty }), { kcal: 0, p: 0, f: 0, c: 0 });
      cands.push({ key, label, items, src, ...t });
    };
    const pool = [];
    for (const f of FOODS) {
      if (f.tag === "sg") pool.push({ f, src: "hawker" });
    }
    for (const f of S.custom || []) if (f.kcal) pool.push({ f: { n: f.n, kcal: f.kcal, p: f.p || 0, f: f.f || 0, c: f.c || 0, unit: f.unit || "serving", g: f.g || 0 }, src: "mine" });
    for (const f of pool) {
      const n = f.f.n;
      if (slot === "breakfast" && f.src === "hawker" && !BREAKFAST_RX.test(n)) continue;
      if (slot === "snack" && (f.f.kcal > 380 || NOT_SNACK_RX.test(n))) continue;
      if (slot !== "breakfast" && slot !== "snack" && f.src === "hawker" && f.f.kcal < 250) continue;   // a main meal, not a side
      add("f:" + n, n, [{ f: f.f, qty: 1 }], f.src);
      // the same dish with a protein add-on, when the dish alone is low on protein
      if (f.f.p < Pn - 12 && f.f.p >= 6 && !/kacang|chendol|pisang|kueh|waffle|tau huay|bubble|ice cream|cake|pie|tart|bingsu|dessert/i.test(n)) for (const a of addons) if (a.n !== n) add(`f:${n}+${a.n}`, `${n} + ${a.n}`, [{ f: f.f, qty: 1 }, { f: a, qty: 1 }], f.src);
    }
    for (const m of S.meals || []) {
      const items = (m.items || []).map(it => ({ f: { n: it.n, kcal: it.kcal, p: it.p, f: it.f, c: it.c, unit: it.unit, g: it.g }, qty: it.qty || 1 }));
      if (items.length) add("m:" + m.id, m.name, items, "meal");
    }
    if (slot === "snack" || B < 250) for (const a of addons) add("f:" + a.n, a.n, [{ f: a, qty: 1 }], "addon");
    const scored = [];
    for (const c of cands) {
      if (c.kcal > Math.max(rem.kcal, 0) * 1.08 + 40) continue;          // would blow the day
      const d = (c.kcal - B) / Math.max(B, 150);
      let s = d > 0 ? (d * 2.4) ** 2 : (d * 1.1) ** 2;
      s += 1.0 * Math.min(1, Math.max(0, Pn - c.p) / Math.max(Pn, 20));
      s += 0.9 * Math.max(0, c.f - Math.max(rem.f, 0) * Math.min(1, share + 0.15)) / Math.max(rem.f, 15);
      const seen = c.items.reduce((a, it) => a + (fam[it.f.n] || 0), 0);
      if (seen) s -= Math.min(0.25, 0.06 * seen);
      if (c.src === "meal" || c.src === "mine") s -= 0.1;
      if (c.items.length > 1) s += 0.35;                                  // a plain dish beats a dish plus a side
      s += r() * 0.45;
      scored.push({ ...c, score: s, familiar: seen > 0 });
    }
    scored.sort((a, b) => a.score - b.score);
    const out = [], heads = new Set(), sides = new Set();
    for (const c of scored) {
      const head = c.items[0].f.n.split(/[ ,(]/)[0].toLowerCase();       // one kind of dish per round
      const side = c.src !== "meal" && c.items.length > 1 ? c.items[c.items.length - 1].f.n : null;
      if (heads.has(head) || (side && (sides.has(side) || sides.size >= 2))) continue;
      heads.add(head); if (side) sides.add(side); out.push(c);
      if (out.length >= (opts.n || 4)) break;
    }
    const after = o => ({ kcal: rem.kcal - o.kcal, p: rem.p - o.p, f: rem.f - o.f, c: rem.c - o.c });
    return { rem, slot, budget: Math.round(B), protein: Math.round(Pn), options: out.map(o => ({ ...o, after: after(o) })) };
  }

  /* ---------- report for an AI coach ----------
     buildReport(S, from, to, opts) → plain text a chatbot can read.
     opts.food: include every food item; opts.exType(id) → "load"|"reps"|"time"
     so timed holds print as seconds. */
  const COACH_PROMPT = `Act as my personal trainer and sports nutritionist. Below is an export from my tracking app for the dates shown. Read all of it before answering.

How to judge it:
- My daily expenditure is MEASURED by the app from my weight trend and food log. Treat it as more reliable than any formula; only question it if the logging looks patchy.
- Use evidence-based standards: protein about 1.6-2.2 g per kg body weight, roughly 10-20 hard sets per muscle per week for growth, progressive overload (more reps or load over time), fat loss of about 0.5-1% body weight per week without losing strength.
- Never suggest eating below the resting metabolic rate shown in the report.
- I live in Singapore and eat a lot of hawker food. Suggest realistic local swaps, not meal-prep ideals.
- Be direct. Tell me what I'm doing wrong, with the numbers that show it. No generic motivation.
- If the data is too thin to judge something (few weigh-ins, many unlogged days), say so instead of guessing.

Reply in this order:
1. Verdict: three lines on how this period went against my goal.
2. What's working (keep doing).
3. Problems, most important first, each with the evidence from the data.
4. Nutrition changes: specific numbers (calories, protein) and 3-5 food swaps.
5. Training changes for the next 2 weeks: which exercises, sets, reps and loads to aim for, what to drop or add, and any muscle group I'm under- or over-training.
6. Recovery: sleep, steps, rest days, based on what you see.
7. What I should log better so your next review is more accurate.
8. Up to 3 questions for me.
9. The training program you recommend for the next 2-4 weeks, in this exact format inside one code block so I can import it into the app:

SETPOINT PLAN
DAY | <day name, e.g. Upper A>
<exercise> | <sets> | <reps, e.g. 8-12, or seconds for holds, e.g. 30-45s> | <rest seconds>
DAY | <next day name>
...

Rules for the program: only use equipment listed under "About me"; 2-6 days; 4-8 exercises per day; use standard exercise names as in free-exercise-db (e.g. Dumbbell Bench Press, Goblet Squat, Pullups, Romanian Deadlift, Plank). No warm-ups or notes inside the block.

Keep sections 1-8 under 700 words.

--- REPORT ---
`;
  const DOWN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const RATE_TXT = ["way too easy", "easy", "just right", "hard", "way too hard"];
  const fmt = n => n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString("en-US");
  function buildReport(S, from, to, opts) {
    opts = opts || {};
    const L = [], days = range(from, to), P = S.profile || {}, G = S.goal || {}, tr = S.train || {};
    const push = s => L.push(s);
    push(`SETPOINT REPORT  ${from} to ${to} (${days.length} days)`);
    push("");
    push("## About me");
    if (P.sex) push(`${P.sex === "m" ? "Male" : "Female"}, ${P.age} y, ${P.heightCm} cm.`);
    const goalTxt = G.mode === "maintain" ? "maintain weight" : G.mode === "gain" ? `gain weight at ${G.ratePct}% of body weight per week` : `lose weight at ${G.ratePct}% of body weight per week`;
    push(`Goal: ${goalTxt}${G.goalWeight ? `, goal weight ${G.goalWeight} kg` : ""}.`);
    if (tr.profile) {
      const eqMap = { bw: "bodyweight", bar: "pull-up bar", db: "dumbbells", gym: "full gym" };
      push(`Training plan: ${tr.profile.goal === "muscle" ? "build muscle" : tr.profile.goal || "general"}, ${tr.profile.days} days/week, ${tr.profile.level}, equipment: ${(tr.profile.equip || []).map(x => eqMap[x] || x).join(", ") || "bodyweight"}.`);
      if (tr.plan && tr.plan.days) {
        push("Current plan:");
        tr.plan.days.forEach(d => push(`- ${d.name}: ` + d.slots.map(sl => `${opts.exName ? opts.exName(sl.ex) : sl.ex} ${sl.sets}×${sl.lo}${sl.hi !== sl.lo ? "-" + sl.hi : ""}`).join(", ")));
      }
    }
    push("");

    // summary
    push("## Summary");
    const ser = trendSeries(S), a = trendAt(S, from, ser) || ser.find(p => p.date >= from), b = trendAt(S, to, ser);
    const wIn = days.filter(d => S.weights[d]).length;
    if (a && b) {
      const ch = b.trend - a.trend, wk = ch / Math.max(1, daysBetween(a.date, b.date)) * 7;
      push(`Weight trend: ${a.trend.toFixed(1)} → ${b.trend.toFixed(1)} kg (${ch >= 0 ? "+" : ""}${ch.toFixed(1)} kg, ${wk >= 0 ? "+" : ""}${wk.toFixed(2)} kg/week, ${(wk / b.trend * 100).toFixed(2)}% of body weight/week). Weigh-ins on ${wIn} of ${days.length} days.`);
    } else push(`Weigh-ins on ${wIn} of ${days.length} days.`);
    const bf = latestBf(S, to); if (bf) push(`Body fat: ${bf.bf}% (measured ${bf.date}).`);
    const ex = estimateExpenditure(S, to);
    if (ex && ex.kcal) push(`Expenditure: ${fmt(ex.kcal)}${ex.se ? ` ± ${fmt(ex.se)}` : ""} kcal/day (${ex.source === "formula" ? "formula estimate, not enough data yet" : "measured from weight trend and intake"}).`);
    const rmr = restingRate(S, to); if (rmr) push(`Resting metabolic rate: about ${fmt(rmr)} kcal/day.`);
    const tg = targetsFor(S, to);
    if (tg) push(`Current targets (weekday): ${fmt(tg.kcal)} kcal, protein ${fmt(tg.p)} g, fat ${fmt(tg.f)} g, carbs ${fmt(tg.c)} g.`);
    const logged = days.filter(d => isTracked(S, d));
    if (logged.length) {
      const sum = logged.reduce((acc, d) => { const t = dayTotals(S, d); return { k: acc.k + t.kcal, p: acc.p + t.p, f: acc.f + t.f, c: acc.c + t.c }; }, { k: 0, p: 0, f: 0, c: 0 });
      const n = logged.length;
      let hitP = 0, hitK = 0;
      logged.forEach(d => { const t = dayTotals(S, d), g = targetsFor(S, d); if (g) { if (t.p >= g.p * 0.9) hitP++; if (Math.abs(t.kcal - g.kcal) <= g.kcal * 0.1) hitK++; } });
      push(`Food logged on ${n} of ${days.length} days. Average on logged days: ${fmt(sum.k / n)} kcal, protein ${fmt(sum.p / n)} g, fat ${fmt(sum.f / n)} g, carbs ${fmt(sum.c / n)} g.`);
      push(`Calories within 10% of target on ${hitK}/${n} logged days; protein at least 90% of target on ${hitP}/${n}.`);
    } else push("No food logged in this period.");
    const sess = (tr.log || []).filter(s => s.date >= from && s.date <= to);
    const lifts = sess.filter(s => s.type === "lift"), hiit = sess.filter(s => s.type === "hiit");
    push(`Training: ${lifts.length} lifting sessions, ${hiit.length} conditioning sessions (${(lifts.length / days.length * 7).toFixed(1)} lifts/week).`);
    const H = S.health || {}, st = days.map(d => H[d] && H[d].steps).filter(x => x != null);
    if (st.length) push(`Steps: average ${fmt(st.reduce((x, y) => x + y, 0) / st.length)}/day over ${st.length} days with data.`);
    push("");

    // daily table
    push("## Daily log");
    push("date | weight kg | kcal | protein | fat | carbs | kcal target | steps | training");
    for (const d of days) {
      const w = S.weights[d], t = dayTotals(S, d), g = targetsFor(S, d), fasted = S.fasted && S.fasted[d];
      const trn = sess.filter(s => s.date === d).map(s => s.name).join(" + ");
      const food = fasted ? "fasted | | |" : t.n ? `${fmt(t.kcal)} | ${fmt(t.p)} | ${fmt(t.f)} | ${fmt(t.c)}` : "not logged | | |";
      push(`${d} ${DOWN[weekday(d)]} | ${w ? w.kg + (w.bf != null ? ` (${w.bf}% bf)` : "") : ""} | ${food} | ${g ? fmt(g.kcal) : ""} | ${H[d] && H[d].steps != null ? fmt(H[d].steps) : ""} | ${trn}`);
    }
    push("");

    // food items
    if (opts.food) {
      push("## Food eaten");
      for (const d of days) {
        const rows = (S.intake[d] || []).slice().sort((x, y) => (x.t || "").localeCompare(y.t || ""));
        if (!rows.length) continue;
        push(`${d}: ` + rows.map(r => `${(r.t || "").slice(0, 5)} ${r.name}${r.qty && r.qty !== 1 ? ` ×${r.qty}` : ""}${r.unit && r.unit !== "entry" ? ` (${r.unit})` : ""} ${fmt(r.kcal)} kcal/${fmt(r.p)}p`).join("; "));
      }
      push("");
    }

    // sessions
    if (sess.length) {
      push("## Training sessions");
      push("Sets are written weight kg × reps @ reps in reserve (0 = to failure). Bodyweight sets show reps only; holds show seconds.");
      for (const s of sess) {
        if (s.type === "hiit") { push(`${s.date} ${s.name}: ${s.rounds} rounds ${s.work}s on/${s.rest}s off, ${s.dur} min, felt ${RATE_TXT[(s.rating || 3) - 1]}.`); continue; }
        push(`${s.date} ${s.name}${s.dur ? `, ${s.dur} min` : ""}${s.rating ? `, felt ${RATE_TXT[s.rating - 1]}` : ""}`);
        for (const e of s.ex || []) {
          const done = (e.sets || []).filter(x => x.done);
          if (!done.length) { push(`- ${e.n || e.ex}: skipped`); continue; }
          const ty = opts.exType ? opts.exType(e.ex) : null;
          push(`- ${e.n || e.ex}: ` + done.map(x => {
            const r = ty === "time" ? `${x.reps}s` : `${x.reps ?? "?"}`;
            return (x.w != null && x.w !== "" ? `${x.w}×` : "") + r + (x.rir != null ? `@${x.rir}` : "");
          }).join(", "));
        }
      }
      push("");
      const ms = muscleSets(S, from, to), wks = days.length / 7;
      const list = Object.keys(REGION).map(r => [r, (ms[r] || 0) / wks]).sort((x, y) => y[1] - x[1]);
      push("## Hard sets per muscle per week (secondary muscles count half)");
      push(list.map(([r, v]) => `${REGION_NAME[r]} ${v.toFixed(1)}`).join(", "));
      push("");
    }

    // check-ins
    const cs = ((S.program && S.program.checkins) || []).filter(c => c.date >= from && c.date <= to);
    if (cs.length) {
      push("## Weekly check-ins");
      cs.forEach(c => push(`${c.date}: expenditure ${fmt(c.exp)} kcal, weekday target ${fmt(c.weekday && c.weekday.kcal)} kcal, trend ${c.trendKg != null ? c.trendKg.toFixed(1) + " kg" : "—"}`));
      push("");
    }
    return L.join("\n");
  }

  /* ---------- AI program import ----------
     parseAiPlan reads the SETPOINT PLAN block; matchExercise finds the
     closest library exercise for each name. */
  function parseAiPlan(text) {
    const days = [];
    let cur = null;
    for (let line of String(text || "").split(/\r?\n/)) {
      line = line.trim().replace(/^[-*•]\s*/, "").replace(/^\|/, "").replace(/\|$/, "");
      if (!line.includes("|")) continue;
      const c = line.split("|").map(x => x.trim().replace(/[*_`]/g, ""));
      if (/^day$/i.test(c[0])) { cur = { name: c[1] || `Day ${days.length + 1}`, slots: [] }; days.push(cur); continue; }
      if (c.length < 3 || /^exercise$/i.test(c[0]) || /^-+$/.test(c[0])) continue;
      const sets = Math.round(aiNum(c[1]));
      if (!c[0] || !sets || sets < 1 || sets > 10) continue;
      const rs = String(c[2] || "");
      const secs = /s(ec)?\b|second/i.test(rs);
      const m = rs.replace(/,/g, "").match(/(\d+)\s*(?:-|–|to)\s*(\d+)/), one = rs.match(/\d+/);
      let lo = m ? +m[1] : one ? +one[0] : 10, hi = m ? +m[2] : lo;
      if (hi < lo) [lo, hi] = [hi, lo];
      const rest = c[3] ? Math.round(aiNum(c[3])) || 90 : 90;
      if (!cur) { cur = { name: "Day 1", slots: [] }; days.push(cur); }
      cur.slots.push({ name: c[0], sets, lo, hi, secs, rest: Math.min(300, Math.max(15, /min/i.test(c[3] || "") ? rest * 60 : rest)) });
    }
    return { days: days.filter(d => d.slots.length) };
  }
  const EX_ALIAS = { db: "dumbbell", dbs: "dumbbell", bb: "barbell", kb: "kettlebell", rdl: "romanian deadlift", ohp: "overhead press", bw: "bodyweight",
    pushup: "pushup", pullup: "pullup", chinup: "chinup", situp: "situp", lat: "lat", tricep: "triceps", bicep: "biceps", curls: "curl", raises: "raise", rows: "row", presses: "press", flyes: "fly", flies: "fly", flye: "fly" };
  function exTokens(s) {
    s = String(s || "").toLowerCase().replace(/\b(push|pull|chin|sit)[\s-]+ups?\b/g, "$1up").replace(/[^a-z0-9]+/g, " ");
    const out = [];
    for (let w of s.split(" ")) {
      if (!w || ["with", "the", "a", "on", "and", "of", "to", "version"].includes(w)) continue;
      w = EX_ALIAS[w] || w;
      for (let t of w.split(" ")) { if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") && t !== "triceps" && t !== "biceps" && t !== "abs") t = t.slice(0, -1); out.push(t); }
    }
    return out;
  }
  function matchExercise(ALL, name, opts) {
    opts = opts || {};
    const q = exTokens(name), qs = new Set(q), eq = new Set(opts.equip || []);
    if (!q.length) return [];
    const res = [];
    for (const x of Object.values(ALL)) {
      const t = new Set(exTokens(x.n));
      let hit = 0; qs.forEach(w => { if (t.has(w)) hit++; });
      if (!hit) continue;
      const uni = new Set([...qs, ...t]).size;
      let s = hit / uni;
      if (hit === qs.size) s += 0.15;                     // every word of the request is in the name
      if (x.n.toLowerCase() === String(name).toLowerCase().trim()) s += 1;
      if (x.core) s += 0.08;
      if (eq.size) s += eq.has(x.eqn) ? 0.05 : -0.25;      // prefer what I own
      res.push({ id: x.id, score: s });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, opts.n || 4);
  }

  /* ---------- AI photo estimate import ----------
     Reads the "SETPOINT" block produced by AI_PROMPT: one food per line,
     "name | portion | kcal | protein | fat | carbs". Tolerant of code fences,
     markdown table bars, units ("620 kcal", "30g"), commas and ranges
     ("550-650" → midpoint). Skips header, TOTAL and CONFIDENCE lines. */
  const AI_PROMPT = `You are estimating calories and macros from a food photo for my tracker. I'm in Singapore, so assume local hawker, kopitiam and food-court portions and cooking unless the photo clearly shows otherwise.

How to estimate:
1. List every separate item you can see, including drinks, sauces, gravy, sambal, fried shallots and cooking oil. Hawker food usually has more oil than it looks; include it.
2. Estimate each portion in grams or ml. Use the plate, bowl, cutlery or my hand as a size reference if visible.
3. Base calories on standard nutrition data (Singapore HPB figures where the dish is a known hawker dish).
4. Protein, fat and carbs must roughly agree with calories (4 kcal/g protein and carbs, 9 kcal/g fat).
5. If something is hidden or unclear (e.g. what's under the gravy, whether a drink has sugar), pick the most likely option and say so in the notes. Don't ask me questions first.

Reply with ONLY this, inside one code block, no other text:

SETPOINT
item | portion | kcal | protein | fat | carbs
<name> | <amount, e.g. 1 plate ~350 g> | <kcal> | <g> | <g> | <g>
TOTAL | | <kcal> | <g> | <g> | <g>
CONFIDENCE | <low/medium/high> | <likely error, e.g. ±25%>
NOTES | <one short line: assumptions I should check>

Use whole numbers only, one line per item.`;
  function aiNum(s) {
    s = String(s || "").replace(/,/g, "").trim();
    const r = s.match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
    if (r) return (+r[1] + +r[2]) / 2;
    const m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? +m[0] : null;
  }
  function parseAiEstimate(text) {
    const items = [], meta = {};
    for (let line of String(text || "").split(/\r?\n/)) {
      line = line.trim().replace(/^\|/, "").replace(/\|$/, "");
      if (!line.includes("|")) continue;
      const cells = line.split("|").map(c => c.trim());
      const key = cells[0].toUpperCase().replace(/[*_]/g, "");
      if (key === "CONFIDENCE") { meta.confidence = cells[1] || ""; meta.error = cells[2] || ""; continue; }
      if (key === "NOTES") { meta.notes = cells.slice(1).join(" ").trim(); continue; }
      if (key === "TOTAL") { const n = cells.slice(-4).map(aiNum); if (n.every(x => x != null)) meta.total = { kcal: n[0], p: n[1], f: n[2], c: n[3] }; continue; }
      if (cells.length < 5 || /^-+$/.test(cells[0].replace(/[:\s]/g, ""))) continue;
      const nums = cells.slice(-4).map(aiNum);
      if (nums.some(x => x == null) || !cells[0] || /^item$/i.test(cells[0])) continue;
      const name = cells[0].replace(/[*_`]/g, "").trim();
      const portion = cells.length >= 6 ? cells[1] : "";
      const [kcal, p, f, c] = nums.map(x => Math.max(0, Math.round(x)));
      if (!kcal && !p && !f && !c) continue;
      const fromMacros = p * 4 + f * 9 + c * 4;
      items.push({ name, portion, kcal, p, f, c, mismatch: kcal > 0 && Math.abs(fromMacros - kcal) / kcal > 0.2 });
    }
    return { items, ...meta };
  }

  /* ---------- recovery ----------
     A simple, explainable model, not a physiological measurement.
     Each hard set loads a region (secondary muscles half, sets far from
     failure count less). The load fades linearly to zero over the region's
     window: 72 h for big muscle groups, 48 h for small ones. That matches
     common guidance of 48-72 h between hard sessions for the same muscle
     group (ACSM position stand on progression models, Med Sci Sports Exerc
     2009;41:687-708), with bigger doses taking longer.
     Fatigue 1.0 = about six hard sets just done. "Ready" = below 0.25. */
  const BIG = new Set(["quads", "hamstrings", "glutes", "lowerback", "chest", "lats", "upperback"]);
  const RECOVER_H = r => BIG.has(r) ? 72 : 48;
  const READY = 0.25, FULL = 6;
  function sessionTime(s) {
    if (s.at) return s.at;
    const d = parse(s.date); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18).getTime();
  }
  function effort(set) { const r = set.rir; return r == null ? 0.85 : r <= 1 ? 1 : r <= 3 ? 0.8 : 0.5; }
  function regionLoads(S, now) {
    const out = [];   // [{region, load, t}] where t = session time
    for (const s of (S.train && S.train.log) || []) {
      if (s.type !== "lift") continue;
      const t = sessionTime(s); if (t > now || now - t > 4 * 864e5) continue;
      for (const e of s.ex || []) {
        const load = (e.sets || []).filter(x => x.done).reduce((a, x) => a + effort(x), 0); if (!load) continue;
        const prim = new Set((e.mus || []).map(muscleToRegion).filter(Boolean));
        if (!prim.size && PAT_GROUP_REGION[e.pat]) prim.add(PAT_GROUP_REGION[e.pat]);
        const sec = new Set((e.sec || []).map(muscleToRegion).filter(x => x && !prim.has(x)));
        prim.forEach(r => out.push({ region: r, load, t }));
        sec.forEach(r => out.push({ region: r, load: load / 2, t }));
      }
    }
    return out;
  }
  function fatigueAt(loads, region, at) {
    const W = RECOVER_H(region) * 36e5;
    let f = 0;
    for (const l of loads) if (l.region === region && at >= l.t) f += l.load * Math.max(0, 1 - (at - l.t) / W);
    return f / FULL;
  }
  function recovery(S, now) {
    now = now || Date.now();
    const loads = regionLoads(S, now), out = {};
    for (const r of Object.keys(REGION)) {
      const f = fatigueAt(loads, r, now);
      let h = 0;
      if (f >= READY) { h = 1; while (h < 96 && fatigueAt(loads, r, now + h * 36e5) >= READY) h++; }
      const last = loads.filter(l => l.region === r).reduce((a, l) => Math.max(a, l.t), 0) || null;
      out[r] = { fatigue: Math.min(1.5, f), hoursLeft: h, status: f >= 0.6 ? "recovering" : f >= READY ? "nearly" : "ready", last };
    }
    return out;
  }
  /* Suggest muscles to train now: only ready regions, ranked by how far
     each is below ~10 hard sets over the last 7 days, big groups first on
     a tie. Returns 2-3 regions that pair sensibly. */
  const PAIRS = [["chest", "triceps", "shoulders"], ["lats", "upperback", "biceps"], ["quads", "glutes", "calves"], ["hamstrings", "glutes", "lowerback"], ["shoulders", "traps", "abs"], ["chest", "lats", "abs"]];
  function suggestRegions(S, now) {
    now = now || Date.now();
    const rec = recovery(S, now), to = isoDate(new Date(now)), wk = muscleSets(S, addDays(to, -6), to);
    const need = r => (rec[r].status === "ready" ? 0 : 100) + (wk[r] || 0) - (BIG.has(r) ? 1 : 0);
    let best = null;
    for (const p of PAIRS) {
      const ok = p.filter(r => rec[r].status === "ready");
      if (ok.length < 2) continue;
      const score = ok.reduce((a, r) => a + need(r), 0) / ok.length - ok.length * 0.5;
      if (!best || score < best.score) best = { regions: ok, score };
    }
    if (best) return best.regions;
    return Object.keys(REGION).filter(r => rec[r].status === "ready").sort((a, b) => need(a) - need(b)).slice(0, 3);
  }
  const PAT_GROUP_REGION = { squat: "quads", lunge: "quads", hinge: "hamstrings", hpush: "chest", vpush: "shoulders", delts: "shoulders", hpull: "upperback", vpull: "lats", core: "abs", bi: "biceps", tri: "triceps", calves: "calves" };

  return {
    REGION, REGION_NAME, muscleToRegion, pickForMuscles, freestyleScheme, muscleSets, recovery, suggestRegions, RECOVER_H, PAT_GROUP_REGION, AI_PROMPT, parseAiEstimate, COACH_PROMPT, buildReport, suggestFits, fitsRemaining, FIT_SLOTS: SLOTS, slotFor, parseAiPlan, matchExercise,
    energyDensity, kalmanRun, packageKalman, estimateKalman, estimateWindow, KF,
    TEMPLATES, pickExercise, alternatives, buildPlan, nextTarget, applyRating, weeklySets, sessionKcal, PAT_GROUP,
    clamp, r0, r1, isoDate, parse, today, addDays, daysBetween, weekday, isWeekend, weekStart, range,
    mifflin, katch, latestWeight, latestBf, restingRate, fatFreeMass,
    linreg, trendSeries, trendAt, dayTotals, dayKcal, isTracked,
    estimateExpenditure, computeTargets, splitDay,
    lastCheckin, checkinStatus, makeCheckin, targetsFor,
    goalProgress, goalFeasibility, impliedBf, streak
  };
});
