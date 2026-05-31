'use strict';

const crypto = require('crypto');

// Alfabeto sin caracteres ambiguos (0/O, 1/I/L) para codigos faciles de dictar.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Solo letras, sin las ambiguas I, L y O.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

function randomChars(alphabet, length) {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function randomCode(length = 6) {
  return randomChars(CODE_ALPHABET, length);
}

// Codigo de acceso del socio: 3 digitos tomados de su numero de accion + 3
// letras al azar (ej. accion "042" -> "042KMQ"). Asi el socio reconoce su
// numero dentro del codigo. Reglas para los 3 digitos:
//   - si el numero tiene 3 o mas digitos, se usan los ultimos 3;
//   - si tiene menos, se rellena con ceros a la izquierda (ej. "42" -> "042");
//   - si no tiene ningun digito, se usan 3 digitos al azar.
function memberCode(shareNumber) {
  const digits = String(shareNumber == null ? '' : shareNumber).replace(/\D/g, '');
  let prefix;
  if (digits.length >= 3) prefix = digits.slice(-3);
  else if (digits.length > 0) prefix = digits.padStart(3, '0');
  else prefix = randomChars('0123456789', 3);
  return prefix + randomChars(CODE_LETTERS, 3);
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

module.exports = { randomCode, memberCode, formatKickoff, formatDateTime, parseScore };
