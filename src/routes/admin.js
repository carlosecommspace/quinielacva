'use strict';

const express = require('express');
const router = express.Router();

const { query } = require('../db');
const { ADMIN_PATH } = require('../config');
const store = require('../store');
const audit = require('../audit');
const { memberCode, parseScore } = require('../util');
const { computeStandings, matchIsFinished, predictionPoints } = require('../scoring');

const QUINIELA_COST = process.env.QUINIELA_COST || 'REF15';

// Suma de puntos de un mapa de pronosticos contra los partidos finalizados.
function totalPoints(matches, predictions, settings) {
  let points = 0;
  for (const m of matches) {
    if (!matchIsFinished(m)) continue;
    const pred = predictions.get(m.id);
    if (pred) points += predictionPoints(pred, m, settings).points;
  }
  return points;
}

function adminPassword() {
  return process.env.ADMIN_PASSWORD || 'cva-admin-2026';
}

function flash(req, type, text) {
  req.session.flash = { type, text };
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.redirect(ADMIN_PATH);
  }
  res.locals.section = 'admin';
  next();
}

// --- Acceso administrador ---
router.get('/', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect(`${ADMIN_PATH}/panel`);
  }
  res.render('admin/login', { title: 'Administración · Quiniela CVA', section: 'admin' });
});

router.post('/login', (req, res) => {
  const password = String(req.body.password || '');
  if (password && password === adminPassword()) {
    req.session.isAdmin = true;
    return res.redirect(`${ADMIN_PATH}/panel`);
  }
  res.render('admin/login', {
    title: 'Administración · Quiniela CVA',
    section: 'admin',
    error: 'Contraseña incorrecta.',
  });
});

router.post('/salir', (req, res) => {
  req.session = null;
  res.redirect(ADMIN_PATH);
});

// --- Panel ---
router.get('/panel', requireAdmin, async (req, res) => {
  const [members, matches, settings, quinielaSummary] = await Promise.all([
    store.getMembers(),
    store.getMatches(),
    store.getSettings(),
    store.getQuinielaSummary(),
  ]);
  res.render('admin/panel', {
    title: 'Panel · Quiniela CVA',
    section: 'admin',
    membersCount: members.length,
    matchesCount: matches.length,
    finishedCount: matches.filter(matchIsFinished).length,
    quinielaSummary,
    settings,
  });
});

// --- Socios ---
router.get('/socios', requireAdmin, async (req, res) => {
  const [members, counts] = await Promise.all([
    store.getMembers(),
    store.getQuinielaCountsByMember(),
  ]);
  res.render('admin/socios', {
    title: 'Socios · Quiniela CVA',
    section: 'admin',
    members,
    counts,
    createdId: req.query.creado ? parseInt(req.query.creado, 10) : null,
  });
});

router.post('/socios', requireAdmin, async (req, res) => {
  const firstName = String(req.body.first_name || '').trim();
  const lastName = String(req.body.last_name || '').trim();
  const shareNumber = String(req.body.share_number || '').trim();

  if (!firstName || !lastName || !shareNumber) {
    flash(req, 'error', 'Nombre, apellido y número de acción son obligatorios.');
    return res.redirect(`${ADMIN_PATH}/socios`);
  }

  const created = await store.createMember(firstName, lastName, shareNumber);
  if (!created) {
    flash(req, 'error', 'No se pudo generar un código único. Intenta de nuevo.');
    return res.redirect(`${ADMIN_PATH}/socios`);
  }
  // El socio arranca con una quiniela vacia (no pagada) lista para cargar.
  await store.createQuiniela(created.id, store.nextQuinielaLabel(0));
  flash(req, 'notice', `Socio creado: ${created.first_name} ${created.last_name}. Código de acceso: ${created.code}`);
  res.redirect(`${ADMIN_PATH}/socios?creado=${created.id}`);
});

router.post('/socios/:id/eliminar', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const member = await store.getMember(id);
  if (member) {
    await query('DELETE FROM members WHERE id = $1', [id]);
    flash(req, 'notice', `Socio eliminado: ${member.first_name} ${member.last_name}.`);
  }
  res.redirect(`${ADMIN_PATH}/socios`);
});

