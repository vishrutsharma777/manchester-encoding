// app.js -- drives the page. All link behaviour comes from model.js.
(function () {
  'use strict';
  const M = window.LinkModel;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Verilog results, copied from docs/link_results.md (written by Icarus)
  const VERILOG = {
    0:      [0, 0, 0, 0, 0, 199991],
    100000: [2, 1, 1, 2, 3, 199991],
    10000:  [43, 15, 28, 43, 45, 199991],
    1000:   [398, 190, 208, 398, 570, 199991],
    100:    [3985, 2004, 1981, 3943, 5896, 199991],
  };

  const SPEEDS = [0.5, 1, 2, 4, 8, 16, 40, 120, 400];   // clock edges per second
  const START_IDLE = 2;                                 // cycles with en low after reset
  const HIST = 36;

  let L, hist, journey, rxCur, rxIdx, chkIdx, cnt, playing = false, timer = null,
      pendingInject = false, busy = false;

  // ------------------------------------------------------------- build svg
  function mkCells(groupId, x0, y0, w, h, gap) {
    const g = $(groupId), cells = [];
    for (let i = 0; i < 9; i++) {
      const r = document.createElementNS(SVGNS, 'rect');
      r.setAttribute('x', x0 + i * (w + gap)); r.setAttribute('y', y0);
      r.setAttribute('width', w); r.setAttribute('height', h); r.setAttribute('rx', 3);
      r.setAttribute('class', 'cell c0');
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', x0 + i * (w + gap) + w / 2); t.setAttribute('y', y0 + h / 2);
      t.setAttribute('class', 'celltxt');
      g.appendChild(r); g.appendChild(t); cells.push([r, t]);
    }
    return cells;
  }
  const genCells = mkCells('genCells', 35, 166, 18, 22, 2);
  const chkCells = mkCells('chkCells', 1013, 157, 17, 20, 2);

  // ------------------------------------------------------------- sim control
  const enFor = (cycle) => (cycle >= START_IDLE ? 1 : 0);

  function reset() {
    stop();
    L = new M.Link({ bugNoDelay: $('bug').checked });
    hist = [];
    journey = []; rxCur = null; rxIdx = 0; chkIdx = 0;
    cnt = { inj: 0, inj1: 0, inj2: 0 };
    pendingInject = false;
    $('tokens').innerHTML = '';
    render();
  }

  // One rising edge. Returns the wires that were in force during the cycle.
  function edge() {
    const en = enFor(L.cycle);
    const rate = +$('rate').value;
    let injNext = 0;
    if (en) {
      injNext = pendingInject || (rate > 0 && Math.random() < 1 / rate) ? 1 : 0;
      if (pendingInject) pendingInject = false;
    }
    const w = L.step(en, injNext);
    w.cycleNo = L.cycle - 1;
    w.dec_ph_was = w.dec_ph;
    hist.push(w); if (hist.length > 400) hist.shift();

    // testbench-style injection bookkeeping
    if (en && w.inj) { cnt.inj++; if (w.dec_ph === 0) cnt.inj1++; else cnt.inj2++; }

    // journey: TX side
    if (w.bit_req) {
      journey.push({ k: journey.length, bit: w.tx_bit, req: L.cycle, rx: null, chk: null, lat: null });
    }
    // RX side: what the decoder actually paired up
    if (w.dec_en) {
      if (w.dec_ph === 0) rxCur = { h1: w.hb_rx, hit1: w.inj };
      else if (rxCur) {
        const s = Object.assign(rxCur, { h2: w.hb_rx, hit2: w.inj });
        s.bit = s.h1; s.viol = s.h1 === s.h2;
        const j = journey[rxIdx];
        if (j) { j.rx = s; j.lat = L.cycle - j.req; }
        rxIdx++; rxCur = null;
      }
    }
    if (w.rx_valid) {
      const j = journey[chkIdx];
      if (j) j.chk = !w.locked ? 'fill' : (w.mismatch ? 'err' : 'ok');
      chkIdx++;
    }
    return w;
  }

  function step(n) {
    if (busy) return;
    let w;
    if (n > 1 || stepInterval() < 140) {
      for (let k = 0; k < n; k++) w = edge();
      pulseClock(); if (w.inj) flash();
      render();
      return;
    }
    w = edge();
    busy = true;
    animateTokens(w, Math.min(650, stepInterval() * 0.7), () => {
      busy = false; pulseClock(); if (w.inj) flash(); render();
    });
  }

  const stepInterval = () => 1000 / SPEEDS[+$('speed').value];
  function play() {
    playing = true; $('btnPlay').textContent = '❚❚ Pause';
    const tick = () => {
      if (!playing) return;
      const iv = stepInterval();
      if (iv < 30) { for (let k = 0; k < Math.round(30 / iv); k++) edge(); pulseClock(); render(); }
      else step(1);
      timer = setTimeout(tick, Math.max(iv, 30));
    };
    tick();
  }
  function stop() { playing = false; clearTimeout(timer); $('btnPlay').textContent = '▶ Play'; }

  // ------------------------------------------------------------- tokens
  function animateTokens(w, dur, done) {
    const g = $('tokens'); g.innerHTML = '';
    const jobs = [];
    const tok = (paths, vals) => {
      const el = document.createElementNS(SVGNS, 'g'); el.setAttribute('class', 'token');
      const c = document.createElementNS(SVGNS, 'circle'); c.setAttribute('r', 9);
      const t = document.createElementNS(SVGNS, 'text');
      el.appendChild(c); el.appendChild(t); g.appendChild(el);
      jobs.push({ el, c, t, paths: paths.map((p) => $(p)), vals });
    };
    if (w.bit_req) tok(['w_txbit'], [w.tx_bit]);
    if (w.en || w.dec_en) tok(['w_hbtx', 'w_hbrx'], [w.hb_tx, w.hb_rx]);
    if (w.rx_valid) tok(['w_rxbit'], [w.rx_bit]);
    if (!jobs.length) { setTimeout(done, dur * 0.6); return; }
    const one = css('--one'), zero = css('--zero'), errc = css('--err');
    const t0 = performance.now();
    const frame = (now) => {
      const u = Math.min(1, (now - t0) / dur);
      for (const j of jobs) {
        const n = j.paths.length, seg = Math.min(n - 1, Math.floor(u * n)), su = u * n - seg;
        const p = j.paths[seg], len = p.getTotalLength(), pt = p.getPointAtLength(len * Math.min(1, su));
        j.el.setAttribute('transform', `translate(${pt.x},${pt.y})`);
        const v = j.vals[seg];
        const isErr = seg > 0 && j.vals[seg] !== j.vals[0];
        j.c.setAttribute('fill', isErr ? errc : (v ? one : zero));
        j.t.textContent = v;
      }
      if (u < 1) requestAnimationFrame(frame);
      else { setTimeout(() => { g.innerHTML = ''; }, 120); done(); }
    };
    requestAnimationFrame(frame);
  }
  function pulseClock() {
    for (const id of ['clkA', 'clkTx', 'clkRx']) {
      const e = $(id); if (!e) continue;
      e.classList.remove('pulse'); void e.getBBox(); e.classList.add('pulse');
    }
  }
  function flash() { const f = $('flashInj'); f.classList.remove('on'); void f.getBBox(); f.classList.add('on'); }

  // ------------------------------------------------------------- render
  function setReg(id, v) {
    const r = $('r_' + id), t = $('t_' + id);
    r.setAttribute('class', 'reg' + (v ? ' r1' : '')); t.textContent = v;
    t.style.fill = v ? '#fff' : '';
  }
  function setWire(id, v, hot) {
    const e = $(id); if (!e) return;
    e.setAttribute('class', 'wire ' + (hot ? 'hot' : (v ? 'v1' : 'v0')));
  }
  function setVal(id, v, hot) {
    const e = $(id); e.textContent = v === null ? '' : '= ' + v;
    e.style.fill = hot ? css('--err') : (v ? css('--one') : css('--zero'));
  }

  function render() {
    const enNext = enFor(L.cycle);
    const w = L.wires(enNext);
    const bug = L.bugNoDelay;
    document.getElementById('sim').classList.toggle('bug', bug);

    // LFSRs: bit 8 on the left
    for (let i = 0; i < 9; i++) {
      const gb = (L.gen >> (8 - i)) & 1, cb = (L.chk.lfsr >> (8 - i)) & 1;
      genCells[i][0].setAttribute('class', 'cell ' + (gb ? 'c1' : 'c0'));
      genCells[i][1].textContent = gb; genCells[i][1].style.fill = gb ? '#fff' : css('--muted');
      chkCells[i][0].setAttribute('class', 'cell ' + (cb ? 'c1' : 'c0'));
      chkCells[i][1].textContent = cb; chkCells[i][1].style.fill = cb ? '#fff' : css('--muted');
    }
    setReg('eph', L.enc.ph); setReg('held', L.enc.held); setReg('edout', L.enc.dout);
    setReg('dph', L.dec.ph); setReg('h1', L.dec.h1); setReg('ddout', L.dec.dout);
    setReg('dval', L.dec.dvalid); setReg('dviol', L.dec.viol);
    setReg('pred', w.pred); setReg('err', w.err); setReg('lock', L.chk.locked);
    $('t_fill').textContent = L.chk.locked ? '9/9' : L.chk.fill + '/9';
    $('t_errcnt').textContent = L.chk.err_cnt;
    $('t_bitcnt').textContent = L.chk.bit_cnt;
    $('t_violcnt').textContent = L.viol_cnt;
    $('r_dviol').setAttribute('class', 'reg' + (L.dec.viol ? ' r1' : ''));
    if (L.dec.viol) $('r_dviol').style.fill = css('--err'); else $('r_dviol').style.fill = '';
    if (w.err) $('r_err').style.fill = css('--err'); else $('r_err').style.fill = '';

    setWire('w_txbit', w.tx_bit); setVal('v_txbit', w.tx_bit);
    setWire('w_bitreq', w.bit_req); setVal('v_bitreq', w.bit_req);
    setWire('w_hbtx', w.hb_tx); setVal('v_hbtx', w.hb_tx);
    setWire('w_hbrx', w.hb_rx, w.inj); setVal('v_hbrx', w.hb_rx, w.inj);
    setWire('w_inj', w.inj, w.inj); setVal('v_inj', w.inj, w.inj);
    setWire('w_rxbit', w.rx_bit); setWire('w_rxval', w.rx_valid);
    setWire('w_rxviol', w.rx_viol, w.rx_viol);
    setWire('w_en', w.en); setWire('w_en_enc', w.en); setVal('v_en', w.en);
    setWire('w_end', w.en_d); setVal('v_end', w.en_d);
    $('w_end').classList.toggle('greyed', bug);
    $('endGroup').classList.toggle('greyed', bug);
    $('genFb').setAttribute('class', 'wire ' + (w.tx_bit ? 'v1' : 'v0'));

    // what happens at the next edge
    $('encSays').textContent = !w.en ? 'idle (en = 0)'
      : (L.enc.ph === 0 ? `next edge: take din=${w.tx_bit}, send ${w.tx_bit}` : `next edge: send ~held = ${L.enc.held ^ 1}`);
    $('decSays').textContent = !w.dec_en ? (bug ? 'idle (en = 0)' : 'idle (en_d = 0)')
      : (L.dec.ph === 0 ? `next edge: h1 ← hb_rx (${w.hb_rx})`
        : `next edge: bit=${L.dec.h1}, viol=${L.dec.h1 === w.hb_rx ? 1 : 0}`);

    // stats
    $('sCycle').textContent = L.cycle;
    $('sTx').textContent = L.tx_bit_cnt;
    $('sChk').textContent = L.chk.bit_cnt;
    $('sErr').textContent = L.chk.err_cnt;
    $('sViol').textContent = L.viol_cnt;
    $('sInj').textContent = cnt.inj; $('sInj1').textContent = cnt.inj1; $('sInj2').textContent = cnt.inj2;
    $('sLock').textContent = L.chk.locked ? 'locked' : `filling ${L.chk.fill}/9`;
    $('btnInject').textContent = pendingInject ? '⚡ armed: next half-bit' : '⚡ Flip next half-bit';

    drawWave(w);
    drawJourney();
  }

  // ------------------------------------------------------------- waveform
  const SIGS = [
    ['clk', null], ['en', 'en'], ['en_d', 'en_d'], ['bit_req', 'bit_req'], ['tx_bit', 'tx_bit'],
    ['enc.ph', 'enc_ph'], ['hb_tx', 'hb_tx'], ['err_inject', 'inj', 'err'], ['hb_rx', 'hb_rx'],
    ['dec.ph', 'dec_ph'], ['rx_valid', 'rx_valid'], ['rx_bit', 'rx_bit'], ['rx_viol', 'rx_viol', 'err'],
    ['locked', 'locked'], ['chk err', 'err', 'err'],
  ];
  function sizeCanvas(cv, hCss) {
    const dpr = window.devicePixelRatio || 1, wCss = cv.clientWidth;
    if (cv.width !== Math.round(wCss * dpr) || cv.height !== Math.round(hCss * dpr)) {
      cv.width = Math.round(wCss * dpr); cv.height = Math.round(hCss * dpr);
    }
    cv.style.height = hCss + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [ctx, wCss, hCss];
  }
  function drawWave(cur) {
    const cv = $('wave');
    const rowH = 26, top = 18;
    const [ctx, W, H] = sizeCanvas(cv, top + SIGS.length * rowH + 6);
    const labW = 78, cols = HIST, cw = (W - labW - 6) / cols;
    const data = hist.slice(-(cols - 1)).concat([Object.assign({}, cur, { cycleNo: L.cycle, upcoming: true })]);
    const off = cols - data.length;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px ui-monospace,Consolas,monospace';
    const ink = css('--ink'), muted = css('--muted'), line = css('--line'), acc = css('--accent'),
          errc = css('--err'), warn = css('--warn'), chip = css('--chip');
    // upcoming column
    ctx.fillStyle = chip; ctx.fillRect(labW + (cols - 1) * cw, 0, cw, H);
    // cycle grid + numbers
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
      const x = labW + c * cw; ctx.beginPath(); ctx.moveTo(x + .5, top - 4); ctx.lineTo(x + .5, H); ctx.stroke();
    }
    ctx.fillStyle = muted;
    data.forEach((d, i) => { if (d.cycleNo % 4 === 0) ctx.fillText(String(d.cycleNo), labW + (off + i) * cw + 2, 11); });
    SIGS.forEach(([name, key, kind], r) => {
      const y0 = top + r * rowH, hi = y0 + 5, lo = y0 + rowH - 7;
      ctx.fillStyle = ink; ctx.fillText(name, 4, y0 + rowH / 2 + 3);
      ctx.lineWidth = 1.6;
      if (key === null) {
        ctx.strokeStyle = warn; ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
          const x = labW + (off + i) * cw;
          ctx.moveTo(x, lo); ctx.lineTo(x, hi); ctx.lineTo(x + cw / 2, hi); ctx.lineTo(x + cw / 2, lo); ctx.lineTo(x + cw, lo);
        }
        ctx.stroke(); return;
      }
      let prev = null;
      for (let i = 0; i < data.length; i++) {
        const v = data[i][key] ? 1 : 0, x = labW + (off + i) * cw, y = v ? hi : lo;
        ctx.strokeStyle = (kind === 'err' && v) ? errc : acc;
        if (key === 'rx_bit' && !data[i].rx_valid) ctx.globalAlpha = .35;
        ctx.beginPath();
        if (prev !== null && prev !== y) { ctx.moveTo(x, prev); ctx.lineTo(x, y); } else ctx.moveTo(x, y);
        ctx.lineTo(x + cw, y); ctx.stroke();
        if (v && (kind === 'err')) { ctx.fillStyle = errc; ctx.globalAlpha = .18; ctx.fillRect(x, hi, cw, lo - hi); }
        ctx.globalAlpha = 1;
        prev = y;
      }
    });
  }

  // ------------------------------------------------------------- journey table
  function halves(a, b, h1hit, h2hit) {
    const f = (v, hit) => hit ? `<span class="hit">${v}</span>` : String(v);
    return `${f(a, h1hit)} ${f(b, h2hit)}`;
  }
  function drawJourney() {
    const tb = document.querySelector('#journey tbody');
    const rows = journey.slice(-12).reverse().map((j) => {
      const tx = halves(j.bit, j.bit ^ 1);
      let rx = '<span class="stat">in flight</span>', dec = '', viol = '', chk = '', lat = '';
      if (j.rx) {
        rx = halves(j.rx.h1, j.rx.h2, j.rx.hit1, j.rx.hit2);
        const wrong = j.rx.bit !== j.bit;
        dec = `<span class="${wrong ? 'bad' : 'ok'}">${j.rx.bit}</span>`;
        viol = j.rx.viol ? '<span class="bad">yes</span>' : 'no';
        lat = j.lat + (j.lat === 1 ? ' edge' : ' edges');
      }
      if (j.chk === 'fill') chk = '<span class="stat">lock</span>';
      else if (j.chk === 'ok') chk = '<span class="ok">match</span>';
      else if (j.chk === 'err') {
        // a mismatch on a correctly decoded bit is the checker's echo of an
        // earlier wrong bit passing its taps (lfsr[4] -> k+5, lfsr[8] -> k+9)
        const wrongAt = (i) => journey[i] && journey[i].rx && journey[i].rx.bit !== journey[i].bit;
        const own = j.rx && j.rx.bit !== j.bit;
        const src = [5, 9].map((d) => j.k - d).filter(wrongAt);
        chk = '<span class="bad">mismatch</span>' + (!own && src.length ? `<br><span class="stat">echo of #${src.join(', #')}</span>` : '');
      }
      return `<tr><td class="mono">${j.k}</td><td class="mono">${j.bit}</td><td class="mono">${tx}</td><td class="mono">${rx}</td><td class="mono">${dec}</td><td>${viol}</td><td>${chk}</td><td>${lat}</td></tr>`;
    });
    tb.innerHTML = rows.join('') || '<tr><td colspan="8" class="stat" style="text-align:left">Press Step or Play. en rises after 2 idle cycles.</td></tr>';
  }

  // ------------------------------------------------------------- sweep
  function runSweep() {
    const tb = document.querySelector('#sweepTbl tbody'); tb.innerHTML = '';
    const rates = [0, 100000, 10000, 1000, 100];
    let k = 0, allOk = true; const t0 = performance.now();
    $('btnSweep').disabled = true;
    const next = () => {
      if (k >= rates.length) {
        $('sweepStatus').innerHTML = (allOk ? '<span class="ok">all 5 rows identical to the Verilog run</span>' : '<span class="bad">mismatch</span>')
          + ` · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
        $('btnSweep').disabled = false; return;
      }
      const rate = rates[k++];
      $('sweepStatus').textContent = `running 1-in-${rate || '∞ (clean)'} …`;
      setTimeout(() => {
        const r = M.tb_case(rate);
        const got = [r.injected, r.first, r.second, r.violations, r.prbs_errors, r.checked];
        const ok = got.join() === VERILOG[rate].join(); allOk = allOk && ok;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="mono">${rate || '0 (clean)'}</td>` + got.map((v) => `<td>${v}</td>`).join('')
          + `<td>${r.first ? r.mult.toFixed(2) : '—'}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? '✓ identical' : '✗ ' + VERILOG[rate].join('/')}</td>`;
        tb.appendChild(tr);
        next();
      }, 20);
    };
    next();
  }

  // ------------------------------------------------------------- metastability toy
  let metaSeed = Math.random();
  function rng(seed) { let s = Math.floor(seed * 2 ** 31) | 1; return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) ^ (s + 0x6d2b79f5)) >>> 0) / 4294967296; }
  function drawMeta() {
    const cv = $('meta');
    const [ctx, W, H] = sizeCanvas(cv, 250);
    const ratio = +$('ratio').value, win = +$('win').value;
    const R = rng(metaSeed);
    const Ttx = 1, Trx = Ttx / ratio, span = 46, labW = 78, sx = (W - labW - 8) / span;
    const X = (t) => labW + t * sx;
    const ph0 = R() * Ttx, rph = R() * Trx;
    // async input = Manchester half-bits of the PRBS, changing on tx_clk edges
    const bits = M.prbs_bits(40), hb = [];
    bits.forEach((b) => { hb.push(b, b ^ 1); });
    const hbAt = (t) => { const k = Math.floor((t - ph0) / Ttx); return k < 0 ? 0 : hb[k % hb.length]; };
    const trans = []; for (let k = 1; k < span + 2; k++) if (hb[k % hb.length] !== hb[(k - 1) % hb.length]) trans.push(ph0 + k * Ttx);
    // rx edges, FF1, FF2
    const edges = []; for (let t = rph; t < span; t += Trx) edges.push(t);
    const ff1 = []; let metaN = 0, ff2bad = 0;
    edges.forEach((t) => {
      const near = trans.some((tt) => Math.abs(tt - t) < win * Trx / 2);
      if (near) { metaN++; const tres = Math.min(0.9 * Trx, -Math.log(1 - R() * 0.97) * 0.18 * Trx); ff1.push({ t, meta: true, tres, v: R() < .5 ? 0 : 1 }); }
      else ff1.push({ t, meta: false, v: hbAt(t) });
    });
    const rows = ['tx_clk', 'async_in', 'rx_clk', 'FF1', 'FF2'];
    const rowH = 44, top = 14;
    const ink = css('--ink'), acc = css('--accent'), warn = css('--warn'), errc = css('--err'), muted = css('--muted');
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px ui-monospace,Consolas,monospace';
    rows.forEach((n, r) => { ctx.fillStyle = ink; ctx.fillText(n, 4, top + r * rowH + rowH / 2); });
    const yHi = (r) => top + r * rowH + 6, yLo = (r) => top + r * rowH + rowH - 14;
    // windows
    edges.forEach((t, i) => {
      const hit = ff1[i].meta;
      ctx.fillStyle = hit ? errc : muted; ctx.globalAlpha = hit ? .22 : .08;
      ctx.fillRect(X(t - win * Trx / 2), top, Math.max(1, win * Trx * sx), rowH * 5 - 10);
      ctx.globalAlpha = 1;
    });
    const clock = (r, phase, T, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath();
      for (let t = phase - T; t < span; t += T) {
        const a = X(Math.max(0, t)), b = X(Math.max(0, t + T / 2)), c = X(Math.min(span, t + T));
        if (t >= 0) { ctx.moveTo(a, yLo(r)); ctx.lineTo(a, yHi(r)); } else ctx.moveTo(a, yHi(r));
        ctx.lineTo(b, yHi(r)); ctx.lineTo(b, yLo(r)); ctx.lineTo(c, yLo(r));
      }
      ctx.stroke();
    };
    clock(0, ph0, Ttx, warn); clock(2, rph, Trx, warn);
    // async_in
    ctx.strokeStyle = acc; ctx.lineWidth = 1.6; ctx.beginPath();
    let prevY = null;
    for (let t = 0; t < span; t += 0.02) { const y = hbAt(t) ? yHi(1) : yLo(1); if (prevY === null) ctx.moveTo(X(t), y); else { if (y !== prevY) ctx.lineTo(X(t), prevY); ctx.lineTo(X(t), y); } prevY = y; }
    ctx.stroke();
    // FF1
    let v1 = 0; ctx.beginPath(); ctx.strokeStyle = acc;
    const ff1At = []; // value seen by FF2 at the next edge
    ctx.moveTo(X(0), yLo(3));
    for (let i = 0; i < ff1.length; i++) {
      const e = ff1[i], tEnd = i + 1 < ff1.length ? ff1[i + 1].t : span;
      if (!e.meta) {
        ctx.lineTo(X(e.t), v1 ? yHi(3) : yLo(3)); ctx.lineTo(X(e.t), e.v ? yHi(3) : yLo(3)); ctx.lineTo(X(tEnd), e.v ? yHi(3) : yLo(3));
        v1 = e.v; ff1At.push({ v: e.v, bad: false });
      } else {
        const mid = (yHi(3) + yLo(3)) / 2;
        ctx.lineTo(X(e.t), v1 ? yHi(3) : yLo(3)); ctx.lineTo(X(e.t), mid); ctx.stroke();
        ctx.fillStyle = errc; ctx.globalAlpha = .35;
        ctx.fillRect(X(e.t), yHi(3), e.tres * sx, yLo(3) - yHi(3)); ctx.globalAlpha = 1;
        ctx.strokeStyle = errc; ctx.beginPath(); ctx.moveTo(X(e.t), mid);
        ctx.bezierCurveTo(X(e.t + e.tres * .5), mid, X(e.t + e.tres * .7), e.v ? yHi(3) : yLo(3), X(e.t + e.tres), e.v ? yHi(3) : yLo(3));
        ctx.stroke(); ctx.strokeStyle = acc; ctx.beginPath(); ctx.moveTo(X(e.t + e.tres), e.v ? yHi(3) : yLo(3));
        ctx.lineTo(X(tEnd), e.v ? yHi(3) : yLo(3));
        v1 = e.v; ff1At.push({ v: e.v, bad: e.tres >= Trx });
      }
    }
    ctx.stroke();
    // FF2 = FF1 one rx edge later
    ctx.beginPath(); ctx.strokeStyle = acc; let v2 = 0; ctx.moveTo(X(0), yLo(4));
    for (let i = 1; i < edges.length; i++) {
      const t = edges[i], tEnd = i + 1 < edges.length ? edges[i + 1] : span, v = ff1At[i - 1].v;
      if (ff1At[i - 1].bad) ff2bad++;
      ctx.lineTo(X(t), v2 ? yHi(4) : yLo(4)); ctx.lineTo(X(t), v ? yHi(4) : yLo(4)); ctx.lineTo(X(tEnd), v ? yHi(4) : yLo(4)); v2 = v;
    }
    ctx.stroke();
    const drift = Math.abs(1 - 1 / ratio);
    $('metaStat').innerHTML = `${metaN} FF1 metastable event${metaN === 1 ? '' : 's'} in ${edges.length} rx_clk edges · FF2 ${ff2bad ? '<span class="bad">caught one</span>' : '<span class="ok">clean</span>'} · sample point drifts ${(100 * drift).toFixed(0)} % of a half-bit per cycle → crosses an edge every ≈${Math.round(1 / drift)} cycles without CDR`;
  }

  // ------------------------------------------------------------- wiring
  $('btnReset').onclick = reset;
  $('btnStep').onclick = () => { stop(); step(1); };
  $('btnStepBit').onclick = () => { stop(); step(2); };
  $('btnPlay').onclick = () => (playing ? stop() : play());
  $('btnInject').onclick = () => { pendingInject = true; render(); };
  $('bug').onchange = reset;
  $('real').onchange = () => document.getElementById('diagram').classList.toggle('real', $('real').checked);
  const spd = () => { $('speedLbl').textContent = SPEEDS[+$('speed').value] + ' clk/s'; };
  $('speed').oninput = spd; spd();
  $('btnSweep').onclick = runSweep;
  $('ratio').onchange = drawMeta; $('win').onchange = drawMeta;
  $('btnMeta').onclick = () => { metaSeed = Math.random(); drawMeta(); };
  $('themeBtn').onclick = () => {
    const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    r.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('mlink.theme', r.dataset.theme); } catch (e) {}
    render(); drawMeta();
  };
  try { const t = localStorage.getItem('mlink.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
  window.addEventListener('resize', () => { render(); drawMeta(); });

  reset();
  drawMeta();

  // Deep links, e.g. ?steps=40&rate=8&real=1&bug=1 opens a prepared state.
  const q = new URLSearchParams(location.search);
  if (q.get('bug') === '1') { $('bug').checked = true; reset(); }
  if (q.get('real') === '1') { $('real').checked = true; $('real').onchange(); }
  if (q.get('rate')) $('rate').value = q.get('rate');
  const n = Math.min(100000, parseInt(q.get('steps') || '0', 10) || 0);
  if (n) { for (let k = 0; k < n; k++) edge(); render(); }
  if (q.get('sweep') === '1') runSweep();
})();
