'use strict';
/**
 * Yandex Cloud Function: сохраняет данные потока из админки в Object Storage.
 *
 * Админка шлёт POST с телом {"password": "...", "data": {...}} и
 * Content-Type: text/plain — это «простой» CORS-запрос, без preflight.
 * Функция проверяет пароль и пишет live/data.json (его читает дашборд)
 * плюс копию в live/history/ — страховка от неудачного сохранения.
 *
 * Пишет от имени привязанного сервисного аккаунта: IAM-токен из context,
 * заголовок X-YaCloud-SubjectToken. Ключей и SDK не нужно.
 */

const BUCKET = process.env.BUCKET;
const PASSWORD = process.env.ADMIN_PASSWORD;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const STORAGE = 'https://storage.yandexcloud.net';
const MAX_BYTES = 1024 * 1024;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function reply(statusCode, payload, origin) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
    body: JSON.stringify(payload)
  };
}

function isCohort(d) {
  return d && typeof d.cohort === 'string' && typeof d.startDate === 'string' &&
    Array.isArray(d.students) && Array.isArray(d.weeks) &&
    d.checkins && typeof d.checkins === 'object' && !Array.isArray(d.checkins);
}

async function putObject(key, body, token) {
  const res = await fetch(`${STORAGE}/${BUCKET}/${key}`, {
    method: 'PUT',
    headers: {
      'X-YaCloud-SubjectToken': token,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache'
    },
    body
  });
  if (!res.ok) throw new Error(`PUT ${key}: ${res.status} ${await res.text()}`);
}

module.exports.handler = async (event, context) => {
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) headers[k.toLowerCase()] = v;
  const origin = headers.origin || '';

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' }, origin);

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (Buffer.byteLength(raw) > MAX_BYTES) return reply(413, { error: 'Too large' }, origin);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return reply(400, { error: 'Invalid JSON' }, origin);
  }
  if (!PASSWORD || !payload || payload.password !== PASSWORD) return reply(403, { error: 'Forbidden' }, origin);
  if (!isCohort(payload.data)) return reply(400, { error: 'Not a cohort document' }, origin);

  const body = JSON.stringify(payload.data);
  const token = context.token && context.token.access_token;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    await putObject(`live/history/${stamp}.json`, body, token);
    await putObject('live/data.json', body, token);
  } catch (error) {
    console.error(error.message);
    return reply(502, { error: 'Storage write failed' }, origin);
  }
  return reply(200, { success: true }, origin);
};