router.post('/socios/:id/codigo', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const member = await store.getMember(id);
  if (!member) return res.redirect(`${ADMIN_PATH}/socios`);
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = memberCode(member.share_number);
    try {
      await query('UPDATE members SET code = $1 WHERE id = $2', [code, id]);
      flash(req, 'notice', `Nuevo código para ${member.first_name} ${member.last_name}: ${code}`);
      break;
    } catch (err) {
      if (err.code === '23505') continue;
      throw err;
    }
  }
  res.redirect(`${ADMIN_PATH}/socios/${id}`);
});

// Detalle del socio: lista sus quinielas (pagadas y no pagadas).
router.get('/socios/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const member = await store.getMember(id);
  if (!member) {
    flash(req, 'error', 'Socio no encontrado.');
    return res.redirect(`${ADMIN_PATH}/socios`);
  }
  const [quinielas, settings, matches, predCounts] = await Promise.all([
    store.getMemberQuinielas(id),
    store.getSettings(),
    store.getMatches(),
    store.getPredictionCountsByQuiniela(),
  ]);
  const items = [];
  for (const q of quinielas) {
    const preds = await store.getPredictions(q.id);
    items.push({
      ...q,
      points: totalPoints(matches, preds, settings),
      filled: predCounts.get(q.id) || 0,
    });
  }
  res.render('admin/socio', {
    title: `${member.first_name} ${member.last_name} · Quiniela CVA`,
    section: 'admin',
    member,
    quinielas: items,
    totalMatches: matches.length,
    cost: QUINIELA_COST,
  });
});

// Crear una quiniela adicional para el socio.
router.post('/socios/:id/quiniela', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const member = await store.getMember(id);
  if (!member) {
    flash(req, 'error', 'Socio no encontrado.');
    return res.redirect(`${ADMIN_PATH}/socios`);
  }
  const existing = await store.getMemberQuinielas(id);
  const q = await store.createQuiniela(id, store.nextQuinielaLabel(existing.length));
  flash(req, 'notice', `Nueva quiniela creada para ${member.first_name} ${member.last_name} (no pagada).`);
  res.redirect(`${ADMIN_PATH}/quinielas/${q.id}`);
});

// --- Quinielas: seguimiento global (pagadas / no pagadas) ---
router.get('/quinielas', requireAdmin, async (req, res) => {
  const [quinielas, settings, matches, predCounts] = await Promise.all([
    store.getAllQuinielas(),
    store.getSettings(),
    store.getMatches(),
    store.getPredictionCountsByQuiniela(),
  ]);
  const items = [];
  for (const q of quinielas) {
    const preds = await store.getPredictions(q.id);
    items.push({
      ...q,
      points: totalPoints(matches, preds, settings),
      filled: predCounts.get(q.id) || 0,
    });
  }
  res.render('admin/quinielas', {
    title: 'Quinielas · Quiniela CVA',
    section: 'admin',
    quinielas: items,
    totalMatches: matches.length,
    cost: QUINIELA_COST,
    paidCount: items.filter((q) => q.paid).length,
  });
});

// Marcar una quiniela como pagada / no pagada (validacion del pago).
router.post('/quinielas/:qid/pagar', requireAdmin, async (req, res) => {
  const qid = parseInt(req.params.qid, 10);
  const quiniela = await store.getQuiniela(qid);
  if (!quiniela) {
    flash(req, 'error', 'Quiniela no encontrada.');
    return res.redirect(`${ADMIN_PATH}/quinielas`);
  }
  const paid = req.body.paid === '1';
  await store.setQuinielaPaid(qid, paid);
  flash(
    req,
    'notice',
    `Quiniela de ${quiniela.first_name} ${quiniela.last_name} (${quiniela.label}) marcada como ${paid ? 'PAGADA' : 'NO pagada'}.`
  );
  const back = req.body.back === 'socio' ? `${ADMIN_PATH}/socios/${quiniela.member_id}` : `${ADMIN_PATH}/quinielas`;
  res.redirect(back);
});

router.post('/quinielas/:qid/eliminar', requireAdmin, async (req, res) => {
  const qid = parseInt(req.params.qid, 10);
  const quiniela = await store.getQuiniela(qid);
  if (!quiniela) return res.redirect(`${ADMIN_PATH}/quinielas`);
  await store.deleteQuiniela(qid);
  flash(req, 'notice', `Quiniela eliminada: ${quiniela.first_name} ${quiniela.last_name} (${quiniela.label}).`);
  const back = req.body.back === 'socio' ? `${ADMIN_PATH}/socios/${quiniela.member_id}` : `${ADMIN_PATH}/quinielas`;
  res.redirect(back);
});

