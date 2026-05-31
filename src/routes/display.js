'use strict';

const express = require('express');
const router = express.Router();

const store = require('../store');
const { computeStandings } = require('../scoring');

// Portal de pantallas (TVs del club): solo pide una clave definida en el
// servidor (variable DISPLAY_PASSWORD) y muestra la tabla de posiciones con
// auto-refresco. No permite ver ni editar quinielas individuales.
function displayPassword() {
  return process.env.DISPLAY_PASSWORD || '';
}

function requireDisplay(req, res, next) {
  if (!req.session || !req.session.isDisplay) {
    return res.redirect('/tv');
  }
  res.locals.section = 'display';
  next();
}

router.get('/', (req, res) => {
  if (req.session && req.session.isDisplay) {
    return res.redirect('/tv/posiciones');
  }
  res.render('display/login', { title: 'Pantalla · Quiniela CVA', section: 'display' });
});

router.post('/login', (req, res) => {
  const password = String(req.body.password || '');
  const expected = displayPassword();
  if (expected && password === expected) {
    req.session.isDisplay = true;
    return res.redirect('/tv/posiciones');
  }
  res.render('display/login', {
    title: 'Pantalla · Quiniela CVA',
    section: 'display',
    error: expected
      ? 'Clave incorrecta.'
      : 'El acceso de pantallas no está configurado. Define DISPLAY_PASSWORD en el servidor.',
  });
});

router.post('/salir', (req, res) => {
  req.session = null;
  res.redirect('/tv');
});

router.get('/posiciones', requireDisplay, async (req, res) => {
  const [members, matches, predictions, settings] = await Promise.all([
    store.getMembers(),
    store.getMatches(),
    store.getAllPredictions(),
    store.getSettings(),
  ]);
  const standings = computeStandings(members, matches, predictions, settings);
  res.render('display/posiciones', {
    title: 'Posiciones · Quiniela CVA',
    section: 'display',
    standings,
    settings,
    autoRefresh: 60, // segundos: la pantalla se actualiza sola
  });
});

module.exports = router;
