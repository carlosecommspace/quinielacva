'use strict';

// Resultado de un marcador: 'home' | 'away' | 'draw'
function outcome(homeScore, awayScore) {
  if (homeScore > awayScore) return 'home';
  if (homeScore < awayScore) return 'away';
  return 'draw';
}

function matchIsFinished(match) {
  return match.home_score !== null && match.home_score !== undefined &&
         match.away_score !== null && match.away_score !== undefined;
}

// Puntos de un pronostico contra un partido finalizado.
// Devuelve { points, exact, hit } donde hit indica acierto del resultado (1X2).
function predictionPoints(prediction, match, scoring) {
  const actual = outcome(match.home_score, match.away_score);
  const predicted = outcome(prediction.home_score, prediction.away_score);
  const exact =
    prediction.home_score === match.home_score &&
    prediction.away_score === match.away_score;

  if (exact) return { points: scoring.pointsExact, exact: true, hit: true };
  if (predicted === actual) return { points: scoring.pointsOutcome, exact: false, hit: true };
  return { points: 0, exact: false, hit: false };
}

// Calcula la tabla de posiciones.
// members:     [{ id, first_name, last_name, share_number, ... }]
// matches:     [{ id, home_score, away_score, ... }]
// predictions: [{ member_id, match_id, home_score, away_score }]
// scoring:     { pointsOutcome, pointsExact }
function computeStandings(members, matches, predictions, scoring) {
  const finished = matches.filter(matchIsFinished);
  const matchById = new Map(finished.map((m) => [m.id, m]));

  const stats = new Map();
  for (const m of members) {
    stats.set(m.id, {
      member: m,
      points: 0,
      exactHits: 0,
      outcomeHits: 0,
      played: 0,
    });
  }

  for (const p of predictions) {
    const match = matchById.get(p.match_id);
    if (!match) continue;
    const s = stats.get(p.member_id);
    if (!s) continue;
    const r = predictionPoints(p, match, scoring);
    s.points += r.points;
    s.played += 1;
    if (r.exact) s.exactHits += 1;
    else if (r.hit) s.outcomeHits += 1;
  }

  const table = [...stats.values()];
  table.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.exactHits !== a.exactHits) return b.exactHits - a.exactHits;
    if (b.outcomeHits !== a.outcomeHits) return b.outcomeHits - a.outcomeHits;
    const an = `${a.member.last_name} ${a.member.first_name}`.toLowerCase();
    const bn = `${b.member.last_name} ${b.member.first_name}`.toLowerCase();
    return an.localeCompare(bn);
  });

  let rank = 0;
  let prevKey = null;
  table.forEach((row, i) => {
    const key = `${row.points}-${row.exactHits}-${row.outcomeHits}`;
    if (key !== prevKey) {
      rank = i + 1;
      prevKey = key;
    }
    row.rank = rank;
  });

  return table;
}

module.exports = { outcome, matchIsFinished, predictionPoints, computeStandings };
