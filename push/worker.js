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
const TITLES = { spring: 'Jarný dvor', summer: 'Letný dvor', autumn: 'Jesenný dvor', winter: 'Zimný dvor', dawn: 'Dvor úsvitu', day: 'Denný dvor', night: 'Nočný dvor', base: 'Personal reminder' };
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
      const rec = { sub: b.sub, times: cleanTimes(b.times), tz: b.tz || 'Europe/Bratislava', theme: b.theme || 'base', name: (b.name || '').slice(0, 40), left: b.left ?? null, day: b.day || '', sent: {}, morning: cleanMorning(b.morning), target: cleanTarget(b.target), start: /^\d{4}-\d{2}-\d{2}$/.test(b.start || '') ? b.start : '' };
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
      if (b.morning !== undefined) rec.morning = cleanMorning(b.morning);
      if (b.target !== undefined) rec.target = cleanTarget(b.target);
      if (b.start !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(b.start || '')) rec.start = b.start;
      await env.SUBS.put(key, JSON.stringify(rec));
      return json({ ok: true });
    }
    if (url.pathname === '/unsubscribe') { await env.SUBS.delete(key); return json({ ok: true }); }
    if (url.pathname === '/test') {
      const r = await sendPush(env, rec.sub, { title: TITLES[rec.theme] || TITLES.base, body: b.kind === 'morning' ? morningBody(rec, localNow(rec.tz).day) : 'Upozornenia fungujú! Teraz ťa budem strážiť. Jemne. Väčšinou.' });
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
// ---------- Ranná správa ----------
const GREET = ['Dobré ránko', 'Krásne ráno', 'Ránko', 'Vstávať, vstávať', 'Nový deň je tu', 'Hellouky', 'Dobré ráno, slniečko', 'Ráno ťa víta'];
const MORNING = {
  spring: [
    'Tamlin už od rána krája koláč. Ty si odkroj kúsok dňa pre seba.',
    'Lucien ti drží dvere do nového dňa. Tváriť sa pritom bude kyslo, ale drží.',
    'Ruže kvitnú aj bez toho, aby to niekto videl. Ty dnes tiež.',
    'Jarný dvor je o novom začiatku. A dnešok je presne taký.',
    'Alis by povedala: menej rečí, viac roboty. A potom by ti priniesla čaj.',
    'Dnes stačí jeden malý krok. Jar tiež nepríde naraz.',
    'Zatiaľ si na začiatku cesty. Každá cesta sa ale meria krokmi, nie dvormi.',
    'Feyre tu začínala tiež. Vieš, kde skončila.',
    'Dnes to zvládneš. Tamlin síce nie vždy, ale ty áno.',
    'Kvety sa nepýtajú, či sa im chce. Proste rastú. Skús to tiež.'
  ],
  summer: [
    'Tarquin ti požičia trochu morskej pokojnosti. Vráť ju večer s úsmevom.',
    'Adriata sa leskne a ty dnes tiež. Aspoň trochu.',
    'Voda si vždy nájde cestu. Ty si nájdeš čas na svoje ciele.',
    'Letný dvor hlási: slnko je hore, tak hor sa aj ty.',
    'Dnes si urob deň ako more: pokojná navrchu, silná vo vnútri.',
    'Cresseida by sa dnes prechádzala po pláži. Ty si zatiaľ odškrtni vodu.',
    'Perly vznikajú pomaly. Návyky tiež. Dnes pridáš ďalšiu vrstvu.',
    'Dnes to zvládneš. Tarquin to vie, len to nepovie nahlas.',
    'Vlny sa vracajú každý deň. Ty tiež, a to je celé tajomstvo.',
    'Na Letnom dvore sa nikto neponáhľa, no všetko sa stihne. Dnes aj u teba.'
  ],
  autumn: [
    'Beron by ťa dnes podcenil. Tak mu to ukáž.',
    'Lucienovi bratia sú hluční. Ty buď dnes potichu, ale neúprosne.',
    'Jeseň vie, že pustiť niečo je tiež sila. Pusti dnes výhovorky.',
    'Lístky padajú, ale ty dnes vstaň a choď.',
    'Plamene Jesenného dvora horia aj v zime. Tvoja motivácia dnes tiež.',
    'Dnes to zvládneš. Lucien by ti dokonca pochválil plán.',
    'Aj najkrajšie farby prichádzajú postupne. Ako tvoje výsledky.',
    'Jesenný dvor má hrdosť. Daj si dnes dôvod byť na seba hrdá.',
    'Oheň sa musí kŕmiť každý deň. Tvoje návyky tiež.',
    'Dnes stačí malá iskra. Zvyšok sa rozhorí sám.'
  ],
  winter: [
    'Kallias ti posiela horúci čaj a tichý pokoj. Využi oboje.',
    'Viviane by ťa dnes vytiahla von na čerstvý vzduch. Skús to.',
    'Sneh padá po vločkách. Aj veľké zmeny prichádzajú po kúskoch.',
    'Zimný dvor vie, že aj chladné rána sa dajú zvládnuť. A ty tiež.',
    'Dnes to zvládneš. Kallias by na to vsadil celú svoju zbierku kožuchov.',
    'Ľad je pevný, lebo mrzne pomaly. Rovnako pevná bude tvoja disciplína.',
    'Zabaľ sa do deky aj do odhodlania. Dnes oboje treba.',
    'Na Zimnom dvore sa oslavuje každé svetlo. Aj tvoj malý pokrok.',
    'Studené ráno, teplé srdce. Tak poďme na to.',
    'Dnes si urob deň, na ktorý budeš večer rada spomínať pri krbe.'
  ],
  dawn: [
    'Thesan ti posiela prvý lúč dňa. Je len tvoj.',
    'Úsvit nikdy nemešká. Dnes nemeškaj ani ty, aspoň s jedným cieľom.',
    'Každé ráno je malý nový začiatok. Toto tiež.',
    'Dvor úsvitu lieči. Dnes buď k sebe jemná, ale dôsledná.',
    'Dnes to zvládneš. Svetlo prichádza vždy, aj po najdlhšej noci.',
    'Obloha sa farbí pomaly. Tvoje výsledky tiež, ale už sa farbia.',
    'Thesan by povedal, že dnešok je šanca. Ja hovorím, že aj odškrtávací deň.',
    'Prvý lúč, prvý pohár vody, prvý malý úspech. Takto sa začína.',
    'Ráno patrí tým, ktorí ho chytia. Tak ho chyť.',
    'Svitá. A s tebou aj nový dobrý deň.'
  ],
  day: [
    'Helion už vyriešil tri hádanky. Ty vyrieš aspoň svoj prvý cieľ.',
    'Denný dvor miluje poznanie. Dnes sa niečo nauč, hoci aj o sebe.',
    'Slnko svieti naplno. Ty si zatiaľ zapni aspoň motiváciu.',
    'Dnes to zvládneš. Helion to vypočítal a vyšlo mu to.',
    'Knižnice Denného dvora sú plné múdrostí. Najlepšia je: proste začni.',
    'Svetlo odhalí všetko, aj výhovorky. Dnes ich nechaj doma.',
    'Helion by dnes urobil plán. Ty urob jeden krok.',
    'Jasný deň, jasná hlava, jasné ciele. Tak do toho.',
    'Na pravé poludnie by si mohla mať polovicu odškrtnutú. Len hovorím.',
    'Denný dvor vie, že aj slnko vychádza postupne. Nemusíš všetko naraz.'
  ],
  night: [
    'Rhys ti ráno posiela hviezdy. Že vraj sú pre tie, ktoré sa nevzdávajú.',
    'Cassian už je na výcvikovom ihrisku. Ty zatiaľ stačí vypiť vodu.',
    'Azriel sedí v tieni a pozoruje. Nechaj ho vidieť, ako to dnes zvládaš.',
    'Mor by ťa dnes vytiahla tancovať. Krok je krok, aj v obývačke.',
    'Amren by povedala, že výhovorky sú nudné. A ona nudu neznáša.',
    'Nesta tiež nezačínala s ľahkosťou. A pozri sa na ňu teraz.',
    'Velaris sa prebúdza. Ty tiež, a to je prvý splnený cieľ.',
    'Dnes to zvládneš. Rhys si je tým istý, a on sa nemýli často.',
    'Hviezdy v noci počúvali tvoje plány. Dnes ich čas premeniť na činy.',
    'Nočný dvor vie, že aj tma končí ránom. Tak vitaj v dnešku.',
    'Cassian by ťa dnes nenaháňal, len by sa uškŕňal. Daj mu dôvod.',
    'Feyre by dnes namaľovala niečo krásne. Ty si namaľuj dobrý deň.'
  ],
  base: [
    'Dnes to zvládneš. Krok za krokom.',
    'Nový deň, nová šanca. A ty ju využiješ.',
    'Netreba dokonalosť, stačí dnešok.',
    'Malé kroky každý deň porazia veľké plány raz za čas.',
    'Dnes stačí začať. Zvyšok príde.',
    'Si bližšie, ako si myslíš.',
    'Dnes si dopraj jeden malý úspech. Potom ďalší.',
    'Nemusí sa ti chcieť. Stačí začať.'
  ]
};
const TIPS = [
  'Tip na dnes: pohár vody hneď teraz.',
  'Tip na dnes: desať minút prechádzky na čerstvom vzduchu.',
  'Tip na dnes: obed bez mobilu.',
  'Tip na dnes: dnes večer o pol hodiny skôr do postele.',
  'Tip na dnes: päť minút naťahovania, kým sa varí káva.',
  'Tip na dnes: napíš si tri veci, za ktoré si vďačná.',
  'Tip na dnes: ku každému jedlu pohár vody.',
  'Tip na dnes: schody namiesto výťahu.',
  'Tip na dnes: hodina pred spaním bez obrazovky.',
  'Tip na dnes: začni najťažším cieľom, zvyšok pôjde ľahšie.',
  'Tip na dnes: priprav si oblečenie na cvičenie hneď ráno.',
  'Tip na dnes: zelenina ako prvá vec na tanieri.',
  'Tip na dnes: desať minút len pre seba, bez mobilu.',
  'Tip na dnes: pusti si obľúbenú pesničku a hýb sa.',
  'Tip na dnes: niečo sladké nahraď ovocím.',
  'Tip na dnes: zavolaj niekomu, koho máš rada.',
  'Tip na dnes: prečítaj si aspoň pár strán knihy.',
  'Tip na dnes: pri telefonovaní sa prechádzaj.',
  'Tip na dnes: odškrtni prvý cieľ ešte pred obedom.',
  'Tip na dnes: hlboký nádych pred každým jedlom.',
  'Tip na dnes: nalej si fľašu vody a maj ju na očiach.',
  'Tip na dnes: pochváľ sa za včerajšok, aj keby bol malý.'
];
function dayNum(day) { const [y, m, d] = day.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); }
function morningBody(rec, day) {
  const th = MORNING[rec.theme] ? rec.theme : 'base', n = dayNum(day), lines = MORNING[th];
  const g = GREET[n % GREET.length] + (rec.name ? ', ' + rec.name : '') + '!';
  let extra = '';
  if (n % 3 === 0) {
    const t = rec.target;
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) {
      const left = dayNum(t.date) - n;
      if (left > 0) extra = ' Do ' + (t.label || 'cieľa') + ' ' + (left === 1 ? 'ostáva už len 1 deň.' : 'ostáva ' + left + ' ' + plural(left, 'deň', 'dni', 'dní') + '.');
      else if (left === 0) extra = t.label === 'Vianoc' ? ' Dnes sú Vianoce!' : ' Dnes je ten deň!';
    }
    if (!extra && rec.start && /^\d{4}-\d{2}-\d{2}$/.test(rec.start)) { const d = n - dayNum(rec.start) + 1; if (d > 1) extra = ' Deň ' + d + ' vo výzve.'; }
  }
  const line = lines[(n * 7 + 3) % lines.length];
  const tip = n % 2 === 0 ? ' ' + TIPS[(n * 5) % TIPS.length] : '';
  return g + extra + ' ' + line + tip;
}

function cleanMorning(v) { return v === '' ? '' : (/^\d\d:\d\d$/.test(v || '') ? v : '07:45'); }
function cleanTarget(t) { return t && typeof t === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') ? { label: String(t.label || '').slice(0, 30), date: t.date } : null; }
async function checkOne(env, key) {
  const raw = await env.SUBS.get(key); if (!raw) return;
  const rec = JSON.parse(raw);
  const now = localNow(rec.tz);
  rec.sent = rec.sent || {};
  const mt = rec.morning === undefined ? '07:45' : rec.morning;
  if (mt) {
    const [mh, mm2] = mt.split(':').map(Number), mtm = mh * 60 + mm2;
    if (now.min >= mtm && now.min < mtm + 15 && rec.sent.morning !== now.day) {
      const th = TITLES[rec.theme] ? rec.theme : 'base';
      const r = await sendPush(env, rec.sub, { title: TITLES[th], body: morningBody(rec, now.day) });
      if (r.status === 404 || r.status === 410) { await env.SUBS.delete(key); return; }
      rec.sent.morning = now.day;
      await env.SUBS.put(key, JSON.stringify(rec));
      return;
    }
  }
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
    const r = await sendPush(env, rec.sub, { title: TITLES[th], body });
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
