'use strict';

const express = require('express');
const router = express.Router();

const store = require('../store');
const audit = require('../audit');
const { parseScore, normalizeShare } = require('../util');
const { computeStandings, matchIsFinished, predictionPoints } = require('../scoring');

// Costo de cada quiniela. Configurable por entorno; por defecto REF15.
const QUINIELA_COST = process.env.QUINIELA_COST || 'REF15';

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

// --- Acceso / panel del socio ---
router.get('/', async (req, res) => {
  if (req.session && req.session.memberId) {
    const member = await store.getMember(req.session.memberId);
    if (member) {
      req.member = member;
      res.locals.member = member;
      return renderPanel(req, res, member);
    }
    req.session = null;
  }
  res.render('client/login', { title: 'Acceso socios · Quiniela CVA', section: 'client' });
});

async function renderPanel(req, res, member) {
  const [settings, quinielas, matches, predCounts] = await Promise.all([
    store.getSettings(),
    store.getMemberQuinielas(member.id),
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
  res.render('client/panel', {
    title: 'Mis quinielas · Quiniela CVA',
    section: 'client',
    member,
    settings,
    quinielas: items,
    totalMatches: matches.length,
    cost: QUINIELA_COST,
  });
}

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
  res.redirect('/socio');
});

// --- Alta publica del socio: numero de accion (3 digitos) + nombre + apellido ---
router.get('/registro', (req, res) => {
  if (req.session && req.session.memberId) return res.redirect('/socio');
  res.render('client/registro', {
    title: 'Crear mi quiniela · Quiniela CVA',
    section: 'client',
    cost: QUINIELA_COST,
  });
});

router.post('/registro', async (req, res) => {
  const firstName = String(req.body.first_name || '').trim();
  const lastName = String(req.body.last_name || '').trim();
  const shareRaw = String(req.body.share_number || '').trim();
  const share = normalizeShare(shareRaw);

  function fail(message) {
    return res.render('client/registro', {
      title: 'Crear mi quiniela · Quiniela CVA',
      section: 'client',
      cost: QUINIELA_COST,
      error: message,
      values: { first_name: firstName, last_name: lastName, share_number: shareRaw },
    });
  }

  if (!firstName || !lastName || !share || !/\d/.test(share)) {
    return fail('Completa tu número de acción, nombre y apellido.');
  }

  let member = await store.findMember(share, firstName, lastName);
  let isNew = false;
  if (!member) {
    member = await store.createMember(firstName, lastName, share);
    if (!member) {
      return fail('No se pudo generar tu acceso. Intenta de nuevo en un momento.');
    }
    isNew = true;
  }
  await store.markFirstAccess(member.id);
  req.session.memberId = member.id;

  const settings = await store.getSettings();
  // Socio nuevo (y con la carga abierta): le creamos su primera quiniela y lo
  // llevamos directo a cargarla. Si ya existia, lo llevamos a su panel.
  if (isNew && !settings.predictionsLocked) {
    const q = await store.createQuiniela(member.id, store.nextQuinielaLabel(0));
    flash(
      req,
      'notice',
      `¡Listo, ${member.first_name}! Tu código de acceso es ${member.code} (guárdalo para volver a entrar). Tu quiniela está NO PAGADA; paga ${QUINIELA_COST} a la administración para validarla.`
    );
    return res.redirect(`/socio/quiniela/${q.id}`);
  }
  flash(
    req,
    'notice',
    `¡Hola de nuevo, ${member.first_name}! Tu código de acceso es ${member.code}. Aquí están tus quinielas.`
  );
  res.redirect('/socio');
});

router.post('/salir', (req, res) => {
  req.session = null;
  res.redirect('/socio');
});

// --- Crear una nueva quiniela (queda NO pagada por defecto) ---
router.post('/quiniela/nueva', requireMember, async (req, res) => {
  const settings = await store.getSettings();
  if (settings.predictionsLocked) {
    flash(req, 'error', 'La carga está cerrada: ya no se pueden crear nuevas quinielas.');
    return res.redirect('/socio');
  }
  const existing = await store.getMemberQuinielas(req.member.id);
  const q = await store.createQuiniela(req.member.id, store.nextQuinielaLabel(existing.length));
  flash(
    req,
    'notice',
    `Nueva quiniela creada (NO PAGADA). Para validarla y que juegue, paga ${QUINIELA_COST} a la administración del club; ellos la activarán.`
  );
  res.redirect(`/socio/quiniela/${q.id}`);
});

