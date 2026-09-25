/* Run with:  node test/worker.test.mjs   (Node 18+) */
import assert from "node:assert";
import worker, { normaliseReading } from "../worker/worker.js";

class MockKV {
  constructor() { this.m = new Map(); }
  async get(k) { const v = this.m.get(k); return v ? v.value : null; }
  async getWithMetadata(k) { const v = this.m.get(k); return v ? { value: v.value, metadata: v.metadata } : { value: null, metadata: null }; }
  async put(k, value, o = {}) { this.m.set(k, { value, metadata: o.metadata || null }); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix }) { return { keys: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
}
const env = () => ({ SP: new MockKV(), APP_KEY: "app-secret-123", INBOX_KEY: "inbox-secret-456", ALLOWED_ORIGINS: "https://me.github.io" });
const call = async (e, method, path, { key, body, origin } = {}) => {
  const h = { "Content-Type": "application/json" };
  if (key) h.Authorization = "Bearer " + key;
  if (origin) h.Origin = origin;
  const res = await worker.fetch(new Request("https://w.dev" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), e);
  let data = null; try { data = await res.json(); } catch (x) { }
  return { status: res.status, data, headers: res.headers };
};
let pass = 0;
const test = async (n, f) => { try { await f(); pass++; console.log("  ok  " + n); } catch (e) { console.error("  FAIL " + n + "\n       " + e.message); process.exit(1); } };

console.log("Setpoint worker");
await test("health check needs no key", async () => {
  const r = await call(env(), "GET", "/"); assert.strictEqual(r.status, 200); assert.strictEqual(r.data.configured, true);
});
await test("state requires the app key; inbox key is refused", async () => {
  const e = env();
  assert.strictEqual((await call(e, "GET", "/state")).status, 401);
  assert.strictEqual((await call(e, "GET", "/state", { key: "inbox-secret-456" })).status, 401);
  assert.strictEqual((await call(e, "GET", "/state", { key: "app-secret-123" })).status, 200);
});
await test("state round-trips with optimistic versioning", async () => {
  const e = env(), key = "app-secret-123";
  const a = await call(e, "GET", "/state", { key }); assert.deepStrictEqual([a.data.ver, a.data.blob], [0, null]);
  const p1 = await call(e, "PUT", "/state", { key, body: { base: 0, blob: { ct: "abc" } } }); assert.strictEqual(p1.data.ver, 1);
  const stale = await call(e, "PUT", "/state", { key, body: { base: 0, blob: { ct: "old" } } });
  assert.strictEqual(stale.status, 409); assert.strictEqual(stale.data.blob.ct, "abc");
  const p2 = await call(e, "PUT", "/state", { key, body: { base: 1, blob: { ct: "def" } } }); assert.strictEqual(p2.data.ver, 2);
  assert.strictEqual((await call(e, "GET", "/state", { key })).data.blob.ct, "def");
});
await test("inbox key can post but not read or delete", async () => {
  const e = env();
  const p = await call(e, "POST", "/inbox", { key: "inbox-secret-456", body: { date: "2026-09-25", weight: "86.2 kg", bodyFat: 0.318, steps: "8,412" } });
  assert.strictEqual(p.status, 200);
  assert.strictEqual((await call(e, "GET", "/inbox", { key: "inbox-secret-456" })).status, 401);
  const g = await call(e, "GET", "/inbox", { key: "app-secret-123" });
  assert.strictEqual(g.data.items.length, 1);
  assert.strictEqual(g.data.items[0].weight, 86.2);
  assert.strictEqual(g.data.items[0].bodyFat, 31.8);
  const d = await call(e, "DELETE", "/inbox", { key: "app-secret-123", body: { keys: [g.data.items[0].key] } });
  assert.strictEqual(d.data.deleted, 1);
  assert.strictEqual((await call(e, "GET", "/inbox", { key: "app-secret-123" })).data.items.length, 0);
});
await test("no key at all cannot post", async () => {
  assert.strictEqual((await call(env(), "POST", "/inbox", { body: { date: "2026-09-25", weight: 80 } })).status, 401);
});
await test("readings are normalised from Shortcut formats", async () => {
  assert.deepStrictEqual(normaliseReading({ date: "25/09/2026", weight: "190 lb" }).weight, 86.18);
  assert.strictEqual(normaliseReading({ date: "2026-09-25T07:12:00+08:00", bodyFat: "32%" }).bodyFat, 32);
  assert.strictEqual(normaliseReading({ date: "2026-09-25", weight: 5 }), null);   // not a plausible weight
  assert.strictEqual(normaliseReading({ weight: 80 }), null);                      // no date
});
await test("CORS only reflects the allowed origin", async () => {
  const ok = await call(env(), "GET", "/", { origin: "https://me.github.io" });
  assert.strictEqual(ok.headers.get("Access-Control-Allow-Origin"), "https://me.github.io");
  const bad = await call(env(), "GET", "/", { origin: "https://evil.example" });
  assert.notStrictEqual(bad.headers.get("Access-Control-Allow-Origin"), "https://evil.example");
});
console.log(`\n${pass} passed`);
