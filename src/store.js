'use strict';

const { query, pool } = require('./db');
const { memberCode } = require('./util');

async function getSettings() {
  const { rows } = await query('SELECT key, value FROM settings');
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    pointsOutcome: parseInt(map.points_outcome ?? '3', 10),
    pointsExact: parseInt(map.points_exact ?? '5', 10),
    predictionsLocked: map.predictions_locked === '1',
    deadlineText: map.deadline_text ?? '',
  };
}

async function setSetting(key, value) {
  await query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [key, String(value)]
  );
}

async function getTeams() {
  const { rows } = await query(
    'SELECT id, group_name, slot, name FROM teams ORDER BY group_name, slot'
  );
  return rows;
}

async function getMatches() {
  const { rows } = await query(`
    SELECT m.id, m.match_no, m.group_name, m.matchday, m.kickoff,
           m.home_score, m.away_score,
           m.home_team_id, m.away_team_id,
           ht.name AS home_name, at.name AS away_name
    FROM matches m
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    ORDER BY m.group_name, m.matchday, m.match_no
  `);
  return rows;
}

// Estructura agrupada para las vistas: un arreglo de grupos con sus equipos y partidos.
async function getGroups() {
  const teams = await getTeams();
  const matches = await getMatches();
  const groupMap = new Map();
  for (const t of teams) {
    if (!groupMap.has(t.group_name)) {
      groupMap.set(t.group_name, { name: t.group_name, teams: [], matches: [] });
    }
    groupMap.get(t.group_name).teams.push(t);
  }
  for (const m of matches) {
    const g = groupMap.get(m.group_name);
    if (g) g.matches.push(m);
  }
  return [...groupMap.values()];
}

async function getMembers() {
  const { rows } = await query(
    'SELECT id, first_name, last_name, share_number, code, first_access_at, created_at FROM members ORDER BY last_name, first_name'
  );
  return rows;
}