// --- Editar una quiniela propia ---
router.get('/quiniela/:qid', requireMember, async (req, res) => {
  const qid = parseInt(req.params.qid, 10);
  const quiniela = await store.getQuiniela(qid);
  if (!quiniela || quiniela.member_id !== req.member.id) {
    flash(req, 'error', 'Quiniela no encontrada.');
    return res.redirect('/socio');
  }
  const [groups, settings, predictions] = await Promise.all([
    store.getGroups(),
    store.getSettings(),
    store.getPredictions(qid),
  ]);
  res.render('client/quiniela', {
    title: `${quiniela.label} · Quiniela CVA`,
    section: 'client',
    quiniela,
    groups,
    settings,
    predictions,
    editable: !settings.predictionsLocked,
    cost: QUINIELA_COST,
  });
});

router.post('/quiniela/:qid', requireMember, async (req, res) => {
  const qid = parseInt(req.params.qid, 10);
  const quiniela = await store.getQuiniela(qid);
  if (!quiniela || quiniela.member_id !== req.member.id) {
    flash(req, 'error', 'Quiniela no encontrada.');
    return res.redirect('/socio');
  }
  const settings = await store.getSettings();
  if (settings.predictionsLocked) {
    flash(req, 'error', 'La carga de pronósticos está cerrada. No se guardaron cambios.');
    return res.redirect(`/socio/quiniela/${qid}`);
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
    actor: 'socio',
    actorMemberId: req.member.id,
    target: req.member,
    quinielaLabel: quiniela.label,
    savedCount: saved,
    totalMatches: matches.length,
    ip: req.ip,
  });
  const note = quiniela.paid
    ? ''
    : ` Recuerda: esta quiniela aún está NO PAGADA; paga ${QUINIELA_COST} a la administración para validarla.`;
  flash(req, 'notice', `Pronósticos guardados (${saved} de ${matches.length} partidos).${note}`);
  res.redirect(`/socio/quiniela/${qid}`);
});

// --- Ver la quiniela de otro participante (transparencia) ---
// Solo cuando la carga esta cerrada y solo quinielas pagadas (las que compiten).
router.get('/q/:qid', requireMember, async (req, res) => {
  const settings = await store.getSettings();
  if (!settings.predictionsLocked) {
    flash(req, 'error', 'Las quinielas de los demás solo pueden verse cuando la carga está cerrada.');
    return res.redirect('/socio/posiciones');
  }
  const qid = parseInt(req.params.qid, 10);
  const quiniela = await store.getQuiniela(qid);
  if (!quiniela || !quiniela.paid) {
    flash(req, 'error', 'Quiniela no encontrada.');
    return res.redirect('/socio/posiciones');
  }
  const [groups, predictions] = await Promise.all([
    store.getGroups(),
    store.getPredictions(qid),
  ]);
  const matches = [];
  for (const g of groups) for (const m of g.matches) matches.push(m);
  res.render('client/quiniela_ver', {
    title: `${quiniela.first_name} ${quiniela.last_name} · ${quiniela.label} · Quiniela CVA`,
    section: 'client',
    quiniela,
    groups,
    settings,
    predictions,
    points: totalPoints(matches, predictions, settings),
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

// --- Posiciones (solo quinielas pagadas; cada una compite por separado) ---
router.get('/posiciones', requireMember, async (req, res) => {
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
  res.render('client/posiciones', {
    title: 'Posiciones · Quiniela CVA',
    section: 'client',
    standings,
    settings,
    highlightMemberId: req.member.id,
    // Con la carga cerrada cada quiniela enlaza a su detalle (transparencia).
    quinielaLinkBase: settings.predictionsLocked ? '/socio/q' : null,
  });
});

module.exports = router;
