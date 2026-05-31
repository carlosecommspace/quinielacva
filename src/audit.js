'use strict';

const store = require('./store');

// Registra una edicion de quiniela para fines de transparencia: deja una linea
// en la consola (visible en los logs de Railway) y un registro persistente en
// la tabla audit_log. Es best-effort: si el registro en la base falla, se
// reporta por consola pero NUNCA se interrumpe el guardado del socio.
//
// Parametros:
//   actor        'socio' (el socio edita su propia quiniela) o 'admin'.
//   actorMemberId id del socio cuando actor === 'socio' (null para admin).
//   target       el socio dueño de la quiniela editada (objeto member).
//   savedCount   cantidad de partidos con pronostico cargado tras guardar.
//   totalMatches total de partidos del torneo.
//   ip           IP de origen de la peticion.
async function logQuinielaEdit({ actor, actorMemberId, target, savedCount, totalMatches, ip }) {
  const targetName = `${target.first_name} ${target.last_name} (acción ${target.share_number})`;
  const who = actor === 'admin' ? 'el admin' : `el socio #${actorMemberId}`;
  console.log(
    `[audit] ${new Date().toISOString()} ${who} editó la quiniela de ${targetName} ` +
      `[${savedCount}/${totalMatches} pronósticos] ip=${ip || '-'}`
  );
  try {
    await store.recordAudit({
      actor,
      actorMemberId: actor === 'admin' ? null : actorMemberId,
      targetMemberId: target.id,
      targetName,
      action: 'editar_quiniela',
      savedCount,
      ip,
    });
  } catch (err) {
    console.error('[audit] No se pudo registrar en audit_log:', err.message);
  }
}

module.exports = { logQuinielaEdit };
