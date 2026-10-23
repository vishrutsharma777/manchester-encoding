// ---------------------------------------------------------------------------
// tb_prbs_dump -- dump the RTL PRBS sequence so other languages can diff it.
//
// The point of this file is cross-implementation verification. The same
// polynomial is implemented four times in this codebase:
//
//     C       eqs-hbc-link/ber/ber_core.c         (MEX, 280 Mb/s)
//     MATLAB  reference LFSR in the test suite
//     Python  scripts/golden_model.py
//     Verilog rtl/prbs_gen.v                      (this)
//
// Four independent implementations of one specification agree, or one of them
// is wrong. Writing the RTL stream to a plain text file is the cheapest way to
// settle that, and it needs no cosimulation licence.
// ---------------------------------------------------------------------------
`timescale 1ns/1ps

module tb_prbs_dump;

    localparam ORDER = 9;
    localparam TAP   = 5;
    localparam NBITS = 4096;

    reg  clk   = 1'b0;
    reg  rst_n = 1'b0;
    reg  en    = 1'b0;
    wire dout;

    prbs_gen #(.ORDER(ORDER), .TAP(TAP)) u_gen (
        .clk(clk), .rst_n(rst_n), .en(en), .dout(dout)
    );

    always #5 clk = ~clk;

    integer fh, i;

    initial begin
        fh = $fopen("sim/prbs_rtl.txt", "w");
        repeat (5) @(negedge clk);
        rst_n = 1'b1;
        @(negedge clk);
        en = 1'b1;

        for (i = 0; i < NBITS; i = i + 1) begin
            $fwrite(fh, "%b", dout);
            @(posedge clk);
            @(negedge clk);
        end

        $fclose(fh);
        $display("wrote sim/prbs_rtl.txt (%0d bits of PRBS%0d)", NBITS, ORDER);
        $finish;
    end

endmodule