async function getMember(id) {
  const { rows } = await query('SELECT * FROM members WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getMemberByCode(code) {
  const { rows } = await query('SELECT * FROM members WHERE code = $1', [code]);
  return rows[0] || null;
}

// Busca un socio existente por numero de accion + nombre + apellido (sin
// distinguir mayusculas). Se usa en el alta publica para reusar el mismo socio
// (y su codigo) cuando vuelve a cargar otra quiniela.
async function findMember(shareNumber, firstName, lastName) {
  const { rows } = await query(
    `SELECT * FROM members
     WHERE share_number = $1
       AND lower(first_name) = lower($2)
       AND lower(last_name)  = lower($3)
     ORDER BY id LIMIT 1`,
    [shareNumber, firstName, lastName]
  );
  return rows[0] || null;
}

// Crea un socio generando un codigo de acceso unico (reintenta ante colisiones).
// Devuelve la fila creada o null si no se logro un codigo unico.
async function createMember(firstName, lastName, shareNumber) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = memberCode(shareNumber);
    try {
      const { rows } = await query(
        `INSERT INTO members (first_name, last_name, share_number, code)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [firstName, lastName, shareNumber, code]
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') continue; // colision de codigo, reintentar
      throw err;
    }
  }
  return null;
}

// --- Quinielas ---
async function getMemberQuinielas(memberId) {
  const { rows } = await query(
    'SELECT id, member_id, label, paid, paid_at, created_at FROM quinielas WHERE member_id = $1 ORDER BY id',
    [memberId]
  );
  return rows;
}

async function getQuiniela(id) {
  const { rows } = await query(
    `SELECT q.id, q.member_id, q.label, q.paid, q.paid_at, q.created_at,
            m.first_name, m.last_name, m.share_number, m.code
     FROM quinielas q JOIN members m ON m.id = q.member_id
     WHERE q.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getAllQuinielas() {
  const { rows } = await query(
    `SELECT q.id, q.member_id, q.label, q.paid, q.paid_at, q.created_at,
            m.first_name, m.last_name, m.share_number, m.code
     FROM quinielas q JOIN members m ON m.id = q.member_id
     ORDER BY q.paid ASC, q.created_at DESC, q.id DESC`
  );
  return rows;
}

async function getPaidQuinielas() {
  const { rows } = await query(
    `SELECT q.id, q.member_id, q.label,
            m.first_name, m.last_name, m.share_number
     FROM quinielas q JOIN members m ON m.id = q.member_id
     WHERE q.paid = TRUE`
  );
  return rows;
}

async function createQuiniela(memberId, label) {
  const { rows } = await query(
    'INSERT INTO quinielas (member_id, label, paid) VALUES ($1, $2, FALSE) RETURNING *',
    [memberId, label]
  );
  return rows[0];
}

async function setQuinielaPaid(id, paid) {
  await query(
    'UPDATE quinielas SET paid = $1, paid_at = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2',
    [paid, id]
  );
}

async function deleteQuiniela(id) {
  await query('DELETE FROM quinielas WHERE id = $1', [id]);
}

function nextQuinielaLabel(count) {
  return `Quiniela ${count + 1}`;
}

async function getQuinielaCountsByMember() {
  const { rows } = await query(
    `SELECT member_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE paid)::int AS paid
     FROM quinielas GROUP BY member_id`
  );
  const map = new Map();
  for (const r of rows) map.set(r.member_id, { total: r.total, paid: r.paid });
  return map;
}

async function getQuinielaSummary() {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE paid)::int AS paid FROM quinielas'
  );
  return rows[0] || { total: 0, paid: 0 };
}

async function getPredictionCountsByQuiniela() {
  const { rows } = await query(
    'SELECT quiniela_id, COUNT(*)::int AS n FROM predictions GROUP BY quiniela_id'
  );
  const map = new Map();
  for (const r of rows) map.set(r.quiniela_id, r.n);
  return map;
}

// --- Pronosticos (por quiniela) ---
async function getPredictions(quinielaId) {
  const { rows } = await query(
    'SELECT match_id, home_score, away_score FROM predictions WHERE quiniela_id = $1',
    [quinielaId]
  );
  const map = new Map();
  for (const r of rows) map.set(r.match_id, r);
  return map;
}

async function getAllPredictions() {
  const { rows } = await query(
    'SELECT quiniela_id, match_id, home_score, away_score FROM predictions'
  );
  return rows;
}

// entries: [{ matchId, home, away }]. Si home o away es null se borra el pronostico.
async function savePredictions(quinielaId, entries) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      if (e.home === null || e.away === null) {
        await client.query(
          'DELETE FROM predictions WHERE quiniela_id = $1 AND match_id = $2',
          [quinielaId, e.matchId]
        );
      } else {
        await client.query(
          `INSERT INTO predictions (quiniela_id, match_id, home_score, away_score, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (quiniela_id, match_id)
           DO UPDATE SET home_score = $3, away_score = $4, updated_at = now()`,
          [quinielaId, e.matchId, e.home, e.away]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function markFirstAccess(memberId) {
  await query(
    'UPDATE members SET first_access_at = COALESCE(first_access_at, now()) WHERE id = $1',
    [memberId]
  );
}

async function recordAudit(entry) {
  const {
    actor,
    actorMemberId = null,
    targetMemberId = null,
    targetName = null,
    action,
    savedCount = null,
    ip = null,
  } = entry;
  await query(
    `INSERT INTO audit_log (actor, actor_member_id, target_member_id, target_name, action, saved_count, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actor, actorMemberId, targetMemberId, targetName, action, savedCount, ip]
  );
}

async function getAuditLog(limit = 200) {
  const { rows } = await query(
    `SELECT id, created_at, actor, actor_member_id, target_member_id, target_name,
            action, saved_count, ip
     FROM audit_log
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = {
  getSettings,
  setSetting,
  getTeams,
  getMatches,
  getGroups,
  getMembers,
  getMember,
  getMemberByCode,
  findMember,
  createMember,
  getMemberQuinielas,
  getQuiniela,
  getAllQuinielas,
  getPaidQuinielas,
  createQuiniela,
  setQuinielaPaid,
  deleteQuiniela,
  nextQuinielaLabel,
  getQuinielaCountsByMember,
  getQuinielaSummary,
  getPredictionCountsByQuiniela,
  getPredictions,
  getAllPredictions,
  savePredictions,
  markFirstAccess,
  recordAudit,
  getAuditLog,
};
