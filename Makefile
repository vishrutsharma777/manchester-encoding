# Manchester + PRBS link: build and self-check.
#
# Needs iverilog/vvp. Installed here via conda:
#     conda create -n eda -c conda-forge iverilog
#     conda activate eda
# (mingw32-make is on PATH as `mingw32-make`; plain `make` may not be.)
#
# No make at all: python scripts/run_all.py

IV   = iverilog
VVP  = vvp
INC  = -Iinclude
RTL  = rtl/prbs_gen.v rtl/prbs_check.v rtl/manchester_enc.v \
       rtl/manchester_dec.v rtl/link_top.v

.PHONY: all sweep prbs golden matlab waves synth clean

all: sweep prbs golden

sim/tb_link.out: $(RTL) tb/tb_link.v
	@mkdir -p sim docs
	$(IV) -g2005 $(INC) -o $@ $(RTL) tb/tb_link.v

sim/tb_prbs.out: rtl/prbs_gen.v tb/tb_prbs_dump.v
	@mkdir -p sim
	$(IV) -g2005 $(INC) -o $@ rtl/prbs_gen.v tb/tb_prbs_dump.v

sweep: sim/tb_link.out      ## error-injection sweep + self-checks
	$(VVP) $<

prbs: sim/tb_prbs.out       ## dump the RTL PRBS stream for cross-language diff
	$(VVP) $<

golden: prbs                ## Python golden model + PRBS cross-check
	python scripts/golden_model.py

matlab: prbs                ## diff RTL PRBS against the C (MEX) engine
	matlab -batch "addpath('scripts'); compare_with_c"

waves: sim/tb_link.out      ## same sweep, but dump a VCD
	$(VVP) $< +dump
	@echo "wrote sim/tb_link.vcd -- open with gtkwave"

# yosys is not packaged for Windows on conda-forge. For this target install
# the OSS CAD Suite (which also bundles iverilog, gtkwave and make).
synth:                      ## gate count for the link (needs yosys)
	yosys -p "read_verilog $(RTL); synth -top link_top; stat"

clean:
	rm -rf sim/*.out sim/*.vcd sim/*.txt sim/*.csv
