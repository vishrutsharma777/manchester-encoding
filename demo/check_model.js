// node demo/check_model.js
// Asserts the browser model against what the Verilog produced:
//   1. PRBS stream from the Link model == sim/prbs_rtl.txt (if present)
//   2. tb_case() rows == docs/link_results.md, every column
//   3. clean run with the phase bug reproduces "about half the symbols flagged"
const fs = require('fs');
const path = require('path');
const M = require('./model.js');
const here = path.join(__dirname, '..');
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS  ' : 'FAIL  ') + msg); if (!c) fails++; };

// 1. PRBS from the cycle model (tx_bit sampled whenever bit_req is high)
const dump = path.join(here, 'sim', 'prbs_rtl.txt');
{
  const L = new M.Link();
  const bits = [];
  L.step(0, 0);
  while (bits.length < 4096) { const w = L.step(1, 0); if (w.bit_req) bits.push(w.tx_bit); }
  const ref = M.prbs_bits(4096);
  ok(bits.join('') === ref.join(''), 'cycle model PRBS == reference LFSR (4096 bits)');
  if (fs.existsSync(dump)) {
    const rtl = fs.readFileSync(dump, 'utf8').replace(/[^01]/g, '');
    ok(rtl.slice(0, 4096) === bits.join(''), 'cycle model PRBS == sim/prbs_rtl.txt (' + rtl.length + ' bits)');
  } else console.log('SKIP  sim/prbs_rtl.txt not present');
}

// 2. testbench table
const md = fs.readFileSync(path.join(here, 'docs', 'link_results.md'), 'utf8');
const rows = md.split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l))
  .map(l => l.split('|').slice(1, -1).map(s => parseFloat(s)));
for (const r of rows) {
  const [rate, inj, first, second, viol, errs, checked] = r;
  const m = M.tb_case(rate);
  const got = [m.injected, m.first, m.second, m.violations, m.prbs_errors, m.checked];
  const want = [inj, first, second, viol, errs, checked];
  ok(got.join() === want.join(),
     `1-in-${rate}: model ${got.join('/')}  vs RTL ${want.join('/')}` +
     (m.violations === m.exp_viol ? '  (viol == parity model)' : '  (PARITY MISMATCH)'));
}

// 3. phase bug
{
  const m = M.tb_case(0, 20000, { bugNoDelay: true });
  const frac = m.violations / 20000;
  ok(frac > 0.4 && frac < 0.6, `bug mode, clean channel: ${m.violations} violations in 20000 symbols (${(100*frac).toFixed(1)} %)`);
}

console.log(fails ? `${fails} FAILED` : 'ALL MODEL CHECKS PASSED');
process.exit(fails ? 1 : 0);
