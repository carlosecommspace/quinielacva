'use strict';

const { query, pool } = require('./db');

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

async function getPredictions(memberId) {
  const { rows } = await query(
    'SELECT match_id, home_score, away_score FROM predictions WHERE member_id = $1',
    [memberId]
  );
  const map = new Map();
  for (const r of rows) map.set(r.match_id, r);
  return map;
}

async function getAllPredictions() {
  const { rows } = await query(
    'SELECT member_id, match_id, home_score, away_score FROM predictions'
  );
  return rows;
}

// entries: [{ matchId, home, away }]. Si home o away es null se borra el pronostico.
async function savePredictions(memberId, entries) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      if (e.home === null || e.away === null) {
        await client.query(
          'DELETE FROM predictions WHERE member_id = $1 AND match_id = $2',
          [memberId, e.matchId]
        );
      } else {
        await client.query(
          `INSERT INTO predictions (member_id, match_id, home_score, away_score, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (member_id, match_id)
           DO UPDATE SET home_score = $3, away_score = $4, updated_at = now()`,
          [memberId, e.matchId, e.home, e.away]
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
  getPredictions,
  getAllPredictions,
  savePredictions,
  markFirstAccess,
  recordAudit,
  getAuditLog,
};
