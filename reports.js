const { distM } = require('./util');

// Statistiques à partir de points triés par date : kilométrage, vitesse moyenne, temps de conduite, trajets.
function computeStats(points) {
  let km = 0, driveMs = 0, speedSum = 0, speedN = 0, max = 0, trips = 0, lastMoveT = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) {
      const q = points[i - 1], dt = p.t - q.t, d = distM(q, p);
      // On ignore les trous de plus de 10 min et les sauts impossibles (> 250 km/h)
      if (dt > 0 && dt <= 10 * 60000 && d / (dt / 1000) < 70) km += d / 1000;
      if (q.speed > 0 && dt > 0 && dt <= 5 * 60000) driveMs += dt;
    }
    if (p.speed > 0) {
      speedSum += p.speed; speedN++; max = Math.max(max, p.speed);
      if (trips === 0 || p.t - lastMoveT > 5 * 60000) trips++;
      lastMoveT = p.t;
    }
  }
  const mins = Math.floor(driveMs / 60000);
  return {
    mileageKm: +km.toFixed(2),
    avgSpeed: speedN ? +(speedSum / speedN).toFixed(1) : 0,
    maxSpeed: max,
    drivingMinutes: mins,
    drivingTime: `${Math.floor(mins / 60)}h ${mins % 60}m`,
    trips
  };
}
module.exports = { computeStats };
