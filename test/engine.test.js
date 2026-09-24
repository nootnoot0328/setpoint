/* Run with:  node test/engine.test.js
   No dependencies. Exits non-zero on the first failure. */
"use strict";
const assert = require("assert");
const E = require("../js/engine.js");
const LIB = require("../js/exercises.js");

function blank() {
  return {
    profile: { sex: "m", age: 35, heightCm: 172, activity: 1.45 },
    goal: { mode: "loss", ratePct: 0.6, goalWeight: 70, proteinMode: "bw", proteinPerKg: 1.8, fatPerKg: 0.8, weekendPct: 0 },
    settings: { kcalPerKg: 7700, alpha: 0.25 },
    weights: {}, intake: {}, fasted: {}, program: { checkins: [] }
  };
}
function synth(S, days, startKg, intake, tdee, opts = {}) {
  let w = startKg;
  for (let i = days - 1; i >= 0; i--) {
    const d = E.addDays(E.today(), -i);
    const noise = opts.noise ? opts.noise(i) : 0;
    if (!opts.skipWeigh || !opts.skipWeigh(i)) S.weights[d] = { kg: w + noise, bf: opts.bf ?? null };
    if (!opts.skipLog || !opts.skipLog(i)) S.intake[d] = [{ name: "t", kcal: intake, p: 0, f: 0, c: 0 }];
    w += (intake - tdee) / S.settings.kcalPerKg;
  }
}

let pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { console.error("  FAIL " + name + "\n       " + e.message); process.exit(1); }
}

console.log("Setpoint engine");

test("window: recovers expenditure exactly on noiseless loss data", () => {
  const S = blank(); synth(S, 28, 90, 2200, 2900);
  const e = E.estimateWindow(S);
  assert.strictEqual(e.measured, 2900); assert.strictEqual(e.se, 0); assert.strictEqual(e.source, "measured");
});

test("window: recovers expenditure exactly on noiseless gain data", () => {
  const S = blank(); synth(S, 28, 70, 2800, 2400);
  assert.strictEqual(E.estimateWindow(S).measured, 2400);
});

test("window: noisy data lands within 3σ of truth", () => {
  const S = blank();
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  synth(S, 28, 88, 2100, 2750, { noise: () => (rnd() + rnd() + rnd() - 1.5) * 0.6 });
  const e = E.estimateWindow(S);
  assert.ok(Math.abs(e.measured - 2750) < 3 * e.se, `got ${e.measured} ± ${e.se}`);
});

test("window: falls back to formula with too little data", () => {
  const S = blank(); synth(S, 5, 80, 2000, 2500);
  const e = E.estimateWindow(S);
  assert.strictEqual(e.source, "formula"); assert.ok(e.kcal > 1500);
});

test("window: slope and intake use the same span when data starts mid-window", () => {
  const S = blank(); synth(S, 20, 90, 2200, 2900); // only 20 days exist
  const e = E.estimateWindow(S);
  assert.strictEqual(e.measured, 2900);
  assert.ok(e.window <= 20, "window should be trimmed to the data");
});

test("targets never go below resting rate", () => {
  const S = blank(); synth(S, 28, 86, 1500, 2300);
  S.goal.ratePct = 1.5;
  const t = E.computeTargets(S);
  assert.ok(t.floored); assert.ok(t.kcal >= t.rmr);
  assert.ok(t.flags.some(f => f.t === "bad"));
});

test("macro split adds back up to calories", () => {
  const S = blank(); synth(S, 28, 86, 2200, 2800);
  const t = E.computeTargets(S), d = t.weekday;
  assert.ok(Math.abs(d.p * 4 + d.f * 9 + d.c * 4 - d.kcal) <= 8, JSON.stringify(d));
});

test("weekend bump is calorie-neutral across the week", () => {
  const S = blank(); synth(S, 28, 86, 2200, 2800); S.goal.weekendPct = 15;
  const t = E.computeTargets(S);
  const week = t.weekday.kcal * 5 + t.weekend.kcal * 2;
  assert.ok(Math.abs(week - t.kcal * 7) <= 6, `${week} vs ${t.kcal * 7}`);
  assert.strictEqual(t.weekday.p, t.weekend.p);
  assert.ok(t.weekend.kcal > t.weekday.kcal);
});

