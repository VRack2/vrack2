#!/usr/bin/env node
/**
 * VRack2 — пример клиента: авторизация + получение списка сервисов.
 *
 * Это канонический минимальный клиент. Он работает в обоих режимах:
 *   • обычный ключ (без шифрования)  — например `default`;
 *   • ключ с шифрованием (ECDH, P-256) — современный безопасный режим.
 *
 * Как отличить режим: решает ответ `apiKeyAuth`.
 *   • нет поля `verify`        -> обычный ключ, дальше обычный JSON;
 *   • есть `verify` + `serverPub` -> ECDH-ключ: делаем proof (apiPrivateAuth),
 *                                    дальше все сообщения — GCM-кадры.
 *
 * Использование:
 *   # обычный ключ (локальная разработка)
 *   node docs/vrack2-client.mjs --key default
 *
 *   # ECDH-ключ: нужен ключ (KID) и ваш приватный ключ (PEM, получен один раз
 *   # при создании ключа через apiKeyAdd; на сервере хранится только публичный)
 *   node docs/vrack2-client.mjs --key <KID> --private "$(cat client.key.pem)"
 *
 * Параметры (флаги или переменные окружения):
 *   --url / VRACK2_URL      адрес мастера, по умолчанию ws://localhost:4404
 *   --key / VRACK2_KEY      KID (идентификатор ключа), по умолчанию `default`
 *   --private / VRACK2_PRIVATE  приватный ключ PEM (только для ECDH-ключей)
 *   --command / --data       любая команда вместо `serviceList` и её data (JSON)
 *
 * Только встроенные модули Node.js (>= 20, нужен глобальный WebSocket).
 * Обмен последовательный: отправили запрос — ждём следующий ответ (WebSocket упорядочен).
 */
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Аргументы
// ---------------------------------------------------------------------------
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const URL_   = arg('url', process.env.VRACK2_URL || 'ws://localhost:4404');
const KEY    = arg('key', process.env.VRACK2_KEY || 'default');
const PRIVATE = arg('private', process.env.VRACK2_PRIVATE || '');
const COMMAND = arg('command', 'serviceList');
const DATA    = arg('data', '{}');

// ---------------------------------------------------------------------------
// Криптография (те же правила, что и в сервере Guard)
// ---------------------------------------------------------------------------

/** AAD «приклеивает» кадр к сессии: clientId, счётчик seq, направление, вызов. */
function buildAAD(clientId, seq, dir, session) {
  return Buffer.from(JSON.stringify({ c: clientId, s: seq, d: dir, v: session }), 'utf8');
}

/** Шифрует payload -> кадр base64url(nonce ‖ ciphertext ‖ tag), AES-256-GCM. */
function encryptFrame(payload, ek, clientId, seq, dir, session) {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ek, nonce, { authTagLength: 16 });
  c.setAAD(buildAAD(clientId, seq, dir, session));
  const ct = Buffer.concat([c.update(payload, 'utf8'), c.final()]);
  return Buffer.concat([nonce, ct, c.getAuthTag()]).toString('base64url');
}

/** Расшифровывает кадр -> payload. Бросает при неверном tag/AAD/seq. */
function decryptFrame(frame, ek, clientId, seq, dir, session) {
  const raw = Buffer.from(frame, 'base64url');
  const nonce = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(12, raw.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', ek, nonce, { authTagLength: 16 });
  d.setAAD(buildAAD(clientId, seq, dir, session));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/** Ключ канала из ECDH-общего секрета: HKDF-SHA256. Совпадает с сервером. */
function deriveEk(serverPub, clientPrivPem) {
  const shared = crypto.diffieHellman({
    privateKey: crypto.createPrivateKey(clientPrivPem),
    publicKey: crypto.createPublicKey(serverPub),
  });
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('vrack2/v2/ek', 'utf8'), 32));
}

