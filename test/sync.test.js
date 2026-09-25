/* Run with:  node test/sync.test.js   (Node 20+; uses built-in WebCrypto) */
"use strict";
const assert = require("assert");
const Y = require("../js/sync.js");

function blank() {
  return {
    v: 2, profile: { sex: "m", age: 35, heightCm: 172, activity: 1.45 }, goal: { mode: "loss", ratePct: 0.6 },
    settings: { kcalPerKg: 7700, alpha: 0.25, theme: "dark", demo: false },
    weights: {}, intake: {}, fasted: {}, custom: [], meals: [], health: {},
    program: { checkins: [] }, train: { profile: null, plan: null, log: [], active: null }
  };
}
const clone = o => JSON.parse(JSON.stringify(o));
const entry = (id, kcal, t) => ({ id, name: "food " + id, kcal, p: 1, f: 1, c: 1, qty: 1, unit: "x", base: { kcal, p: 1, f: 1, c: 1 }, t: t || "12:00" });

let pass = 0;
const test = async (n, f) => { try { await f(); pass++; console.log("  ok  " + n); } catch (e) { console.error("  FAIL " + n + "\n       " + (e.stack || e.message)); process.exit(1); } };

(async () => {
  console.log("Setpoint sync");

  await test("flatten → unflatten round-trips the data", async () => {
    const S = blank();
    S.weights["2026-09-20"] = { kg: 86 }; S.intake["2026-09-20"] = [entry("a", 500, "08:00"), entry("b", 300, "13:00")];
    S.custom.push({ id: "c1", n: "Mum's curry" }); S.train.log.push({ id: "t1", date: "2026-09-20", type: "lift", ex: [] });
    const back = Y.unflatten(Y.flatten(S), S);
    assert.deepStrictEqual(back.weights, S.weights);
    assert.deepStrictEqual(back.intake, S.intake);
    assert.deepStrictEqual(back.custom, S.custom);
    assert.deepStrictEqual(back.train.log, S.train.log);
  });

  await test("stamp marks edits and records deletions", async () => {
    const S = blank(); S.weights["2026-09-20"] = { kg: 86 };
    let h = Y.stamp(S, null, 1);
    S.weights["2026-09-21"] = { kg: 85.8 }; h = Y.stamp(S, h, 10);
    assert.strictEqual(S.meta.u["w|2026-09-21"], 10);
    assert.ok(!("w|2026-09-20" in S.meta.u), "untouched record keeps no stamp");
    delete S.weights["2026-09-20"]; Y.stamp(S, h, 20);
    assert.strictEqual(S.meta.tomb["w|2026-09-20"], 20);
  });

  await test("merge unions entries made on different devices", async () => {
    const base = blank(); let h = Y.stamp(base, null, 1);
    const A = clone(base), B = clone(base);
    let ha = clone(h), hb = clone(h);
    A.intake["2026-09-25"] = [entry("a1", 400)]; Y.stamp(A, ha, 100);
    B.intake["2026-09-25"] = [entry("b1", 250)]; Y.stamp(B, hb, 110);
    const M = Y.merge(A, B);
    assert.deepStrictEqual(M.intake["2026-09-25"].map(e => e.id).sort(), ["a1", "b1"]);
  });

  await test("merge: the later edit of the same record wins", async () => {
    const base = blank(); base.weights["2026-09-25"] = { kg: 86 }; const h = Y.stamp(base, null, 1);
    const A = clone(base), B = clone(base);
    A.weights["2026-09-25"].kg = 85.9; Y.stamp(A, clone(h), 200);
    B.weights["2026-09-25"].kg = 86.4; Y.stamp(B, clone(h), 300);
    assert.strictEqual(Y.merge(A, B).weights["2026-09-25"].kg, 86.4);
    assert.strictEqual(Y.merge(B, A).weights["2026-09-25"].kg, 86.4);
  });

  await test("merge: a newer deletion removes, an older one doesn't", async () => {
    const base = blank(); base.intake["2026-09-25"] = [entry("x", 300)]; const h = Y.stamp(base, null, 1);
    const A = clone(base), B = clone(base);
    A.intake["2026-09-25"] = []; Y.stamp(A, clone(h), 500);                // deleted on A at 500
    B.intake["2026-09-25"][0].kcal = 350; Y.stamp(B, clone(h), 400);     // edited on B at 400
    assert.ok(!Y.merge(A, B).intake["2026-09-25"], "deletion at 500 beats edit at 400");
    const C = clone(base); C.intake["2026-09-25"][0].kcal = 360; Y.stamp(C, clone(h), 600);
    assert.strictEqual(Y.merge(A, C).intake["2026-09-25"][0].kcal, 360);
  });

  await test("device-only settings (theme, demo) never travel", async () => {
    const A = blank(), B = blank(); B.settings.theme = "light"; B.settings.alpha = 0.3;
    Y.stamp(B, Y.hashes(blank()), 50);
    const M = Y.merge(A, B);
    assert.strictEqual(M.settings.theme, "dark"); assert.strictEqual(M.settings.alpha, 0.3);
  });

  await test("encryption round-trips; a wrong passphrase fails cleanly", async () => {
    const salt = Y.randomB64(16), key = await Y.deriveKey("correct horse battery", salt, 2000);
    const S = blank(); S.weights["2026-09-25"] = { kg: 86.2 };
    const blob = await Y.seal(S, key, salt);
    assert.ok(!JSON.stringify(blob).includes("86.2"), "ciphertext must not contain plaintext");
    assert.deepStrictEqual((await Y.open(blob, key)).weights, S.weights);
    const bad = await Y.deriveKey("wrong", salt, 2000);
    await assert.rejects(() => Y.open(blob, bad), e => e.code === "BAD_PASS");
  });

  await test("Apple Health: typed weight wins, Health fills gaps, steps stored", async () => {
    const S = blank(); S.weights["2026-09-24"] = { kg: 86.0 };
    const n = Y.applyHealth(S, [
      { date: "2026-09-24", weight: 85.1, at: "1" },
      { date: "2026-09-25", weight: 85.7, bodyFat: 31.9, steps: 8400, at: "2" }]);
    assert.strictEqual(S.weights["2026-09-24"].kg, 86.0);
    assert.deepStrictEqual(S.weights["2026-09-25"], { kg: 85.7, bf: 31.9, mm: null, src: "health" });
    assert.strictEqual(S.health["2026-09-25"].steps, 8400);
    assert.ok(n >= 2);
  });

  await test("end to end: two devices + Shortcut through the real Worker code", async () => {
    const { default: worker } = await import("../worker/worker.js");
    class KV { constructor() { this.m = new Map(); }
      async get(k) { const v = this.m.get(k); return v ? v.value : null; }
      async getWithMetadata(k) { const v = this.m.get(k); return v ? { value: v.value, metadata: v.metadata } : { value: null, metadata: null }; }
      async put(k, value, o = {}) { this.m.set(k, { value, metadata: o.metadata || null }); }
      async delete(k) { this.m.delete(k); }
      async list({ prefix }) { return { keys: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; } }
    const env = { SP: new KV(), APP_KEY: "k-app", INBOX_KEY: "k-inbox", ALLOWED_ORIGINS: "*" };
    const fetchImpl = (url, opt) => worker.fetch(new Request(url, opt), env);
    const salt = Y.randomB64(16), key = await Y.deriveKey("pass phrase", salt, 2000);
    const cli = Y.client({ url: "https://w.dev", appKey: "k-app" }, fetchImpl);

    // phone logs breakfast and syncs
    let phone = blank(); let hp = Y.stamp(phone, null, 1);
    phone.intake["2026-09-25"] = [entry("p1", 430, "08:00")]; hp = Y.stamp(phone, hp, 100);
    let r = await Y.syncOnce(phone, { cli, key, salt }); phone = r.S;
    assert.ok(r.pushed);
    // laptop starts empty, syncs, gets breakfast, adds lunch
    let lap = blank(); let hl = Y.stamp(lap, null, 1);
    r = await Y.syncOnce(lap, { cli, key, salt }); lap = r.S; hl = Y.hashes(lap);
    assert.strictEqual(lap.intake["2026-09-25"][0].id, "p1");
    lap.intake["2026-09-25"].push(entry("l1", 600, "12:30")); Y.stamp(lap, hl, 200);
    await Y.syncOnce(lap, { cli, key, salt });
    // Shortcut posts a weigh-in with the inbox key
    const post = await fetchImpl("https://w.dev/inbox", { method: "POST", headers: { Authorization: "Bearer k-inbox", "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-09-25", weight: "85.6 kg", bodyFat: "0.315", steps: 7200 }) });
    assert.strictEqual(post.status, 200);
    // phone syncs again: gets lunch and the weigh-in; inbox is emptied
    r = await Y.syncOnce(phone, { cli, key, salt }); phone = r.S;
    assert.deepStrictEqual(phone.intake["2026-09-25"].map(e => e.id), ["p1", "l1"]);
    assert.strictEqual(phone.weights["2026-09-25"].kg, 85.6);
    assert.strictEqual(phone.weights["2026-09-25"].bf, 31.5);
    assert.strictEqual(r.health, 2);   // one weigh-in + one steps update
    const inbox = await cli.getInbox(); assert.strictEqual(inbox.length, 0);
    // what Cloudflare holds is unreadable
    const stored = env.SP.m.get("state").value;
    assert.ok(!stored.includes("85.6") && !stored.includes("food p1"));
  });

  console.log(`\n${pass} passed`);
})();