// Ver / editar los pronosticos de una quiniela.
router.get('/quinielas/:qid', requireAdmin, async (req, res) => {
  const qid = parseInt(req.params.qid, 10);
  const quiniela = await store.getQuiniela(qid);
  if (!quiniela) {
    flash(req, 'error', 'Quiniela no encontrada.');
    return res.redirect(`${ADMIN_PATH}/quinielas`);
  }
  const [groups, settings, predictions, matches] = await Promise.all([
    store.getGroups(),
    store.getSettings(),
    store.getPredictions(qid),
    store.getMatches(),
  ]);
  res.render('admin/quiniela', {
    title: `${quiniela.first_name} ${quiniela.last_name} · ${quiniela.label} · Quiniela CVA`,
    section: 'admin',
    quiniela,
    groups,
    settings,
    predictions,
    points: totalPoints(matches, predictions, settings),
    cost: QUINIELA_COST,
    editable: true,
  });
});

router.post('/quinielas/:qid', requireAdmin, async (req, res) => {
  const qid = parseInt(req.params.qid, 10);
  const quiniela = await store.getQuiniela(qid);
  if (!quiniela) {
    flash(req, 'error', 'Quiniela no encontrada.');
    return res.redirect(`${ADMIN_PATH}/quinielas`);
  }
  const matches = await store.getMatches();
  const entries = matches.map((m) => ({
    matchId: m.id,
    home: parseScore(req.body[`h_${m.id}`]),
    away: parseScore(req.body[`a_${m.id}`]),
  }));
  await store.savePredictions(qid, entries);
  const saved = entries.filter((e) => e.home !== null && e.away !== null).length;
  await audit.logQuinielaEdit({
    actor: 'admin',
    actorMemberId: null,
    target: quiniela,
    quinielaLabel: quiniela.label,
    savedCount: saved,
    totalMatches: matches.length,
    ip: req.ip,
  });
  flash(req, 'notice', `Quiniela actualizada: ${quiniela.first_name} ${quiniela.last_name} (${quiniela.label}).`);
  res.redirect(`${ADMIN_PATH}/quinielas/${qid}`);
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
  res.redirect(`${ADMIN_PATH}/partidos`);
});

// --- Puntuacion y cierre ---
router.get('/puntuacion', requireAdmin, async (req, res) => {
  const settings = await store.getSettings();
  res.render('admin/puntuacion', {
    title: 'Puntuación · Quiniela CVA',
    section: 'admin',
    settings,
  });
});

router.post('/puntuacion', requireAdmin, async (req, res) => {
  const outcome = parseInt(req.body.points_outcome, 10);
  const exact = parseInt(req.body.points_exact, 10);
  if (!Number.isInteger(outcome) || outcome < 0 || !Number.isInteger(exact) || exact < 0) {
    flash(req, 'error', 'Los puntajes deben ser números enteros mayores o iguales a cero.');
    return res.redirect(`${ADMIN_PATH}/puntuacion`);
  }
  await store.setSetting('points_outcome', outcome);
  await store.setSetting('points_exact', exact);
  flash(req, 'notice', 'Puntuación actualizada.');
  res.redirect(`${ADMIN_PATH}/puntuacion`);
});

router.post('/cierre', requireAdmin, async (req, res) => {
  const locked = req.body.locked === '1';
  const deadlineText = String(req.body.deadline_text || '').trim();
  await store.setSetting('predictions_locked', locked ? '1' : '0');
  await store.setSetting('deadline_text', deadlineText);
  flash(
    req,
    'notice',
    locked ? 'Carga de pronósticos CERRADA.' : 'Carga de pronósticos ABIERTA.'
  );
  res.redirect(`${ADMIN_PATH}/puntuacion`);
});

// --- Posiciones ---
router.get('/posiciones', requireAdmin, async (req, res) => {
  const [paid, matches, predictions, settings] = await Promise.all([
    store.getPaidQuinielas(),
    store.getMatches(),
    store.getAllPredictions(),
    store.getSettings(),
  ]);
  const competitors = paid.map((q) => ({
    id: q.id,
    label: q.label,
    member: {
      id: q.member_id,
      first_name: q.first_name,
      last_name: q.last_name,
      share_number: q.share_number,
    },
  }));
  const standings = computeStandings(competitors, matches, predictions, settings);
  res.render('admin/posiciones', {
    title: 'Posiciones · Quiniela CVA',
    section: 'admin',
    standings,
    settings,
  });
});

module.exports = router;
