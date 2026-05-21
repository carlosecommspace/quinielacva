'use strict';

const express = require('express');
const router = express.Router();

const store = require('../store');
const { parseScore } = require('../util');
const { computeStandings } = require('../scoring');

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
      error: 'Ingresa tu codigo de acceso.',
    });
  }
  const member = await store.getMemberByCode(code);
  if (!member) {
    return res.render('client/login', {
      title: 'Acceso socios · Quiniela CVA',
      section: 'client',
      error: 'El codigo no es valido. Verificalo con la administracion del club.',
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
    flash(req, 'error', 'La carga de pronosticos esta cerrada. No se guardaron cambios.');
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
  flash(req, 'notice', `Pronosticos guardados (${saved} de ${matches.length} partidos).`);
  res.redirect('/socio/quiniela');
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
  });
});

module.exports = router;