test("lean-mass protein uses fat-free mass", () => {
  const S = blank(); synth(S, 28, 86, 2200, 2800, { bf: 32 });
  S.goal.proteinMode = "lbm"; S.goal.proteinPerKg = 2.2;
  const t = E.computeTargets(S);
  const ffm = E.latestWeight(S).kg * 0.68;
  assert.ok(Math.abs(t.avg.p - 2.2 * ffm) < 3, `${t.avg.p} vs ${2.2 * ffm}`);
});

test("maintain mode sets rate to zero", () => {
  const S = blank(); synth(S, 28, 80, 2500, 2500); S.goal.mode = "maintain";
  const t = E.computeTargets(S);
  assert.strictEqual(t.rateKgWk, 0); assert.strictEqual(t.kcal, t.exp.kcal);
});

test("check-in is due after 7 days and records deltas", () => {
  const S = blank(); synth(S, 28, 88, 2100, 2750);
  const c1 = E.makeCheckin(S, E.addDays(E.today(), -7)); S.program.checkins.push(c1);
  assert.strictEqual(E.checkinStatus(S).due, true);
  const c2 = E.makeCheckin(S);
  assert.ok(c2.delta && c2.delta.days === 7);
  assert.strictEqual(c2.delta.exp, c2.exp - c1.exp);
  S.program.checkins.push(c2);
  assert.strictEqual(E.checkinStatus(S).due, false);
});

test("goal progress and feasibility", () => {
  const S = blank(); synth(S, 28, 88, 2100, 2750, { bf: 32 });
  S.goal.startWeight = 88; S.goal.goalWeight = 60;
  const g = E.goalProgress(S);
  assert.ok(g.pct > 0 && g.pct < 0.2);
  const bf = E.impliedBf(S, 60);
  assert.ok(bf < 5, "60 kg at 32% bf now implies near-zero body fat: " + bf);
});

test("fasted days count as tracked zero-calorie days", () => {
  const S = blank(); const d = E.today();
  S.fasted[d] = true;
  assert.strictEqual(E.dayKcal(S, d), 0); assert.ok(E.isTracked(S, d));
});

test("streak counts back from yesterday when today is empty", () => {
  const S = blank();
  for (let i = 1; i <= 5; i++) S.intake[E.addDays(E.today(), -i)] = [{ kcal: 100, p: 0, f: 0, c: 0 }];
  assert.strictEqual(E.streak(S), 5);
});

/* ---------------------------------------------------------- Kalman */
const nz = (() => { let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; return () => (r() + r() + r() - 1.5) * 0.6; })();

test("kalman is the default estimator", () => {
  const S = blank(); synth(S, 28, 90, 2200, 2900);
  assert.strictEqual(E.estimateExpenditure(S).method, "kalman");
});

test("kalman converges on clean data within 150 kcal by day 28", () => {
  const S = blank(); synth(S, 28, 90, 2200, 2900);
  const e = E.estimateKalman(S);
  assert.ok(Math.abs(e.kcal - 2900) < 150, `${e.kcal} ± ${e.se}`);
  assert.strictEqual(e.source, "measured");
});

test("kalman handles randomly unlogged days without bias", () => {
  const S = blank(); let s = 3; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  synth(S, 42, 90, 2100, 2700, { noise: nz, skipLog: () => r() < 0.25 });
  const e = E.estimateKalman(S);
  assert.ok(Math.abs(e.kcal - 2700) < 2 * e.se + 50, `${e.kcal} ± ${e.se}`);
});

test("kalman is less biased than the window when heavy days go unlogged", () => {
  const S = blank(); let w = 90;
  for (let i = 41; i >= 0; i--) {
    const d = E.addDays(E.today(), -i), heavy = i % 7 === 5 || i % 7 === 6, I = heavy ? 3200 : 2000;
    S.weights[d] = { kg: w + nz(), bf: null };
    if (!heavy) S.intake[d] = [{ kcal: I, p: 0, f: 0, c: 0 }];
    w += (I - 2700) / 7700;
  }
  const k = E.estimateKalman(S).kcal, win = E.estimateWindow(S).measured;
  assert.ok(Math.abs(k - 2700) < Math.abs(win - 2700), `kalman ${k}, window ${win}`);
});

