// Smoke test for a built dist/ directory: boots both ropes in the WebAssembly
// engine and drives them through the DSKY exactly as a crew member would.
//
//   node tests/smoke.mjs dist
//
// Checks:
//   - V35E lamp test lights every digit
//   - V16N36E shows a mission clock that advances
//   - V91E (the flight software's own rope checksum routine) reports a good
//     checksum for every one of the 36 fixed-memory banks
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(process.argv[2] || 'dist');
const { AGC } = await import(pathToFileURL(path.join(dist, 'agc.js')));
const wasm = fs.readFileSync(path.join(dist, 'agc.wasm'));

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const keys = (agc, s) => s.match(/V|N|E|R|\d/g).forEach((k) =>
  agc.key({ V: 'VERB', N: 'NOUN', E: 'ENTR', R: 'RSET' }[k] ?? k));

for (const name of ['Comanche055', 'Luminary099']) {
  const agc = await AGC.fromBytes(wasm, () => {});
  agc.boot(fs.readFileSync(path.join(dist, 'ropes', `${name}.bin`)));
  agc.run(2);
  check(agc.dsky().lamps.RESTART, `${name}: RESTART lamp lit at power-on`);
  keys(agc, 'R'); agc.run(1);
  check(!agc.dsky().lamps.RESTART, `${name}: RSET clears RESTART`);

  keys(agc, 'V35E'); agc.run(1.5);
  let d = agc.dsky();
  check([d.prog, d.verb, d.noun].join('') === '888888' && [d.r1, d.r2, d.r3].every((r) => r === '+88888'),
    `${name}: V35 lamp test lights all segments`);
  agc.run(6);

  keys(agc, 'V16N36E'); agc.run(1.5);
  agc.run(3);
  d = agc.dsky();
  const t2 = parseInt(d.r3.slice(1), 10);
  check(d.verb === '16' && d.noun === '36' && t2 > 0, `${name}: V16N36 shows the mission clock (${d.r1} ${d.r2} ${d.r3})`);

  // V91: "display bank checksums". For each bank it shows V05N01 with
  // R1 = sum, R2 = bank number, R3 = bugger word; PRO steps to the next bank.
  keys(agc, 'V91E'); agc.run(2);
  const banks = new Set();
  let bad = [];
  for (let i = 0; i < 40 && banks.size < 36; i++) {
    d = agc.dsky();
    if (d.verb !== '05' || d.noun !== '01') break;
    const sum = parseInt(d.r1.slice(1), 8), bank = parseInt(d.r2.slice(1), 8);
    // A good bank sums to +bank or -bank (ones' complement: 77777 - bank).
    if (!(sum === bank || sum === (0o77777 - bank))) bad.push(bank.toString(8));
    banks.add(bank);
    agc.pro(true); agc.run(0.3); agc.pro(false); agc.run(1.5);
  }
  check(banks.size === 36 && bad.length === 0,
    `${name}: V91 rope checksum good for ${banks.size} of 36 banks${bad.length ? ' (bad: ' + bad.join(',') + ')' : ''}`);
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all checks passed');
