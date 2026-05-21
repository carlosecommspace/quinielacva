'use strict';

const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('home', { title: 'Quiniela CVA · Mundial 2026', section: 'public' });
});

module.exports = router;
