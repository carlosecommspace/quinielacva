'use strict';

const express = require('express');
const router = express.Router();

const { query } = require('../db');
const store = require('../store');
const { randomCode, parseScore } = require('../util');
const { computeStandings, matchIsFinished, predictionPoints } = require('../scoring');

function adminPassword() {
  return process.env.ADMIN_PASSWORD || 'cva-admin-2026';
}

function flash(req, type, text) {
  req.session.flash = { type, text };
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.redirect('/admin');
  }
  res.locals.section = 'admin';
  next();
}

// --- Acceso administrador ---
router.get('/', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin/panel');
  }
  res.render('admin/login', { title: 'Administracion · Quiniela CVA', section: 'admin' });
});

router.post('/login', (req, res) => {
  const password = String(req.body.password || '');
  if (password && password === adminPassword()) {
    req.session.isAdmin = true;
    return res.redirect('/admin/panel');
  }
  res.render('admin/login', {
    title: 'Administracion · Quiniela CVA',
    section: 'admin',
    error: 'Contrasena incorrecta.',
  });
});

router.post('/salir', (req, res) => {
  req.session = null;
  res.redirect('/admin');
});

// --- Panel ---
router.get('/panel', requireAdmin, async (req, res) => {
  const [members, matches, settings] = await Promise.all([
    store.getMembers(),
    store.getMatches(),
    store.getSettings(),
  ]);
  res.render('admin/panel', {
    title: 'Panel · Quiniela CVA',
    section: 'admin',
    membersCount: members.length,
    matchesCount: matches.length,
    finishedCount: matches.filter(matchIsFinished).length,
    settings,
  });
});

// --- Socios ---
router.get('/socios', requireAdmin, async (req, res) => {
  const members = await store.getMembers();
  const predictions = await store.getAllPredictions();
  const predCount = new Map();
  for (const p of predictions) {
    predCount.set(p.member_id, (predCount.get(p.member_id) || 0) + 1);
  }
  res.render('admin/socios', {
    title: 'Socios · Quiniela CVA',
    section: 'admin',
    members,
    predCount,
    createdId: req.query.creado ? parseInt(req.query.creado, 10) : null,
  });
});

