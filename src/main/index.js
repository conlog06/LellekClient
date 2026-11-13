// LellekClient 3.0 – Hauptprozess-Module. Jedes Modul bekommt einen Kontext (ctx) mit den
// gemeinsamen Diensten aus main.js und registriert seine eigenen IPC-Kanäle.
module.exports = function load(ctx) {
  for (const m of ['browser', 'instance', 'upgrade', 'extras', 'v31']) {
    try { require(`./${m}`)(ctx); }
    catch (e) { ctx.logLauncher('FEHLER', `Modul ${m} konnte nicht geladen werden: ${e.stack || e}`); }
  }
};
