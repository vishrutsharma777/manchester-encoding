#!/usr/bin/env python3
"""
Run everything without make: compile, sweep, dump, cross-check.

    python scripts/run_all.py

Needs iverilog and vvp on PATH. If they are not, this prints where to get them
rather than failing with a confusing OS error.
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RTL = ["rtl/prbs_gen.v", "rtl/prbs_check.v", "rtl/manchester_enc.v",
       "rtl/manchester_dec.v", "rtl/link_top.v"]


def need(tool):
    if shutil.which(tool) is None:
        print("ERROR: '%s' not found on PATH." % tool)
        print("Install with:  conda create -n eda -c conda-forge iverilog")
        print("Then:          conda activate eda")
        sys.exit(2)


def run(cmd, **kw):
    print("$ " + " ".join(cmd))
    r = subprocess.run(cmd, cwd=HERE, **kw)
    if r.returncode != 0:
        sys.exit(r.returncode)


def main():
    need("iverilog")
    need("vvp")
    os.makedirs(os.path.join(HERE, "sim"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "docs"), exist_ok=True)

    print("\n=== 1/3  error-injection sweep ===")
    run(["iverilog", "-g2005", "-Iinclude", "-o", "sim/tb_link.out"]
        + RTL + ["tb/tb_link.v"])
    run(["vvp", "sim/tb_link.out"])

    print("\n=== 2/3  dump RTL PRBS stream ===")
    run(["iverilog", "-g2005", "-o", "sim/tb_prbs.out",
         "rtl/prbs_gen.v", "tb/tb_prbs_dump.v"])
    run(["vvp", "sim/tb_prbs.out"])

    print("\n=== 3/3  Python golden model + cross-check ===")
    run([sys.executable, "scripts/golden_model.py"])

    print("\nAll stages completed.")
    print("For the C/MATLAB diff as well:")
    print("  matlab -batch \"addpath('scripts'); compare_with_c\"")


if __name__ == "__main__":
    main()
