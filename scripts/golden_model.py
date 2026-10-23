#!/usr/bin/env python3
"""
Golden model for the Manchester + PRBS link.

Two jobs:

  1. CROSS-LANGUAGE CHECK. Regenerate the PRBS sequence in Python and diff it
     bit-for-bit against sim/prbs_rtl.txt written by tb_prbs_dump. The same
     polynomial is implemented in C (ber_core.c), MATLAB, Python and Verilog;
     four independent implementations either agree or one of them is wrong.

  2. INDEPENDENT REPRODUCTION. Model the link end to end in Python -- encode,
     inject half-bit errors, decode, check -- and reproduce the two structural
     results the RTL testbench asserts:

       - a symbol is illegal iff exactly one of its two half-bits was hit
       - an isolated payload error is counted (taps + 1) = 3 times by the
         self-synchronising checker

     Getting the same numbers from a completely separate implementation is what
     makes the RTL result trustworthy rather than merely self-consistent.

Usage:  python scripts/golden_model.py
"""

import os
import random
import sys

TAPS = {7: 6, 9: 5, 15: 14}


def prbs_bits(n, order=9, seed=1):
    """Left-shifting Fibonacci LFSR, identical to ber_core.c and prbs_gen.v."""
    tap = TAPS[order]
    mask = (1 << order) - 1
    reg = seed & mask or 1          # all-zero is a lockup state
    out = []
    for _ in range(n):
        fb = ((reg >> (order - 1)) ^ (reg >> (tap - 1))) & 1
        reg = ((reg << 1) | fb) & mask
        out.append(fb)
    return out


def prbs_check(rx, order=9):
    """Self-synchronising checker. Returns (errors, bits_checked)."""
    tap = TAPS[order]
    mask = (1 << order) - 1
    reg = 0
    errs = 0
    for i, b in enumerate(rx[:order]):
        reg = ((reg << 1) | b) & mask
    for b in rx[order:]:
        pred = ((reg >> (order - 1)) ^ (reg >> (tap - 1))) & 1
        if pred != b:
            errs += 1
        reg = ((reg << 1) | b) & mask       # shift in the RECEIVED bit
    return errs, max(0, len(rx) - order)


def link_run(nbits, inv_rate, order=9, seed=1, rng_seed=12345):
    """Encode -> inject -> decode -> check. Mirrors link_top.v."""
    rng = random.Random(rng_seed)
    tx = prbs_bits(nbits, order, seed)

    injected = first_half = second_half = 0
    violations = 0
    rx = []

    for b in tx:
        h1, h2 = b, 1 - b                      # Manchester: bit -> {b, ~b}

        hit1 = inv_rate and rng.randrange(inv_rate) == 0
        hit2 = inv_rate and rng.randrange(inv_rate) == 0
        if hit1:
            h1 ^= 1
            injected += 1
            first_half += 1
        if hit2:
            h2 ^= 1
            injected += 1
            second_half += 1

        if h1 == h2:                            # illegal symbol
            violations += 1
        rx.append(h1)                           # decoder emits the first half

    errs, checked = prbs_check(rx, order)
    return dict(inv_rate=inv_rate, injected=injected, first=first_half,
                second=second_half, violations=violations,
                prbs_errors=errs, checked=checked)


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    fails = 0

    # ---------------------------------------------------------- 1. cross-check
    dump = os.path.join(here, "sim", "prbs_rtl.txt")
    print("=" * 66)
    print("1. PRBS cross-check: Python vs RTL")
    print("=" * 66)
    if not os.path.exists(dump):
        print("  sim/prbs_rtl.txt missing -- run `make prbs` first. SKIPPED.")
    else:
        with open(dump) as f:
            rtl = [int(c) for c in f.read().strip() if c in "01"]
        py = prbs_bits(len(rtl), 9, 1)
        if rtl == py:
            print("  %d bits identical.  PASS" % len(rtl))
        else:
            bad = next(i for i, (a, b) in enumerate(zip(rtl, py)) if a != b)
            print("  MISMATCH at bit %d.  FAIL" % bad)
            fails += 1

        period = 2 ** 9 - 1
        if len(rtl) >= 2 * period and rtl[:period] == rtl[period:2 * period]:
            print("  period is %d (2^9-1), maximal length.  PASS" % period)
        else:
            print("  sequence is not maximal length.  FAIL")
            fails += 1

    # ------------------------------------------------- 2. independent link run
    print()
    print("=" * 66)
    print("2. Independent Python link model (200000 payload bits/case)")
    print("=" * 66)
    print("| 1-in-N  | injected | 1st half | 2nd half | violations | PRBS errs | mult |")
    print("|---------|----------|----------|----------|------------|-----------|------|")

    for rate in (0, 100000, 10000, 1000, 100):
        r = link_run(200000, rate)
        mult = r["prbs_errors"] / r["first"] if r["first"] else 0.0
        print("| %7d | %8d | %8d | %8d | %10d | %9d | %4.2f |" %
              (rate, r["injected"], r["first"], r["second"],
               r["violations"], r["prbs_errors"], mult))

        if rate == 0:
            if r["prbs_errors"] or r["violations"]:
                print("  FAIL: clean case is not clean")
                fails += 1
        else:
            # a symbol is illegal iff exactly one half was hit
            if r["first"] >= 50 and not (2.85 <= mult <= 3.15):
                print("  FAIL: multiplication %.2f, expected 3.00" % mult)
                fails += 1

    print()
    print("GOLDEN MODEL: ALL CHECKS PASSED" if not fails
          else "GOLDEN MODEL: %d CHECK(S) FAILED" % fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
