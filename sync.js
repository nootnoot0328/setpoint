/* ==========================================================================
   Setpoint sync — encryption, change tracking, record-level merge, and the
   sync round-trip against the Worker. No DOM; runs in Node for tests.

   Model
   - The state is flattened into records with stable keys:
       w|date  weigh-in          i|date|id  food entry     x|date  fasting day
       c|id    custom food       m|id       saved meal     k|date  check-in
       t|id    training session  h|date     Apple Health daily (steps)
       s|name  whole sections (profile, goal, settings, training plan …)
   - Every save compares records with the last saved copy. A changed record
     gets meta.u[key] = now; a vanished one gets meta.tomb[key] = now.
   - Merging two devices keeps, per record, whichever copy changed last,
     unless a deletion is newer still.
   - The whole merged state is gzipped and encrypted with AES-GCM-256 using
     a key derived from your passphrase (PBKDF2-SHA256, 310 000 rounds)
     before it leaves the device. The Worker only ever stores ciphertext.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SPSync = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const SYNC_SETTINGS = ["kcalPerKg", "alpha", "estimator", "rho", "dash", "backupDays", "voice", "sound"];
  const SECTIONS = {
    profile: S => S.profile,
    goal: S => S.goal,
    settings: S => { const o = {}; SYNC_SETTINGS.forEach(k => { if (S.settings && S.settings[k] !== undefined) o[k] = S.settings[k]; }); return o; },
    trainProfile: S => S.train ? S.train.profile : undefined,
    trainPlan: S => S.train ? S.train.plan : undefined,
    trainActive: S => S.train ? S.train.active : undefined
  };
  const TOMB_DAYS = 120;

  /* --------------------------------------------------------- records */
  function flatten(S) {
    const r = {};
    for (const d in S.weights || {}) r["w|" + d] = S.weights[d];
    for (const d in S.intake || {}) for (const e of S.intake[d]) if (e && e.id) r["i|" + d + "|" + e.id] = e;
    for (const d in S.fasted || {}) if (S.fasted[d]) r["x|" + d] = true;
    for (const f of S.custom || []) if (f && f.id) r["c|" + f.id] = f;
    for (const m of S.meals || []) if (m && m.id) r["m|" + m.id] = m;
    for (const c of (S.program && S.program.checkins) || []) r["k|" + c.date] = c;
    for (const t of (S.train && S.train.log) || []) if (t && t.id) r["t|" + t.id] = t;
    for (const d in S.health || {}) r["h|" + d] = S.health[d];
    for (const k in SECTIONS) { const v = SECTIONS[k](S); if (v !== undefined) r["s|" + k] = v; }
    return r;
  }
  function unflatten(r, base) {
    const S = JSON.parse(JSON.stringify(base));
    S.weights = {}; S.intake = {}; S.fasted = {}; S.custom = []; S.meals = []; S.health = {};
    S.program = Object.assign({}, S.program, { checkins: [] });
    S.train = Object.assign({ profile: null, plan: null, active: null }, S.train, { log: [] });
    for (const k of Object.keys(r).sort()) {
      const v = r[k], i = k.indexOf("|"), t = k.slice(0, i), rest = k.slice(i + 1);
      if (t === "w") S.weights[rest] = v;
      else if (t === "i") { const d = rest.split("|")[0]; (S.intake[d] = S.intake[d] || []).push(v); }
      else if (t === "x") S.fasted[rest] = true;
      else if (t === "c") S.custom.push(v);
      else if (t === "m") S.meals.push(v);
      else if (t === "k") S.program.checkins.push(v);
      else if (t === "t") S.train.log.push(v);
      else if (t === "h") S.health[rest] = v;
      else if (t === "s") {
        if (rest === "profile") S.profile = v;
        else if (rest === "goal") S.goal = v;
        else if (rest === "settings") S.settings = Object.assign({}, S.settings, v);
        else if (rest === "trainProfile") S.train.profile = v;
        else if (rest === "trainPlan") S.train.plan = v;
        else if (rest === "trainActive") S.train.active = v;
      }
    }
    for (const d in S.intake) S.intake[d].sort((a, b) => String(a.t).localeCompare(String(b.t)) || String(a.id).localeCompare(String(b.id)));
    S.program.checkins.sort((a, b) => a.date.localeCompare(b.date));
    S.train.log.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
    return S;
  }

  /* FNV-1a, enough to notice that a record changed. */
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  function hashes(S) { const f = flatten(S), o = {}; for (const k in f) o[k] = hash(JSON.stringify(f[k])); return o; }
  function fingerprint(S) { const h = hashes(S); return hash(Object.keys(h).sort().map(k => k + ":" + h[k]).join(",")); }

  /* Record what changed since the last save. Returns the new hash map. */
  function stamp(S, prev, now) {
    now = now || Date.now();
    S.meta = S.meta || {}; S.meta.u = S.meta.u || {}; S.meta.tomb = S.meta.tomb || {};
    const cur = hashes(S);
    if (prev) {
      for (const k in cur) if (prev[k] !== cur[k]) { S.meta.u[k] = now; delete S.meta.tomb[k]; }
      for (const k in prev) if (!(k in cur)) { S.meta.tomb[k] = now; delete S.meta.u[k]; }
    }
    return cur;
  }

  function merge(L, R) {
    const fl = flatten(L), fr = flatten(R);
    const m = x => (x && x.meta) || {};
    const uL = m(L).u || {}, uR = m(R).u || {}, tL = m(L).tomb || {}, tR = m(R).tomb || {};
    const keys = new Set([...Object.keys(fl), ...Object.keys(fr), ...Object.keys(tL), ...Object.keys(tR)]);
    const out = {}, u = {}, tomb = {};
    for (const k of keys) {
      const a = k in fl ? (uL[k] || 0) : -1, b = k in fr ? (uR[k] || 0) : -1;
      let v, t = -1;
      if (a >= 0 && a >= b) { v = fl[k]; t = a; } else if (b >= 0) { v = fr[k]; t = b; }
      const dead = Math.max(tL[k] || 0, tR[k] || 0);
      if (t >= 0 && t >= dead && !(dead > 0 && t === dead)) { out[k] = v; if (t) u[k] = t; }
      else if (dead) tomb[k] = dead;
    }
    const cutoff = Date.now() - TOMB_DAYS * 864e5;
    for (const k in tomb) if (tomb[k] < cutoff) delete tomb[k];
    const M = unflatten(out, L);
    M.meta = { u, tomb };
    return M;
  }

  /* Apple Health readings from the Worker inbox.
     A weight you typed yourself always beats one from Apple Health. */
  function applyHealth(S, items) {
    let n = 0;
    S.health = S.health || {};
    const sorted = (items || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    for (const r of sorted) {
      const d = r.date; if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) continue;
      const cur = S.weights[d];
      const mine = cur && cur.src !== "health";
      if (r.weight != null && !mine) {
        S.weights[d] = { kg: Math.round(r.weight * 10) / 10, bf: r.bodyFat != null ? r.bodyFat : (cur ? cur.bf : null), mm: cur ? cur.mm : null, src: "health" };
        n++;
      } else if (r.bodyFat != null && cur && (cur.bf == null || cur.src === "health")) {
        cur.bf = r.bodyFat; n++;
      }
      if (r.steps != null || r.activeKcal != null) {
        const h = S.health[d] || {};
        if (r.steps != null) h.steps = Math.max(h.steps || 0, r.steps);
        if (r.activeKcal != null) h.active = Math.max(h.active || 0, r.activeKcal);
        S.health[d] = h; n++;
      }
    }
    return n;
  }

  /* --------------------------------------------------------- crypto */
  const te = new TextEncoder(), td = new TextDecoder();
  function b64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function randomB64(n) { return b64(crypto.getRandomValues(new Uint8Array(n))); }
  function randomKey() { return randomB64(24).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  const ITER = 310000;
  async function deriveKey(passphrase, saltB64, iterations) {
    const base = await crypto.subtle.importKey("raw", te.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(saltB64), iterations: iterations || ITER, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  async function seal(obj, key, saltB64) {
    let data = te.encode(JSON.stringify(obj)), z = false;
    if (typeof CompressionStream !== "undefined") { data = await pipe(data, new CompressionStream("gzip")); z = true; }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
    return { v: 1, alg: "AES-GCM-256+PBKDF2-SHA256", it: ITER, salt: saltB64, iv: b64(iv), z, ct: b64(ct) };
  }
  async function open(blob, key) {
    let pt;
    try { pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct))); }
    catch (e) { const err = new Error("That passphrase doesn't unlock the cloud copy."); err.code = "BAD_PASS"; throw err; }
    if (blob.z) pt = await pipe(pt, new DecompressionStream("gzip"));
    return JSON.parse(td.decode(pt));
  }

  /* --------------------------------------------------------- client */
  function client(cfg, fetchImpl) {
    const f = fetchImpl || ((...a) => fetch(...a));
    const base = String(cfg.url || "").replace(/\/+$/, "");
    const H = { Authorization: "Bearer " + cfg.appKey, "Content-Type": "application/json" };
    const call = async (path, opt) => {
      let r;
      try { r = await f(base + path, Object.assign({ headers: H }, opt)); }
      catch (e) { const err = new Error("Can't reach the Worker. Check the address and your connection."); err.code = "NET"; throw err; }
      let j = null; try { j = await r.json(); } catch (e) { }
      if (r.status === 401) { const err = new Error("The Worker rejected the app key."); err.code = "AUTH"; throw err; }
      return { status: r.status, ok: r.ok, j: j || {} };
    };
    return {
      async ping() { const r = await call("/", { headers: {} }); return r.j; },
      async getState() { const r = await call("/state"); if (!r.ok) throw new Error(r.j.error || "HTTP " + r.status); return r.j; },
      async putState(ver, blob) {
        const r = await call("/state", { method: "PUT", body: JSON.stringify({ base: ver, blob }) });
        if (r.status === 409) return Object.assign({ conflict: true }, r.j);
        if (!r.ok) throw new Error(r.j.error || "HTTP " + r.status);
        return r.j;
      },
      async getInbox() { const r = await call("/inbox"); if (!r.ok) throw new Error(r.j.error || "HTTP " + r.status); return r.j.items || []; },
      async clearInbox(keys) { if (!keys.length) return; await call("/inbox", { method: "DELETE", body: JSON.stringify({ keys }) }); }
    };
  }

  /* One full round: pull, decrypt, merge, pull Health inbox, push if needed. */
  async function syncOnce(S, ctx) {
    const { cli, key, salt } = ctx;
    const before = fingerprint(S);
    const cur = await cli.getState();
    let remote = cur.blob ? await open(cur.blob, key) : null;
    let M = remote ? merge(S, remote) : S;
    // Health inbox
    const items = await cli.getInbox();
    let health = 0;
    if (items.length) {
      const prev = hashes(M);
      health = applyHealth(M, items);
      stamp(M, prev);
    }
    let ver = cur.ver, pushed = false;
    if (!remote || fingerprint(M) !== fingerprint(remote)) {
      let res = await cli.putState(cur.ver, await seal(M, key, salt));
      if (res.conflict) {
        const r2 = await open(res.blob, key);
        M = merge(M, r2);
        res = await cli.putState(res.ver, await seal(M, key, salt));
        if (res.conflict) { const err = new Error("Another device is syncing. Try again in a moment."); err.code = "BUSY"; throw err; }
      }
      ver = res.ver; pushed = true;
    }
    if (items.length) await cli.clearInbox(items.map(i => i.key));
    return { S: M, ver, pushed, health, changed: fingerprint(M) !== before };
  }

  return { SYNC_SETTINGS, flatten, unflatten, hash, hashes, fingerprint, stamp, merge, applyHealth,
    b64, unb64, randomB64, randomKey, deriveKey, seal, open, client, syncOnce };
});
