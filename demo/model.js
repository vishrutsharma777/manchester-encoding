// ---------------------------------------------------------------------------
// model.js -- cycle-accurate JavaScript port of rtl/link_top.v
//
// One call to Link.step() = one rising edge of the half-bit clock. Every
// register is computed from the values it had BEFORE the edge, exactly like a
// set of non-blocking assignments, so the page shows what the RTL does,
// cycle by cycle:
//
//   prbs_gen -> manchester_enc -> hb_tx --(channel: ^ err_inject)--> hb_rx
//            -> manchester_dec -> prbs_check
//
// tb_case() replays tb/tb_link.v's run_case() (same $random stream, same
// start/stop sequence), so the page can regenerate docs/link_results.md.
// demo/check_model.js asserts both against the files the Verilog produced.
// ---------------------------------------------------------------------------
(function (root) {
  'use strict';

  const ORDER = 9, TAP = 5, MASK = (1 << ORDER) - 1;
  const fbOf = (r) => ((r >> (ORDER - 1)) ^ (r >> (TAP - 1))) & 1;

  class Link {
    // opts.bugNoDelay = true reproduces the phase-alignment bug: the decoder is
    // enabled with en instead of en_d (the one-cycle delay in link_top.v).
    constructor(opts) {
      this.bugNoDelay = !!(opts && opts.bugNoDelay);
      this.reset();
    }

    reset() {
      this.gen = 1;                       // prbs_gen.lfsr, seed 1 (all-zero locks up)
      this.enc = { ph: 0, held: 0, dout: 0 };
      this.en_d = 0;
      this.dec = { ph: 0, h1: 0, dout: 0, dvalid: 0, viol: 0 };
      this.chk = { lfsr: 0, fill: 0, locked: 0, err_cnt: 0, bit_cnt: 0 };
      this.viol_cnt = 0;
      this.tx_bit_cnt = 0;
      this.inj = 0;                       // tb_link.err_inject (a register in the TB)
      this.cycle = 0;
    }

    // Combinational values in force BEFORE the next edge, for input en.
    wires(en) {
      en = en ? 1 : 0;
      const tx_bit = fbOf(this.gen);
      const bit_req = en & (this.enc.ph ^ 1);
      const hb_tx = this.enc.dout;
      const hb_rx = hb_tx ^ this.inj;
      const dec_en = this.bugNoDelay ? en : this.en_d;
      const pred = fbOf(this.chk.lfsr);
      const mismatch = pred ^ this.dec.dout;
      const err = this.dec.dvalid & this.chk.locked & mismatch;
      return { en, tx_bit, bit_req, hb_tx, hb_rx, dec_en, pred, mismatch, err,
               rx_bit: this.dec.dout, rx_valid: this.dec.dvalid, rx_viol: this.dec.viol,
               locked: this.chk.locked, inj: this.inj, en_d: this.en_d,
               enc_ph: this.enc.ph, dec_ph: this.dec.ph };
    }

    // One posedge. injNext = value the TB's err_inject register takes at this
    // edge (only loaded while en is high, as in tb_link.v).
    step(en, injNext) {
      const w = this.wires(en);
      const e = this.enc, d = this.dec, c = this.chk;

      // prbs_gen
      const gen = w.bit_req ? (((this.gen << 1) | w.tx_bit) & MASK) : this.gen;

      // manchester_enc
      const ne = { ph: e.ph, held: e.held, dout: e.dout };
      if (w.en) {
        if (!e.ph) { ne.held = w.tx_bit; ne.dout = w.tx_bit; }
        else       { ne.dout = e.held ^ 1; }
        ne.ph = e.ph ^ 1;
      }

      // link_top en_d
      const en_d = w.en;

      // manchester_dec
      const nd = { ph: d.ph, h1: d.h1, dout: d.dout, dvalid: 0, viol: 0 };
      if (w.dec_en) {
        if (!d.ph) { nd.h1 = w.hb_rx; }
        else { nd.dout = d.h1; nd.dvalid = 1; nd.viol = (d.h1 === w.hb_rx) ? 1 : 0; }
        nd.ph = d.ph ^ 1;
      }

      // prbs_check (en = rx_valid, din = rx_bit)
      const nc = { lfsr: c.lfsr, fill: c.fill, locked: c.locked,
                   err_cnt: c.err_cnt, bit_cnt: c.bit_cnt };
      if (d.dvalid) {
        nc.lfsr = ((c.lfsr << 1) | d.dout) & MASK;
        if (!c.locked) {
          if (c.fill === ORDER - 1) nc.locked = 1;
          nc.fill = (c.fill + 1) & 0xff;
        } else {
          nc.bit_cnt = c.bit_cnt + 1;
          if (w.mismatch) nc.err_cnt = c.err_cnt + 1;
        }
      }

      // link_top counters
      if (d.viol) this.viol_cnt++;
      if (w.bit_req) this.tx_bit_cnt++;

      // testbench err_inject register
      if (w.en) this.inj = injNext ? 1 : 0;

      this.gen = gen; this.enc = ne; this.en_d = en_d; this.dec = nd; this.chk = nc;
      this.cycle++;
      return w;                          // what was on the wires during this cycle
    }
  }

  // -------------------------------------------------------------------------
  // Verilog $random, as specified in IEEE 1364 (rtl_dist_uniform over the full
  // 32-bit range) and implemented by Icarus. 32-bit seed, float32 mantissa
  // trick reproduced with a typed-array union.
  // -------------------------------------------------------------------------
  const u32 = new Uint32Array(1), f32 = new Float32Array(u32.buffer);
  function uniform(st, start, end) {
    const d = 0.00000011920928955078125;
    let a, b;
    if (st.seed === 0) st.seed = 259341593;
    if (start >= end) { a = 0.0; b = 2147483647.0; }
    else { a = start; b = end; }
    st.seed = (Math.imul(69069, st.seed) + 1) | 0;
    u32[0] = ((st.seed >>> 9) | 0x3f800000) >>> 0;
    let c = f32[0];
    c = c + (c * d);
    c = ((b - a) * (c - 1.0)) + a;
    return c;
  }
  function vrandom(st) {           // returns a signed 32-bit integer
    const start = -2147483648, end = 2147483647;
    let r = uniform(st, start, end);
    r = (r + 2147483648.0) / 4294967295.0;
    r = r * 4294967296.0 - 2147483648.0;
    const i = r >= 0 ? Math.trunc(r) : Math.trunc(r - 1);
    return i | 0;
  }

  // -------------------------------------------------------------------------
  // tb_link.v run_case(rate): same seed, same start/stop protocol.
  // -------------------------------------------------------------------------
  function tb_case(rate, nbits, opts) {
    nbits = nbits || 200000;
    const L = new Link(opts);
    const st = { seed: 0x12345678 };
    let inj_total = 0, inj_first = 0, inj_second = 0, sym_odd = 0, exp_viol = 0;
    const edge = (en) => {
      // TB monitors sample the values in force at this edge
      if (en && L.inj) { inj_total++; if (L.dec.ph === 0) inj_first++; else inj_second++; }
      if (L.en_d) {
        if (L.dec.ph === 0) sym_odd = L.inj;
        else if (sym_odd ^ L.inj) exp_viol++;
      }
      let next = 0;
      if (en) next = (rate !== 0) && (((vrandom(st) >>> 0) % rate) === 0) ? 1 : 0;
      L.step(en, next);
    };
    edge(0);                                   // rst_n released, en still low
    while (L.tx_bit_cnt < nbits) edge(1);      // wait (tx_bit_cnt >= NBITS)
    edge(1);                                   // stop only on a symbol boundary
    while (L.enc.ph !== 0) edge(1);
    for (let k = 0; k < 6; k++) edge(0);
    const mult = inj_first ? L.chk.err_cnt / inj_first : 0;
    return { rate, injected: inj_total, first: inj_first, second: inj_second,
             violations: L.viol_cnt, prbs_errors: L.chk.err_cnt,
             checked: L.chk.bit_cnt, mult, exp_viol };
  }

  function prbs_bits(n) {
    let r = 1; const out = [];
    for (let k = 0; k < n; k++) { const fb = fbOf(r); r = ((r << 1) | fb) & MASK; out.push(fb); }
    return out;
  }

  const api = { Link, tb_case, vrandom, prbs_bits, ORDER, TAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LinkModel = api;
})(this);
