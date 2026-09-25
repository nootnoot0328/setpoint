/* ==========================================================================
   Setpoint sync Worker — Cloudflare Workers + KV. One file, no dependencies.

   What it stores (binding SP):
     state          one ENCRYPTED blob of your whole Setpoint data. The app
                    encrypts it before sending; this Worker never sees the
                    plaintext and never needs the passphrase.
     inbox:<id>     readings posted by the Apple Health Shortcut (weight,
                    body fat, steps). Plain numbers, auto-expire after 30
                    days, deleted as soon as the app has pulled them.

   Keys (set as encrypted secrets, never in this file):
     APP_KEY        your devices: read/write state, read/clear inbox
     INBOX_KEY      the Shortcut: can ONLY add inbox readings

   Routes
     GET    /                 health check, no auth
     GET    /state            → { ver, at, blob }            (APP_KEY)
     PUT    /state            { base, blob } → { ver, at }   (APP_KEY)
                              409 + current state if base is stale
     POST   /inbox            reading or [readings]          (INBOX_KEY or APP_KEY)
     GET    /inbox            → { items: [...] }             (APP_KEY)
     DELETE /inbox            { keys: [...] }                (APP_KEY)
   ========================================================================== */

const VERSION = "1.0.0";
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const INBOX_TTL = 60 * 60 * 24 * 30;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }
    });

    try {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      const isApp = safeEqual(token, env.APP_KEY);
      const isInbox = isApp || safeEqual(token, env.INBOX_KEY);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/" && req.method === "GET") {
        return json({ ok: true, service: "setpoint-sync", version: VERSION, configured: !!(env.APP_KEY && env.INBOX_KEY && env.SP) });
      }
      if (!env.SP) return json({ error: "KV binding SP is missing" }, 500);

      if (path === "/state") {
        if (!isApp) return json({ error: "unauthorised" }, 401);
        if (req.method === "GET") return json(await readState(env));
        if (req.method === "PUT") {
          const body = await req.json().catch(() => null);
          if (!body || typeof body.blob !== "object" || body.blob === null) return json({ error: "expected { base, blob }" }, 400);
          const text = JSON.stringify(body.blob);
          if (text.length > MAX_STATE_BYTES) return json({ error: "state too large" }, 413);
          const cur = await readState(env);
          if ((body.base | 0) !== cur.ver) return json({ error: "stale", ...cur }, 409);
          const meta = { ver: cur.ver + 1, at: new Date().toISOString() };
          await env.SP.put("state", text, { metadata: meta });
          return json(meta);
        }
        return json({ error: "method not allowed" }, 405);
      }

      if (path === "/inbox") {
        if (req.method === "POST") {
          if (!isInbox) return json({ error: "unauthorised" }, 401);
          const body = await req.json().catch(() => null);
          const list = (Array.isArray(body) ? body : [body]).map(normaliseReading).filter(Boolean);
          if (!list.length) return json({ error: "no usable reading (need date plus weight, bodyFat or steps)" }, 400);
          for (const r of list.slice(0, 50)) {
            const key = `inbox:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await env.SP.put(key, JSON.stringify(r), { expirationTtl: INBOX_TTL });
          }
          return json({ ok: true, stored: Math.min(50, list.length), readings: list.slice(0, 50) });
        }
        if (!isApp) return json({ error: "unauthorised" }, 401);
        if (req.method === "GET") {
          const listed = await env.SP.list({ prefix: "inbox:" });
          const items = [];
          for (const k of listed.keys) {
            const v = await env.SP.get(k.name);
            if (v) { try { items.push({ key: k.name, ...JSON.parse(v) }); } catch (e) { } }
          }
          return json({ items });
        }
        if (req.method === "DELETE") {
          const body = await req.json().catch(() => ({}));
          const keys = (body.keys || []).filter(k => typeof k === "string" && k.startsWith("inbox:")).slice(0, 200);
          for (const k of keys) await env.SP.delete(k);
          return json({ ok: true, deleted: keys.length });
        }
        return json({ error: "method not allowed" }, 405);
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "server error", detail: String(e && e.message || e) }, 500);
    }
  }
};

async function readState(env) {
  const { value, metadata } = await env.SP.getWithMetadata("state");
  if (!value) return { ver: 0, at: null, blob: null };
  return { ver: (metadata && metadata.ver) | 0, at: metadata && metadata.at || null, blob: JSON.parse(value) };
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim()).filter(Boolean);
  const allow = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0] || "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

/* Constant-time comparison, so response timing doesn't leak the key. */
function safeEqual(a, b) {
  if (!a || !b || typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/* Shortcuts sends numbers as text with units ("86.2 kg", "32%") and dates in
   whatever format the phone uses. Accept all of that, return clean numbers. */
export function normaliseReading(r) {
  if (!r || typeof r !== "object") return null;
  const num = v => {
    if (v == null || v === "") return null;
    const m = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };
  let date = String(r.date || "").trim();
  const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dmy = date.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (dmy) date = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  else return null;
  const out = { date, source: String(r.source || "shortcut").slice(0, 40), at: new Date().toISOString() };
  let w = num(r.weight);
  if (w != null) {
    const unit = String(r.weightUnit || r.weight || "").toLowerCase();
    if (/lb|pound/.test(unit)) w = w * 0.45359237;
    if (w >= 25 && w <= 350) out.weight = Math.round(w * 100) / 100;
  }
  let bf = num(r.bodyFat);
  if (bf != null) {
    if (bf > 0 && bf < 1) bf = bf * 100;          // HealthKit stores 0.32 for 32 %
    if (bf >= 2 && bf <= 70) out.bodyFat = Math.round(bf * 10) / 10;
  }
  const steps = num(r.steps);
  if (steps != null && steps >= 0 && steps < 200000) out.steps = Math.round(steps);
  const act = num(r.activeKcal);
  if (act != null && act >= 0 && act < 10000) out.activeKcal = Math.round(act);
  return out.weight != null || out.bodyFat != null || out.steps != null ? out : null;
}
