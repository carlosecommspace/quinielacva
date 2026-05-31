'use strict';

const express = require('express');
const router = express.Router();

// Sin ingreso dual: la raiz lleva directo al portal del socio. El portal
// administrador vive en su ruta secreta (ADMIN_PATH) y no se enlaza aqui.
router.get('/', (req, res) => {
  res.redirect('/socio');
});

module.exports = router;
