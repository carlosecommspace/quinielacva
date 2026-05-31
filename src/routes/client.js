'use strict';

const express = require('express');
const router = express.Router();

const store = require('../store');
const audit = require('../audit');
const { parseScore } = require('../util');
const { computeStandings, matchIsFinished, predictionPoints } = require('../scoring');

function flash(req, type, text) {
  req.session.flash = { type, text };
}

async function requireMember(req, res, next) {
  if (!req.session || !req.session.memberId) {
    return res.redirect('/socio');
  }
  const member = await store.getMember(req.session.memberId);
  if (!member) {
    req.session = null;
    return res.redirect('/socio');
  }
  req.member = member;
  res.locals.member = member;
  next();
}

// --- Acceso ---
router.get('/', (req, res) => {
  if (req.session && req.session.memberId) {
    return res.redirect('/socio/quiniela');
  }
  res.render('client/login', { title: 'Acceso socios · Quiniela CVA', section: 'client' });
});

router.post('/', async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  if (!code) {
    return res.render('client/login', {
      title: 'Acceso socios · Quiniela CVA',
      section: 'client',
      error: 'Ingresa tu código de acceso.',
    });
  }
  const member = await store.getMemberByCode(code);
  if (!member) {
    return res.render('client/login', {
      title: 'Acceso socios · Quiniela CVA',
      section: 'client',
      error: 'El código no es válido. Verifícalo con la administración del club.',
    });
  }
  await store.markFirstAccess(member.id);
  req.session.memberId = member.id;
  res.redirect('/socio/quiniela');
});

router.post('/salir', (req, res) => {
  req.session = null;
  res.redirect('/socio');
});

// --- Quiniela del socio ---
router.get('/quiniela', requireMember, async (req, res) => {
  const [groups, settings, predictions] = await Promise.all([
    store.getGroups(),
    store.getSettings(),
    store.getPredictions(req.member.id),
  ]);
  res.render('client/quiniela', {
    title: 'Mi quiniela · Quiniela CVA',
    section: 'client',
    groups,
    settings,
    predictions,
    editable: !settings.predictionsLocked,
  });
});

router.post('/quiniela', requireMember, async (req, res) => {
  const settings = await store.getSettings();
  if (settings.predictionsLocked) {
    flash(req, 'error', 'La carga de pronósticos está cerrada. No se guardaron cambios.');
    return res.redirect('/socio/quiniela');
  }
  const matches = await store.getMatches();
  const entries = matches.map((m) => ({
    matchId: m.id,
    home: parseScore(req.body[`h_${m.id}`]),
    away: parseScore(req.body[`a_${m.id}`]),
  }));
  await store.savePredictions(req.member.id, entries);
  const saved = entries.filter((e) => e.home !== null && e.away !== null).length;
  await audit.logQuinielaEdit({
    actor: 'socio',
    actorMemberId: req.member.id,
    target: req.member,
    savedCount: saved,
    totalMatches: matches.length,
    ip: req.ip,
  });
  flash(req, 'notice', `Pronósticos guardados (${saved} de ${matches.length} partidos).`);
  res.redirect('/socio/quiniela');
});

// --- Ver la quiniela de otro socio (transparencia) ---
// Solo es posible cuando la carga esta cerrada; asi nadie ve los pronosticos
// ajenos antes del cierre. Se accede desde la tabla de posiciones.
router.get('/quiniela/:id', requireMember, async (req, res) => {
  const settings = await store.getSettings();
  if (!settings.predictionsLocked) {
    flash(req, 'error', 'Las quinielas de los demás socios solo pueden verse cuando la carga está cerrada.');
    return res.redirect('/socio/posiciones');
  }
  const id = parseInt(req.params.id, 10);
  const target = await store.getMember(id);
  if (!target) {
    flash(req, 'error', 'Socio no encontrado.');
    return res.redirect('/socio/posiciones');
  }
  const [groups, predictions] = await Promise.all([
    store.getGroups(),
    store.getPredictions(id),
  ]);
  let points = 0;
  for (const g of groups) {
    for (const m of g.matches) {
      if (!matchIsFinished(m)) continue;
      const pred = predictions.get(m.id);
      if (!pred) continue;
      points += predictionPoints(pred, m, settings).points;
    }
  }
  res.render('client/quiniela_ver', {
    title: `Quiniela de ${target.first_name} ${target.last_name} · Quiniela CVA`,
    section: 'client',
    target,
    groups,
    settings,
    predictions,
    points,
    editable: false,
  });
});

// --- Resultados ---
router.get('/resultados', requireMember, async (req, res) => {
  const groups = await store.getGroups();
  res.render('client/resultados', {
    title: 'Resultados · Quiniela CVA',
    section: 'client',
    groups,
  });
});

// --- Posiciones ---
router.get('/posiciones', requireMember, async (req, res) => {
  const [members, matches, predictions, settings] = await Promise.all([
    store.getMembers(),
    store.getMatches(),
    store.getAllPredictions(),
    store.getSettings(),
  ]);
  const standings = computeStandings(members, matches, predictions, settings);
  res.render('client/posiciones', {
    title: 'Posiciones · Quiniela CVA',
    section: 'client',
    standings,
    settings,
    highlightMemberId: req.member.id,
    // Cuando la carga esta cerrada, cada socio enlaza a su quiniela (visible
    // para todos por transparencia). Con la carga abierta no se enlaza.
    quinielaLinkBase: settings.predictionsLocked ? '/socio/quiniela' : null,
  });
});

module.exports = router;
