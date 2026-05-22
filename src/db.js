'use strict';

const { Pool } = require('pg');
const { GROUPS, FIXTURES } = require('./fixture');

if (!process.env.DATABASE_URL) {
  console.error('[db] Falta la variable DATABASE_URL. Configura tu conexion a PostgreSQL.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

function query(text, params) {
  return pool.query(text, params);
}

// Las migraciones usan CREATE TABLE IF NOT EXISTS y la semilla solo inserta
// cuando las tablas estan vacias. De este modo ningun deploy borra datos.
async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS teams (
      id         SERIAL PRIMARY KEY,
      group_name TEXT NOT NULL,
      slot       INT  NOT NULL,
      name       TEXT NOT NULL
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS matches (
      id           SERIAL PRIMARY KEY,
      match_no     INT  NOT NULL,
      group_name   TEXT NOT NULL,
      matchday     INT  NOT NULL,
      home_team_id INT  NOT NULL REFERENCES teams(id),
      away_team_id INT  NOT NULL REFERENCES teams(id),
      kickoff      TEXT,
      home_score   INT,
      away_score   INT
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS members (
      id              SERIAL PRIMARY KEY,
      first_name      TEXT NOT NULL,
      last_name       TEXT NOT NULL,
      share_number    TEXT NOT NULL,
      code            TEXT NOT NULL UNIQUE,
      first_access_at TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS predictions (
      id         SERIAL PRIMARY KEY,
      member_id  INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      match_id   INT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      home_score INT NOT NULL,
      away_score INT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (member_id, match_id)
    );
  `);
}

const DEFAULT_SETTINGS = {
  points_outcome: '3',
  points_exact: '5',
  predictions_locked: '0',
  deadline_text: '',
};

async function seedSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
  }
}

async function seedTournament() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM teams');
  if (rows[0].n > 0) return; // ya sembrado, no tocar nada

  // La siembra corre en una transaccion: si un deploy se interrumpe a la mitad,
  // se revierte por completo y el siguiente arranque la vuelve a intentar.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const teamId = {};
    for (const [group, names] of Object.entries(GROUPS)) {
      for (let slot = 1; slot <= 4; slot++) {
        const res = await client.query(
          'INSERT INTO teams (group_name, slot, name) VALUES ($1, $2, $3) RETURNING id',
          [group, slot, names[slot - 1]]
        );
        teamId[`${group}${slot}`] = res.rows[0].id;
      }
    }
    for (const [matchNo, group, homeSlot, awaySlot, matchday, kickoff] of FIXTURES) {
      await client.query(
        `INSERT INTO matches (match_no, group_name, matchday, home_team_id, away_team_id, kickoff)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [matchNo, group, matchday, teamId[`${group}${homeSlot}`], teamId[`${group}${awaySlot}`], kickoff]
      );
    }
    await client.query(
      `INSERT INTO settings (key, value) VALUES ('official_fixture_loaded', '1')
       ON CONFLICT (key) DO UPDATE SET value = '1'`
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  console.log(`[db] Torneo sembrado con el calendario oficial del Mundial 2026 (${FIXTURES.length} partidos).`);
}

// Actualiza una base ya sembrada al calendario oficial: nombres de equipos,
// emparejamientos, jornadas y fechas. Corre una sola vez, protegida por una
// bandera en settings. No toca socios, pronosticos ni resultados ya cargados.
async function applyOfficialFixture() {
  const flag = await query("SELECT value FROM settings WHERE key = 'official_fixture_loaded'");
  if (flag.rows[0] && flag.rows[0].value === '1') return;

  const count = await query('SELECT COUNT(*)::int AS n FROM teams');
  if (count.rows[0].n === 0) return; // base vacia: seedTournament se encarga

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [group, names] of Object.entries(GROUPS)) {
      for (let slot = 1; slot <= 4; slot++) {
        await client.query(
          'UPDATE teams SET name = $1 WHERE group_name = $2 AND slot = $3',
          [names[slot - 1], group, slot]
        );
      }
    }
    const teams = await client.query('SELECT id, group_name, slot FROM teams');
    const teamId = {};
    for (const t of teams.rows) teamId[`${t.group_name}${t.slot}`] = t.id;

    for (const [matchNo, group, homeSlot, awaySlot, matchday, kickoff] of FIXTURES) {
      await client.query(
        `UPDATE matches
         SET group_name = $1, matchday = $2, home_team_id = $3, away_team_id = $4, kickoff = $5
         WHERE match_no = $6`,
        [group, matchday, teamId[`${group}${homeSlot}`], teamId[`${group}${awaySlot}`], kickoff, matchNo]
      );
    }
    await client.query(
      `INSERT INTO settings (key, value) VALUES ('official_fixture_loaded', '1')
       ON CONFLICT (key) DO UPDATE SET value = '1'`
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  console.log('[db] Calendario oficial del Mundial 2026 aplicado a la base existente.');
}

async function init() {
  await migrate();
  await seedSettings();
  await seedTournament();
  await applyOfficialFixture();
  console.log('[db] Base de datos lista.');
}

module.exports = { pool, query, init };
