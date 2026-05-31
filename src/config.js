'use strict';

// Ruta base del portal administrador. Es configurable por variable de entorno
// (ADMIN_PATH) para que el panel no viva en la predecible "/admin": asi los
// bots y curiosos no encuentran el login con solo adivinar la URL. El socio
// mantiene su ruta publica "/socio".
//
// Se normaliza a la forma "/segmento" (sin barras al inicio/fin) y se restringe
// a caracteres seguros para una URL. Si el valor es invalido o falta, se usa el
// valor por defecto "admin" (recomendamos cambiarlo en produccion).
function normalizeAdminPath(raw) {
  const fallback = 'admin';
  let p = String(raw == null ? '' : raw).trim().replace(/^\/+|\/+$/g, '');
  if (!p) return '/' + fallback;
  if (!/^[A-Za-z0-9._~-]+$/.test(p)) {
    console.warn(
      `[config] ADMIN_PATH "${raw}" contiene caracteres no permitidos; ` +
        `usa solo letras, numeros, ".", "_", "~" o "-". Se usara "/${fallback}".`
    );
    return '/' + fallback;
  }
  return '/' + p;
}

const ADMIN_PATH = normalizeAdminPath(process.env.ADMIN_PATH);

if (ADMIN_PATH === '/admin') {
  console.warn(
    '[config] El portal administrador esta en la ruta por defecto /admin. ' +
      'Define ADMIN_PATH con una ruta secreta antes de salir a produccion.'
  );
}

module.exports = { ADMIN_PATH };
