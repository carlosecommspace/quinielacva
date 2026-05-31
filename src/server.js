'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const db = require('./db');
const { ADMIN_PATH } = require('./config');
const { formatKickoff, formatDateTime } = require('./util');

const publicRoutes = require('./routes/public');
const clientRoutes = require('./routes/client');
const adminRoutes = require('./routes/admin');
const displayRoutes = require('./routes/display');

const PORT = process.env.PORT || 3000;

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[server] ADMIN_PASSWORD no está configurada. Usando una clave por defecto INSEGURA: "cva-admin-2026".');
}
if (!process.env.SESSION_SECRET) {
  console.warn('[server] SESSION_SECRET no está configurada. Las sesiones no serán estables entre deploys.');
}
if (!process.env.DISPLAY_PASSWORD) {
  console.warn('[server] DISPLAY_PASSWORD no está configurada. El acceso de pantallas (/tv) no permitirá ingresar hasta definirla.');
}

const app = express();

// Railway corre detras de un proxy: confiamos en X-Forwarded-For para que
// req.ip refleje la IP real del cliente (usada en la bitacora de auditoria).
app.set('trust proxy', true);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  cookieSession({
    name: 'cva_quiniela',
    keys: [process.env.SESSION_SECRET || 'cva-dev-secret-no-usar-en-produccion'],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
  })
);

// Mensajes flash y helpers disponibles en todas las vistas.
app.use((req, res, next) => {
  res.locals.flash = (req.session && req.session.flash) || null;
  if (req.session) req.session.flash = null;
  res.locals.fmtKickoff = formatKickoff;
  res.locals.fmtDateTime = formatDateTime;
  res.locals.currentPath = req.path;
  res.locals.section = 'public';
  res.locals.title = 'Quiniela CVA';
  res.locals.adminBase = ADMIN_PATH;
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/', publicRoutes);
app.use('/socio', clientRoutes);
app.use('/tv', displayRoutes);
app.use(ADMIN_PATH, adminRoutes);

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Página no encontrada',
    section: 'public',
    code: 404,
    message: 'La página que buscas no existe.',
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] Error no controlado:', err);
  res.status(500).render('error', {
    title: 'Error',
    section: 'public',
    code: 500,
    message: 'Ocurrió un error inesperado. Intenta de nuevo.',
  });
});

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] Quiniela CVA escuchando en el puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[server] No se pudo inicializar la base de datos:', err);
    process.exit(1);
  });
