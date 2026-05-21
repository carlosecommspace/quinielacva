'use strict';

const { Pool } = require('pg');

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

// Emparejamiento round-robin para 4 equipos (slots 1-4): 6 partidos, 3 jornadas.
const PAIRINGS = [
  [1, 2, 1],
  [3, 4, 1],
  [1, 3, 2],
  [2, 4, 2],
  [1, 4, 3],
  [2, 3, 3],
];

const MATCHDAY_DATE = {
  1: '2026-06-12T16:00',
  2: '2026-06-18T16:00',
  3: '2026-06-24T16:00',
};

async function seedTournament() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM teams');
  if (rows[0].n > 0) return; // ya sembrado, no tocar nada

  const groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  let matchNo = 0;

  // La siembra corre en una transaccion: si un deploy se interrumpe a la mitad,
  // se revierte por completo y el siguiente arranque la vuelve a intentar.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const g of groups) {
      const teamIds = {};
      for (let slot = 1; slot <= 4; slot++) {
        const res = await client.query(
          'INSERT INTO teams (group_name, slot, name) VALUES ($1, $2, $3) RETURNING id',
          [g, slot, `Equipo ${g}${slot}`]
        );
        teamIds[slot] = res.rows[0].id;
      }
      for (const [homeSlot, awaySlot, matchday] of PAIRINGS) {
        matchNo += 1;
        await client.query(
          `INSERT INTO matches (match_no, group_name, matchday, home_team_id, away_team_id, kickoff)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [matchNo, g, matchday, teamIds[homeSlot], teamIds[awaySlot], MATCHDAY_DATE[matchday]]
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
  console.log(`[db] Torneo sembrado: ${groups.length} grupos, ${matchNo} partidos.`);
}

async function init() {
  await migrate();
  await seedSettings();
  await seedTournament();
  console.log('[db] Base de datos lista.');
}

module.exports = { pool, query, init };