// ---------------------------------------------------------------------------
// WebSocket: последовательный обмен «отправил -> следующий ответ»
// ---------------------------------------------------------------------------
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const st = { ws, inbox: [], waiters: [] };
    ws.onopen = () => resolve(st);
    ws.onerror = (e) => reject(new Error('WebSocket error: ' + (e.message || e)));
    ws.onmessage = (e) => {
      const t = e.data.toString('utf8');
      if (st.waiters.length) st.waiters.shift()(t); else st.inbox.push(t);
    };
    st.send = (txt, timeout = 8000) => new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('timeout: ' + txt.slice(0, 40))); } }, timeout);
      const deliver = (t) => { if (!done) { done = true; clearTimeout(timer); resolve(t); } };
      if (st.inbox.length) deliver(st.inbox.shift());
      else st.waiters.push(deliver);
      ws.send(txt);
    });
    st.close = () => ws.close();
  });
}

// ---------------------------------------------------------------------------
// Авторизация
// ---------------------------------------------------------------------------
let pkg = 0; // счётчик _pkgIndex для сервера (корреляция на клиенте не нужна — обмен последовательный)
async function authorize(st, key, privatePem) {
  const resp = JSON.parse(await st.send(JSON.stringify({ command: 'apiKeyAuth', _pkgIndex: ++pkg, data: { key } })));
  if (resp.result !== 'success') throw new Error('apiKeyAuth failed: ' + JSON.stringify(resp.resultData));
  const rd = resp.resultData || {};
  const state = { clientId: resp.clientId, level: rd.level, cipher: !!rd.cipher, reqSeq: 1, resSeq: 1 };

  if (!rd.verify) return state; // обычный ключ — канал уже готов

  // ECDH: общий секрет -> ключ канала
  if (!privatePem) throw new Error('ключ требует шифрования (verify), но не передан приватный ключ (--private)');
  state.ek = deriveEk(rd.serverPub, privatePem);
  state.session = rd.verify;

  // proof: шифруем вызов сервера в первом кадре (req seq = 1)
  const frame = encryptFrame(rd.verify, state.ek, state.clientId, 1, 'req', state.session);
  const proof = JSON.parse(await st.send(JSON.stringify({ command: 'apiPrivateAuth', _pkgIndex: ++pkg, data: { frame } })));
  if (proof.result !== 'success') throw new Error('apiPrivateAuth failed: ' + JSON.stringify(proof.resultData));

  state.cipher = true;
  state.level = proof.resultData.level; // для ECDH-ключа level приходит в ответе proof
  state.reqSeq = 2;  // proof был первым исходящим; следующий запрос = 2
  state.resSeq = 1;  // первый ответ придёт с seq 1
  return state;
}

/** Выполняет команду и возвращает resultData. Автоматически шифрует/расшифровывает. */
async function call(st, state, command, data) {
  let sent;
  if (state.cipher) {
    sent = encryptFrame(JSON.stringify({ command, _pkgIndex: ++pkg, data }), state.ek, state.clientId, state.reqSeq, 'req', state.session);
  } else {
    sent = JSON.stringify({ command, _pkgIndex: ++pkg, data });
  }
  const rawResp = await st.send(sent);
  const resp = state.cipher
    ? JSON.parse(decryptFrame(rawResp, state.ek, state.clientId, state.resSeq, 'res', state.session))
    : JSON.parse(rawResp);
  if (state.cipher) { state.reqSeq++; state.resSeq++; }
  if (resp.result !== 'success') throw new Error(`${command} failed: ${JSON.stringify(resp.resultData)}`);
  return resp.resultData;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const st = await connect(URL_);
const state = await authorize(st, KEY, PRIVATE);
console.log('authorized:', { level: state.level, cipher: state.cipher, clientId: state.clientId });

const result = await call(st, state, COMMAND, JSON.parse(DATA));
st.close();

if (COMMAND === 'serviceList') {
  const rows = Object.values(result);
  console.log(`\nСервисов: ${rows.length}`);
  for (const s of rows) {
    console.log(`  ${s.run ? '●' : '○'} ${s.id.padEnd(24)} ${s.name || ''}   (errors=${s.errors})`);
  }
} else {
  console.log('\nresultData:');
  console.log(JSON.stringify(result, null, 2));
}