router.post('/socios', requireAdmin, async (req, res) => {
  const firstName = String(req.body.first_name || '').trim();
  const lastName = String(req.body.last_name || '').trim();
  const shareNumber = String(req.body.share_number || '').trim();

  if (!firstName || !lastName || !shareNumber) {
    flash(req, 'error', 'Nombre, apellido y numero de accion son obligatorios.');
    return res.redirect('/admin/socios');
  }

  let created = null;
  for (let attempt = 0; attempt < 12 && !created; attempt++) {
    const code = randomCode(6);
    try {
      const { rows } = await query(
        `INSERT INTO members (first_name, last_name, share_number, code)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [firstName, lastName, shareNumber, code]
      );
      created = rows[0];
    } catch (err) {
      if (err.code === '23505') continue; // colision de codigo, reintentar
      throw err;
    }
  }
  if (!created) {
    flash(req, 'error', 'No se pudo generar un codigo unico. Intenta de nuevo.');
    return res.redirect('/admin/socios');
  }
  flash(req, 'notice', `Socio creado: ${created.first_name} ${created.last_name}. Codigo de acceso: ${created.code}`);
  res.redirect(`/admin/socios?creado=${created.id}`);
});

router.post('/socios/:id/eliminar', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const member = await store.getMember(id);
  if (member) {
    await query('DELETE FROM members WHERE id = $1', [id]);
    flash(req, 'notice', `Socio eliminado: ${member.first_name} ${member.last_name}.`);
  }
  res.redirect('/admin/socios');
});

router.post('/socios/:id/codigo', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const member = await store.getMember(id);
  if (!member) return res.redirect('/admin/socios');
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomCode(6);
    try {
      await query('UPDATE members SET code = $1 WHERE id = $2', [code, id]);
      flash(req, 'notice', `Nuevo codigo para ${member.first_name} ${member.last_name}: ${code}`);
      break;
    } catch (err) {
      if (err.code === '23505') continue;
      throw err;
    }
  }
  res.redirect(`/admin/socios?creado=${id}`);
});

router.get('/socios/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const member = await store.getMember(id);
  if (!member) {
    flash(req, 'error', 'Socio no encontrado.');
    return res.redirect('/admin/socios');
  }
  const [groups, settings, predictions, matches] = await Promise.all([
    store.getGroups(),
    store.getSettings(),
    store.getPredictions(id),
    store.getMatches(),
  ]);

  let points = 0;
  for (const m of matches) {
    if (!matchIsFinished(m)) continue;
    const pred = predictions.get(m.id);
    if (!pred) continue;
    points += predictionPoints(pred, m, settings).points;
  }

  res.render('admin/socio', {
    title: `${member.first_name} ${member.last_name} · Quiniela CVA`,
    section: 'admin',
    member,
    groups,
    settings,
    predictions,
    points,
    editable: true,
  });
});

router.post('/socios/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const member = await store.getMember(id);
  if (!member) {
    flash(req, 'error', 'Socio no encontrado.');
    return res.redirect('/admin/socios');
  }
  const matches = await store.getMatches();
  const entries = matches.map((m) => ({
    matchId: m.id,
    home: parseScore(req.body[`h_${m.id}`]),
    away: parseScore(req.body[`a_${m.id}`]),
  }));
  await store.savePredictions(id, entries);
  flash(req, 'notice', `Quiniela actualizada para ${member.first_name} ${member.last_name}.`);
  res.redirect(`/admin/socios/${id}`);
});

// --- Partidos: equipos, fechas y resultados ---
router.get('/partidos', requireAdmin, async (req, res) => {
  const [groups, settings] = await Promise.all([store.getGroups(), store.getSettings()]);
  res.render('admin/partidos', {
    title: 'Partidos · Quiniela CVA',
    section: 'admin',
    groups,
    settings,
  });
});

router.post('/partidos', requireAdmin, async (req, res) => {
  const teams = await store.getTeams();
  const matches = await store.getMatches();

  for (const t of teams) {
    const name = String(req.body[`team_${t.id}`] || '').trim();
    if (name && name !== t.name) {
      await query('UPDATE teams SET name = $1 WHERE id = $2', [name, t.id]);
    }
  }

  for (const m of matches) {
    const kickoffRaw = String(req.body[`kickoff_${m.id}`] || '').trim();
    const kickoff = kickoffRaw || null;
    const home = parseScore(req.body[`hs_${m.id}`]);
    const away = parseScore(req.body[`as_${m.id}`]);
    await query(
      'UPDATE matches SET kickoff = $1, home_score = $2, away_score = $3 WHERE id = $4',
      [kickoff, home, away, m.id]
    );
  }

  flash(req, 'notice', 'Partidos actualizados (equipos, fechas y resultados).');
  res.redirect('/admin/partidos');
});

// --- Puntuacion y cierre ---
router.get('/puntuacion', requireAdmin, async (req, res) => {
  const settings = await store.getSettings();
  res.render('admin/puntuacion', {
    title: 'Puntuacion · Quiniela CVA',
    section: 'admin',
    settings,
  });
});

router.post('/puntuacion', requireAdmin, async (req, res) => {
  const outcome = parseInt(req.body.points_outcome, 10);
  const exact = parseInt(req.body.points_exact, 10);
  if (!Number.isInteger(outcome) || outcome < 0 || !Number.isInteger(exact) || exact < 0) {
    flash(req, 'error', 'Los puntajes deben ser numeros enteros mayores o iguales a cero.');
    return res.redirect('/admin/puntuacion');
  }
  await store.setSetting('points_outcome', outcome);
  await store.setSetting('points_exact', exact);
  flash(req, 'notice', 'Puntuacion actualizada.');
  res.redirect('/admin/puntuacion');
});

router.post('/cierre', requireAdmin, async (req, res) => {
  const locked = req.body.locked === '1';
  const deadlineText = String(req.body.deadline_text || '').trim();
  await store.setSetting('predictions_locked', locked ? '1' : '0');
  await store.setSetting('deadline_text', deadlineText);
  flash(
    req,
    'notice',
    locked ? 'Carga de pronosticos CERRADA.' : 'Carga de pronosticos ABIERTA.'
  );
  res.redirect('/admin/puntuacion');
});

// --- Posiciones ---
router.get('/posiciones', requireAdmin, async (req, res) => {
  const [members, matches, predictions, settings] = await Promise.all([
    store.getMembers(),
    store.getMatches(),
    store.getAllPredictions(),
    store.getSettings(),
  ]);
  const standings = computeStandings(members, matches, predictions, settings);
  res.render('admin/posiciones', {
    title: 'Posiciones · Quiniela CVA',
    section: 'admin',
    standings,
    settings,
  });
});

module.exports = router;
