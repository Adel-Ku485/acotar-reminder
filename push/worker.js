// Personal reminder – upozornenia (Cloudflare Worker)
// Potrebuje: KV väzbu s názvom SUBS, tajomstvo VAPID_PRIVATE a Cron Trigger */15 * * * *
const VAPID_PUBLIC = 'BP5Go71HrKQuIQ4rWbKDYfGJgu7c1y2MvzkKwZZDzT4tS7tt10iqNkR8Je-3JcqDFXK_PPPZbOU3zeD_c49FmDc';
const VAPID_X = '_kajvUespC4hDitZsoNh8YmC7tzXLYy_OQrBlkPNPi0', VAPID_Y = 'S7tt10iqNkR8Je-3JcqDFXK_PPPZbOU3zeD_c49FmDc';
const SUBJECT = 'https://adel-ku485.github.io/acotar-reminder/';

const LINES = {
  spring: ['Ešte {n}. Tamlin by to vzdal. Ty nie.', 'Ešte {n}. Ruže sa pýtajú, či dnes ešte niečo bude.'],
  summer: ['Ešte {n}. Tarquin čaká elegantne, ale čaká.', 'Ešte {n}. Aj more má príliv. Ty tiež môžeš.'],
  autumn: ['Ešte {n}. Nebuď Beron.', 'Ešte {n}. Eris si už robí poznámky.'],
  winter: ['Ešte {n}. Kallias by nepoľavil.', 'Ešte {n}. Zahrej sa splnením.'],
  dawn:   ['Ešte {n}. Thesan verí v teba.', 'Ešte {n}. Deň ešte nekončí.'],
  day:    ['Ešte {n}. Helion to prepočítal: stihneš to.', 'Ešte {n}. Slnko ešte nezapadlo.'],
  night:  ['Ešte {n} a Cassian ťa pustí.', 'Ešte {n}. Hviezdy počkajú, ale nie dlho.'],
  base:   ['Ešte {n}. Ide ti to.', 'Ešte {n}. Gauč počká.']
};
const NOTHING = {
  spring: 'Dnes si ešte nič neodškrtla. Ruže sú znepokojené.', summer: 'Dnes ešte nič? Adriata sa čuduje.',
  autumn: 'Dnes ešte nič? Beron by bol hrdý. To nechceš.', winter: 'Dnes ešte nič? Aj sneh je aktívnejší.',
  dawn: 'Dnes ešte nič? Nový začiatok je hneď teraz.', day: 'Dnes ešte nič? Helion to zaznamenal.',
  night: 'Dnes ešte nič? Rhys čaká. Trpezlivo. Zatiaľ.', base: 'Dnes ešte nič? Appka je smutná.'
};
function plural(n, a, b, c) { return n === 1 ? a : (n >= 2 && n <= 4 ? b : c); }

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (req.method === 'GET') return json({ ok: true, app: 'personal-reminder-push' });
    let b; try { b = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!b.id || typeof b.id !== 'string' || b.id.length > 64) return json({ error: 'no id' }, 400);
    const key = 'u:' + b.id;
    if (url.pathname === '/subscribe') {
      if (!b.sub || !b.sub.endpoint || !b.sub.keys) return json({ error: 'no sub' }, 400);
      const rec = { sub: b.sub, times: cleanTimes(b.times), tz: b.tz || 'Europe/Bratislava', theme: b.theme || 'base', name: (b.name || '').slice(0, 40), left: b.left ?? null, day: b.day || '', sent: {} };
      await env.SUBS.put(key, JSON.stringify(rec));
      return json({ ok: true });
    }
    const raw = await env.SUBS.get(key);
    if (!raw) return json({ error: 'unknown' }, 404);
    const rec = JSON.parse(raw);
    if (url.pathname === '/status') {
      if (b.times) rec.times = cleanTimes(b.times);
      if (b.theme) rec.theme = b.theme;
      if (b.name !== undefined) rec.name = (b.name || '').slice(0, 40);
      if (b.day) { rec.day = b.day; rec.left = b.left; }
      await env.SUBS.put(key, JSON.stringify(rec));
      return json({ ok: true });
    }
    if (url.pathname === '/unsubscribe') { await env.SUBS.delete(key); return json({ ok: true }); }
    if (url.pathname === '/test') {
      const r = await sendPush(env, rec.sub, { title: 'Personal reminder', body: 'Upozornenia fungujú! Teraz ťa budem strážiť. Jemne. Väčšinou.' });
      return json({ ok: r.ok, status: r.status });
    }
    return json({ error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    let cursor;
    do {
      const list = await env.SUBS.list({ prefix: 'u:', cursor });
      for (const k of list.keys) ctx.waitUntil(checkOne(env, k.name));
      cursor = list.list_complete ? null : list.cursor;
    } while (cursor);
  }
};

function cleanTimes(t) {
  if (!Array.isArray(t)) return ['16:00', '20:30'];
  return t.filter(x => /^\d\d:\d\d$/.test(x)).slice(0, 4);
}
function localNow(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const h = p.hour === '24' ? 0 : +p.hour;
  return { day: `${p.year}-${p.month}-${p.day}`, min: h * 60 + (+p.minute) };
}
async function checkOne(env, key) {
  const raw = await env.SUBS.get(key); if (!raw) return;
  const rec = JSON.parse(raw);
  const now = localNow(rec.tz);
  rec.sent = rec.sent || {};
  for (const t of rec.times) {
    const [hh, mm] = t.split(':').map(Number), tm = hh * 60 + mm;
    if (now.min < tm || now.min >= tm + 15 || rec.sent[t] === now.day) continue;
    const left = rec.day === now.day ? rec.left : null;
    if (left === 0) continue;
    const th = LINES[rec.theme] ? rec.theme : 'base';
    let body;
    if (left == null) body = NOTHING[th];
    else { const lines = LINES[th]; body = lines[(tm / 15 | 0) % lines.length].replace('{n}', left + ' ' + plural(left, 'cieľ', 'ciele', 'cieľov')); }
    if (rec.name) body = rec.name + ', ' + body.charAt(0).toLowerCase() + body.slice(1);
    const r = await sendPush(env, rec.sub, { title: 'Personal reminder', body });
    if (r.status === 404 || r.status === 410) { await env.SUBS.delete(key); return; }
    rec.sent[t] = now.day;
    await env.SUBS.put(key, JSON.stringify(rec));
    return;
  }
}

// ---------- Web Push (RFC 8291 + VAPID RFC 8292) ----------
const enc = new TextEncoder();
function b64uToBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function bytesToB64u(b) { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function concat(...arrs) { const n = arrs.reduce((a, x) => a + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; }
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function vapidJWT(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: VAPID_X, y: VAPID_Y, d: env.VAPID_PRIVATE, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + payload));
  return header + '.' + payload + '.' + bytesToB64u(sig);
}
export async function encryptPayload(sub, text) {
  const uaPub = b64uToBytes(sub.keys.p256dh), auth = b64uToBytes(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function sendPush(env, sub, msg) {
  const body = await encryptPayload(sub, JSON.stringify(msg));
  const jwt = await vapidJWT(env, sub.endpoint);
  return fetch(sub.endpoint, { method: 'POST', body, headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'normal', Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC}` } });
}
