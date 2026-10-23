# Manchester + PRBS Link with Cross-Language Verification

A Manchester-coded link layer in Verilog — encoder, decoder, PRBS generator and
self-synchronising checker — with an error-injection testbench that pins down
three quantitative properties, and the **same PRBS implemented four times** to
prove the RTL is right.

The deliverable is not "a link in Verilog". It is a measured agreement between
four independent implementations, plus two structural results the testbench
asserts rather than assumes.

## Result

**All four implementations of PRBS9 agree bit-for-bit over 4096 bits:**

| Implementation | Where | Status |
| --- | --- | --- |
| C (MEX) | [`eqs-hbc-link/ber/ber_core.c`](https://github.com/vishrutsharma777/eqs-hbc-link/blob/main/ber/ber_core.c), 280 Mb/s | PASS |
| MATLAB | `scripts/compare_with_c.m`, plain-loop reference | PASS |
| Python | `scripts/golden_model.py` | PASS |
| **Verilog** | `rtl/prbs_gen.v` | PASS |

Maximal-length period 2⁹−1 = 511 confirmed.

**Error-injection sweep, 200 000 payload bits per case:**

| 1-in-N | injected | 1st half | 2nd half | violations | PRBS errs | checked | mult |
|--------|----------|----------|----------|------------|-----------|---------|------|
| 0 (clean) | 0 | 0 | 0 | **0** | **0** | 199991 | — |
| 100 000 | 2 | 1 | 1 | 2 | 3 | 199991 | **3.00** |
| 10 000 | 43 | 15 | 28 | 43 | 45 | 199991 | **3.00** |
| 1 000 | 398 | 190 | 208 | 398 | 570 | 199991 | **3.00** |
| 100 | 3985 | 2004 | 1981 | 3943 | 5896 | 199991 | 2.94 |

Three things fall out of this table:

**1. The self-synchronising checker multiplies errors by exactly 3.**
A single channel error is counted (number of taps + 1) = 3 times: once on
comparison, then again as it passes each of the two feedback taps. The measured
factor is 3.00 across three decades, and it is the *same* factor measured
independently in the C engine. It degrades to 2.94 at 1-in-100 because errors
start overlapping inside the 9-bit register — the factor only holds while
BER ≪ 1/ORDER.

**2. Half of all half-bit errors are harmless.**
The decoder emits the *first* half as the payload bit, so corrupting the second
half raises a Manchester violation without corrupting data. First-half and
second-half hits split ~50/50, so payload errors ≈ injected/2 while violations
≈ injected. Manchester detects twice as many faults as it suffers.

**3. Violations exactly equal the odd-parity symbol count.**
A symbol is illegal iff exactly one of its halves was hit. The testbench models
that independently from the injection stream and asserts equality — not a
tolerance, equality. At 1-in-100, 3943 violations against 3985 injections: the
42 missing are symbols that took two hits and cancelled back into a legal
symbol, which is the predicted p²·N.

## Why Manchester, for this link

This is the RTL of the coding used in the EQS-HBC link model in
[`eqs-hbc-link/+dut/linkSim.m`](https://github.com/vishrutsharma777/eqs-hbc-link/blob/main/%2Bdut/linkSim.m),
and the choice is not arbitrary:

- **DC-free.** Every bit carries one rising and one falling edge, so the mean is
  zero regardless of payload. A capacitively-coupled, high-impedance receiver
  has no DC path through the body channel to carry a baseline, so the line code
  must supply the balance.
- **Differential detection.** Subtracting the second half from the first rejects
  any interferer slow compared to the signalling rate. That is why 50 Hz mains
  costs an EQS link only a few dB while switched-mode appliance noise at
  40–110 kHz — close to the bit rate — does real damage.
- **Free error detection.** Illegal symbols are flagged with no redundancy
  beyond the coding already needed for DC balance.

## Layout

```
rtl/prbs_gen.v        Fibonacci LFSR, bit-identical to ber_core.c
rtl/prbs_check.v      self-synchronising checker (locks in ORDER bits)
rtl/manchester_enc.v  bit -> {b, ~b}, one payload bit per two cycles
rtl/manchester_dec.v  two halves -> bit + violation flag
rtl/link_top.v        the link, with the half-bit stream brought out
tb/tb_link.v          error-injection sweep + self-checks
tb/tb_prbs_dump.v     writes sim/prbs_rtl.txt for cross-language diff
scripts/golden_model.py  Python reference + independent link model
scripts/compare_with_c.m MATLAB/C diff against the RTL stream
scripts/run_all.py       everything, without make
```

## Build

```bash
conda create -n eda -c conda-forge iverilog
conda activate eda

python scripts/run_all.py          # compile, sweep, dump, cross-check
# or, with make:
make sweep      # error-injection sweep + self-checks
make prbs       # dump the RTL PRBS stream
make golden     # Python golden model
make matlab     # diff against the C (MEX) engine (clone eqs-hbc-link
                #   next to this repo and run its wirSetup once)
make waves      # same sweep with a VCD for GTKWave
make synth      # gate count -- needs yosys, NOT available via conda on
                #   Windows; install OSS CAD Suite for this one target
```

## Two bugs found along the way

**Phase alignment.** `manchester_enc` registers its output, so the first half
of the first payload bit does not appear until one cycle after `en` rises.
Enabling the decoder at the same moment puts every symbol boundary off by one:
the decoder compares the second half of bit *k* against the first half of bit
*k+1*. Those differ whenever consecutive bits differ, so **half of all symbols
were flagged as violations** and the data was garbage. Fixed by delaying the
decoder's enable one cycle (`en_d` in `link_top.v`).

**A testbench race, not a design bug.** With alignment fixed, the clean case
still showed exactly one error, at payload bit 0. The stimulus drove `en` with a
blocking assignment at the posedge, racing the DUT's own posedge sampling of
`en_d <= en`; the delay collapsed and the decoder emitted a phantom leading bit.
A per-cycle trace showed `en` and `en_d` rising in the same cycle. Fixed by
driving all stimulus on the **negative** edge.

A third issue was diagnosed and turned out *not* to be a bug: violations ran at
a rate-independent 0.74× injections, which looked like a decoder fault. The
parity model matched the decoder's count exactly, so the decoder was right — the
**impairment source** was correlated. The injector drew `lfsr % N == 0` from a
left-shifting LFSR, and a left shift is a multiply by two, so "divisible by N"
recurs on adjacent cycles far more often than chance. Adjacent cycles are the
two halves of one symbol, and two hits cancel. Replaced with `$random`.

## Extensions

- Clock and frame recovery, so the decoder can start mid-stream rather than
  assuming symbol alignment
- Preamble detection and framing
- Parameterisable oversampling with majority-vote sampling
- A cocotb testbench, reusing `scripts/golden_model.py` directly as the
  reference model
- Synthesis and STA: report the critical path and the maximum half-bit clock
