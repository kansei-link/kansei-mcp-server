/**
 * Reading predicate v1 helpers: ULID generation and a small JSON-Schema
 * validator that covers exactly the subset used by reading.v1.schema.json
 * (type, enum, pattern, minLength/maxLength, required, properties,
 * additionalProperties:false, items, oneOf). No external dependency.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(__dir, '..', 'schemas', 'reading.v1.schema.json');
export const STAGES = ['discover', 'understand', 'connect', 'execute', 'done'];

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 48-bit ms timestamp + 80-bit randomness, Crockford base32, 26 chars. */
export function newUlid(now = Date.now()) {
  let t = now;
  let timePart = '';
  for (let i = 0; i < 10; i++) { timePart = CROCKFORD[t % 32] + timePart; t = Math.floor(t / 32); }
  const rnd = randomBytes(10);
  // 80 bits -> 16 chars of 5 bits
  let bits = 0n;
  for (const b of rnd) bits = (bits << 8n) | BigInt(b);
  let randPart = '';
  for (let i = 0; i < 16; i++) { randPart = CROCKFORD[Number(bits & 31n)] + randPart; bits >>= 5n; }
  return timePart + randPart;
}

export function loadReadingSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function check(value, schema, path, errors) {
  if (schema.oneOf) {
    const sub = schema.oneOf.map((s) => { const e = []; check(value, s, path, e); return e; });
    if (!sub.some((e) => e.length === 0)) errors.push(`${path}: matches none of oneOf`);
    return;
  }
  if (schema.type) {
    const t = typeOf(value);
    const want = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!want.includes(t) && !(t === 'number' && want.includes('integer') && Number.isInteger(value))) {
      errors.push(`${path}: expected ${want.join('|')}, got ${t}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not in enum`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern mismatch`);
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (typeOf(value) === 'object') {
    for (const r of schema.required || []) if (!(r in value)) errors.push(`${path}: missing ${r}`);
    for (const [k, v] of Object.entries(value)) {
      const ps = schema.properties?.[k];
      if (ps) check(v, ps, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property ${k}`);
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((it, i) => check(it, schema.items, `${path}[${i}]`, errors));
}

/** Returns an array of error strings; empty means valid. */
export function validateReading(reading, schema = loadReadingSchema()) {
  const errors = [];
  check(reading, schema, '$', errors);
  // Cross-field rule from docs/READING-PREDICATE-v1.md §1: done <=> stage_stopped null
  if (reading && typeof reading === 'object') {
    if (reading.stage_reached === 'done' && reading.stage_stopped !== null) errors.push('$.stage_stopped: must be null when stage_reached is done');
    if (reading.stage_reached !== 'done' && reading.stage_stopped === null && reading.observed?.instrument_error == null) errors.push('$.stage_stopped: must name a stage when stage_reached is not done');
    if (reading.stage_stopped && STAGES.indexOf(reading.stage_stopped) > STAGES.indexOf(reading.stage_reached)) errors.push('$.stage_stopped: cannot be beyond stage_reached');
  }
  return errors;
}

/** ISO 8601 with the machine's local UTC offset (e.g. +09:00). */
export function isoWithOffset(d = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** SQLite 'datetime(now)' style UTC string for outcomes.created_at. */
export function sqliteUtc(d = new Date()) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
