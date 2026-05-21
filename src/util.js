'use strict';

const crypto = require('crypto');

// Alfabeto sin caracteres ambiguos (0/O, 1/I/L) para codigos faciles de dictar.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length = 6) {
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// kickoff se guarda como texto 'YYYY-MM-DDTHH:MM'.
function formatKickoff(value) {
  if (!value) return 'Por definir';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return value;
  const [, y, mo, d, h, mi] = m;
  const mes = MESES[parseInt(mo, 10) - 1] || mo;
  return `${parseInt(d, 10)} ${mes} ${y} · ${h}:${mi}`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const d = date.getDate();
  const mes = MESES[date.getMonth()];
  const y = date.getFullYear();
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${d} ${mes} ${y} · ${h}:${mi}`;
}

// Convierte un valor de formulario a entero de marcador valido (0-99) o null.
function parseScore(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  return n;
}

module.exports = { randomCode, formatKickoff, formatDateTime, parseScore };