test("adaptive energy density follows body fat", () => {
  const S = blank(); synth(S, 10, 86, 2100, 2700, { bf: 32 });
  S.settings.rho = "auto";
  const hi = E.energyDensity(S);
  assert.ok(hi > 7100 && hi < 7500, "at 32% bf: " + hi);
  for (const d in S.weights) S.weights[d].bf = 12;
  const lo = E.energyDensity(S);
  assert.ok(lo < hi - 800, "leaner means more lean tissue in the loss: " + lo);
  S.settings.rho = "fixed";
  assert.strictEqual(E.energyDensity(S), 7700);
});

/* -------------------------------------------------------- training */
test("bodyweight-only plan uses no equipment", () => {
  const p = E.buildPlan(LIB, { goal: "muscle", days: 3, equip: [], level: "beginner" });
  const tiers = p.days.flatMap(d => d.slots.map(s => LIB.ex[s.ex].eq));
  assert.ok(tiers.every(t => t === "bw"), tiers.join(","));
});

test("no pull-up bar: vertical pull falls back to a row", () => {
  const p = E.buildPlan(LIB, { goal: "general", days: 3, equip: ["db"], level: "beginner" });
  const b = p.days[1].slots.map(s => s.pat);
  assert.ok(!b.includes("vpull") && b.includes("hpull"), b.join(","));
});

test("gym plan with 4 days is upper/lower", () => {
  const p = E.buildPlan(LIB, { goal: "muscle", days: 4, equip: ["gym"], level: "intermediate" });
  assert.deepStrictEqual(p.days.map(d => d.key), ["UA", "LA", "UB", "LB"]);
  assert.strictEqual(p.days[0].slots[0].sets, 4);
});

test("double progression: top of range adds a step", () => {
  const ex = LIB.ex["Dumbbell_Bench_Press"], slot = { lo: 8, hi: 12 };
  const t = E.nextTarget(slot, ex, { sets: [12, 12, 12].map(r => ({ w: 20, reps: r, rir: 1, done: true })) });
  assert.strictEqual(t.w, 22);
});

test("double progression: short of the top keeps the weight", () => {
  const ex = LIB.ex["Dumbbell_Bench_Press"], slot = { lo: 8, hi: 12 };
  const t = E.nextTarget(slot, ex, { sets: [12, 10, 9].map(r => ({ w: 20, reps: r, rir: 1, done: true })) });
  assert.strictEqual(t.w, 20);
});

test("double progression: failing below range backs off", () => {
  const ex = LIB.ex["Barbell_Squat"], slot = { lo: 8, hi: 12 };
  const t = E.nextTarget(slot, ex, { sets: [7, 6, 6].map(r => ({ w: 100, reps: r, rir: 0, done: true })) });
  assert.strictEqual(t.w, 90);
});

test("bodyweight progression suggests the harder variation", () => {
  const ex = LIB.ex["Incline_Push-Up"], slot = { lo: 10, hi: 20 };
  const t = E.nextTarget(slot, ex, { sets: [20, 20, 21].map(r => ({ reps: r, rir: 2, done: true })) });
  assert.strictEqual(t.harder, "Pushups");
});

test("session rating nudges volume within 2–5 sets", () => {
  const day = { slots: [{ sets: 3 }, { sets: 5 }, { sets: 2 }] };
  E.applyRating(day, 1); assert.deepStrictEqual(day.slots.map(s => s.sets), [4, 5, 3]);
  E.applyRating(day, 5); E.applyRating(day, 5); assert.deepStrictEqual(day.slots.map(s => s.sets), [2, 3, 2]);
});

test("weekly sets are grouped by muscle", () => {
  const S = blank(); S.train = { log: [{ type: "lift", date: E.today(), ex: [
    { pat: "hpush", sets: [{ done: true }, { done: true }, { done: false }] },
    { pat: "vpull", sets: [{ done: true }] }, { pat: "hpull", sets: [{ done: true }, { done: true }] }] }] };
  const w = E.weeklySets(S);
  assert.strictEqual(w.Chest, 2); assert.strictEqual(w.Back, 3);
});

console.log(`\n${pass} passed`);
