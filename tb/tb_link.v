// ---------------------------------------------------------------------------
// tb_link -- error-injection sweep over the Manchester + PRBS link.
//
// The deliverable is not "the link works". It is a measured table that pins
// down three quantitative relationships, each of which is a claim the design
// has to satisfy:
//
//   1. CLEAN CASE IS EXACTLY CLEAN. Zero injected errors must give zero PRBS
//      mismatches and zero Manchester violations -- not "few", zero. Any
//      non-zero count here is a bug in the encoder, decoder or checker
//      alignment, and every other number in the table would be meaningless.
//
//   2. HALF OF ALL HALF-BIT ERRORS ARE HARMLESS. The decoder emits the FIRST
//      half as the payload bit, so corrupting the second half raises a
//      Manchester violation without corrupting data. Only first-half hits
//      actually flip a payload bit. So payload errors ~ injected/2 while
//      violations ~ injected. Manchester is detecting twice as many faults as
//      it is suffering.
//
//   3. THE SELF-SYNCHRONISING CHECKER MULTIPLIES BY THREE. Each isolated
//      payload-bit error is counted (taps + 1) = 3 times by prbs_check, once
//      on comparison and once per feedback tap. Measured here, and asserted
//      against the same factor of 3 measured independently in the C engine in
//      eqs-hbc-link/ber/ber_core.c.
//
// Results are written to docs/link_results.md and sim/link_results.csv so the
// Python and MATLAB golden models can be diffed against them.
// ---------------------------------------------------------------------------
`timescale 1ns/1ps

module tb_link;

    localparam ORDER  = 9;
    localparam TAP    = 5;
    localparam NBITS  = 200000;          // payload bits per case

    reg  clk   = 1'b0;
    reg  rst_n = 1'b0;
    reg  en    = 1'b0;

    wire hb_tx;
    reg  err_inject = 1'b0;
    wire hb_rx = hb_tx ^ err_inject;

    wire        rx_bit, rx_valid, rx_viol, locked;
    wire [31:0] err_cnt, bit_cnt, viol_cnt, tx_bit_cnt;

    link_top #(.ORDER(ORDER), .TAP(TAP)) dut (
        .clk (clk), .rst_n (rst_n), .en (en),
        .hb_tx (hb_tx), .hb_rx (hb_rx),
        .rx_bit (rx_bit), .rx_valid (rx_valid), .rx_viol (rx_viol),
        .locked (locked), .err_cnt (err_cnt), .bit_cnt (bit_cnt),
        .viol_cnt (viol_cnt), .tx_bit_cnt (tx_bit_cnt)
    );

    always #5 clk = ~clk;                // 100 MHz half-bit clock

    // --------------------------------------------------- error injection
    //
    // WHY NOT A PLAIN LFSR HERE. The first version of this testbench drew the
    // injection decision as (lfsr % N == 0) from a left-shifting LFSR. A left
    // shift is a multiply by two, so consecutive states are arithmetically
    // related and 'divisible by N' recurs on adjacent cycles far more often
    // than chance. Adjacent cycles are the two halves of one symbol, and two
    // hits in one symbol cancel into a legal symbol -- so violations came out
    // at a rate-independent 0.74x injections and looked like a decoder bug.
    // It was not: the decoder's count matched the parity model exactly. The
    // impairment source was correlated.
    //
    // $random is specified in IEEE 1364, so it is both decorrelated and
    // reproducible across simulators when seeded explicitly.
    integer seed     = 32'h1234_5678;
    integer inv_rate = 0;                // 0 = no injection, else 1-in-N

    reg [31:0] inj_total, inj_first, inj_second;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            err_inject <= 1'b0;
        end else if (en) begin
            err_inject <= (inv_rate != 0) && ((({$random(seed)}) % inv_rate) == 0);
        end
    end

    // Classify each injected hit by which half-bit it lands on. u_dec.ph holds
    // the phase in force for the half-bit being consumed at this edge.
    always @(posedge clk) begin
        if (rst_n && en && err_inject) begin
            inj_total <= inj_total + 32'd1;
            if (dut.u_dec.ph == 1'b0) inj_first  <= inj_first  + 32'd1;
            else                      inj_second <= inj_second + 32'd1;
        end
    end

    // ---- independent check: how many symbols got an ODD number of hits? ----
    // A symbol is illegal iff exactly one of its two halves was corrupted.
    // Counting that here, from the injection stream alone, gives a reference
    // the decoder's own violation counter must match.
    reg        sym_odd;
    reg [31:0] exp_viol;
    integer    first_err_bit = -1;

    // capture where the first PRBS mismatch lands, for debugging
    always @(posedge clk) begin
        if (rst_n && dut.u_chk.en && dut.u_chk.locked &&
            (dut.u_chk.pred ^ dut.u_chk.din) && first_err_bit < 0)
            first_err_bit = bit_cnt;
    end
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            sym_odd  <= 1'b0;
            exp_viol <= 32'd0;
        end else if (dut.en_d) begin
            if (dut.u_dec.ph == 1'b0)
                sym_odd <= err_inject;
            else if (sym_odd ^ err_inject)
                exp_viol <= exp_viol + 32'd1;
        end
    end

    // --------------------------------------------------------- bookkeeping
    integer fh, fcsv, c;
    integer n_fail = 0;
    real    mult, viol_ratio;

    // per-case captured results
    integer r_inj, r_first, r_second, r_viol, r_err, r_bits, r_expv;

    task run_case (input integer rate);
    begin
        inv_rate  = rate;
        seed      = 32'h1234_5678;       // same stream for every case
        rst_n     = 1'b0;
        en        = 1'b0;
        inj_total = 0; inj_first = 0; inj_second = 0; first_err_bit = -1;
        // Stimulus is driven on the NEGATIVE edge. Driving en/rst_n with a
        // blocking assignment at the posedge races the DUT's own posedge
        // sampling: en_d <= en could capture the new value in the same cycle,
        // collapsing the one-cycle decoder delay and emitting a phantom bit at
        // startup. That cost a debug pass; negedge stimulus removes the race.
        repeat (5) @(negedge clk);
        rst_n = 1'b1;
        @(negedge clk);
        en = 1'b1;

        wait (tx_bit_cnt >= NBITS);
        // Stop only on a symbol boundary. Cutting en mid-symbol leaves the
        // decoder holding half a symbol and emits one bogus payload bit.
        @(negedge clk);
        while (dut.u_enc.ph !== 1'b0) @(negedge clk);
        en = 1'b0;
        repeat (6) @(negedge clk);

        r_inj    = inj_total;
        r_first  = inj_first;
        r_second = inj_second;
        r_viol   = viol_cnt;
        r_expv   = exp_viol;
        r_err    = err_cnt;
        r_bits   = bit_cnt;
    end
    endtask

    initial begin
        if ($test$plusargs("dump")) begin
            $dumpfile("sim/tb_link.vcd");
            $dumpvars(0, tb_link);
        end

        fh   = $fopen("docs/link_results.md", "w");
        fcsv = $fopen("sim/link_results.csv", "w");

        $display("");
        $display("Manchester + PRBS%0d link, error-injection sweep (%0d payload bits/case)",
                 ORDER, NBITS);
        $display("");
        $display("| 1-in-N  | injected | 1st half | 2nd half | violations | PRBS errs | checked | mult |");
        $display("|---------|----------|----------|----------|------------|-----------|---------|------|");

        $fdisplay(fh, "# Manchester + PRBS%0d link: error-injection sweep", ORDER);
        $fdisplay(fh, "");
        $fdisplay(fh, "%0d payload bits per case. `mult` = PRBS errors / first-half hits,",
                  NBITS);
        $fdisplay(fh, "which the self-synchronising checker fixes at taps+1 = 3.");
        $fdisplay(fh, "");
        $fdisplay(fh, "| 1-in-N  | injected | 1st half | 2nd half | violations | PRBS errs | checked | mult |");
        $fdisplay(fh, "|---------|----------|----------|----------|------------|-----------|---------|------|");
        $fdisplay(fcsv, "inv_rate,injected,first_half,second_half,violations,prbs_errors,checked_bits");

        // ------------------------------------------------ the sweep
        for (c = 0; c < 5; c = c + 1) begin
            case (c)
                0: run_case(0);
                1: run_case(100000);
                2: run_case(10000);
                3: run_case(1000);
                4: run_case(100);
            endcase

            mult = (r_first == 0) ? 0.0 : (1.0 * r_err) / (1.0 * r_first);

            $display("| %7d | %8d | %8d | %8d | %10d | %9d | %7d | %4.2f |  expected_viol=%0d",
                     inv_rate, r_inj, r_first, r_second, r_viol, r_err, r_bits, mult, r_expv);
            $fdisplay(fh, "| %7d | %8d | %8d | %8d | %10d | %9d | %7d | %4.2f |",
                     inv_rate, r_inj, r_first, r_second, r_viol, r_err, r_bits, mult);
            $fdisplay(fcsv, "%0d,%0d,%0d,%0d,%0d,%0d,%0d",
                     inv_rate, r_inj, r_first, r_second, r_viol, r_err, r_bits);

            // -------------------------------------------- assertions
            if (c == 0) begin
                if (r_err != 0)
                    $display("  [debug] clean-case first-error bit index = %0d of %0d",
                             first_err_bit, r_bits);
                if (r_err != 0 || r_viol != 0) begin
                    $display("FAIL: clean case is not clean (err=%0d viol=%0d)", r_err, r_viol);
                    n_fail = n_fail + 1;
                end
                if (r_bits < NBITS - 10) begin
                    $display("FAIL: only %0d bits checked, expected ~%0d", r_bits, NBITS);
                    n_fail = n_fail + 1;
                end
            end else begin
                // Structural check: the decoder must flag exactly the symbols
                // that received an odd number of hits. This is exact, not
                // statistical, and it is the real test of the decoder.
                if (r_viol != r_expv) begin
                    $display("FAIL: violations %0d != parity model %0d", r_viol, r_expv);
                    n_fail = n_fail + 1;
                end
                // Statistical check: with decorrelated injection, nearly every
                // hit lands in its own symbol, so violations ~ injected.
                viol_ratio = (r_inj == 0) ? 0.0 : (1.0 * r_viol) / (1.0 * r_inj);
                if (viol_ratio < 0.93 || viol_ratio > 1.02) begin
                    $display("FAIL: violations/injected = %.3f, expected ~1.00", viol_ratio);
                    n_fail = n_fail + 1;
                end
                // Sparse-error multiplication must be 3 -- but only assert it
                // where enough errors accumulated for the ratio to mean
                // anything. With two or three hits the ratio is counting noise.
                if (r_first >= 50) begin
                    if (mult < 2.85 || mult > 3.15) begin
                        $display("FAIL: multiplication %.3f, expected 3.00", mult);
                        n_fail = n_fail + 1;
                    end
                end
            end
        end

        $display("");
        if (n_fail == 0)
            $display("ALL CHECKS PASSED");
        else
            $display("%0d CHECK(S) FAILED", n_fail);
        $display("");

        $fdisplay(fh, "");
        if (n_fail == 0) $fdisplay(fh, "All checks passed."); else $fdisplay(fh, "CHECKS FAILED.");
        $fclose(fh);
        $fclose(fcsv);

        if (n_fail != 0) $fatal(1, "self-check failed");
        $finish;
    end

endmodule
