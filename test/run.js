// Führt alle *.test.js nacheinander aus (je eigener Prozess). Aufruf: npm test
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path');
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = [];
for (const f of files) {
  console.log(`▶ ${f}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit', timeout: 240000 });
  if (r.status !== 0) failed.push(f);
}
console.log(failed.length ? `\n✗ ${failed.length} von ${files.length} Tests fehlgeschlagen: ${failed.join(', ')}` : `\n✓ alle ${files.length} Testdateien bestanden`);
process.exit(failed.length ? 1 : 0);
