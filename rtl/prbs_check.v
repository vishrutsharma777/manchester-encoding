// ---------------------------------------------------------------------------
// prbs_check -- self-synchronising PRBS checker, the RTL twin of the 'check'
// op in eqs-hbc-link/ber/ber_core.c.
//
// HOW IT LOCKS. The received bits are shifted into the local LFSR, and each
// incoming bit is compared against the one the register predicts. After ORDER
// bits the state is entirely made of received data, so the checker has locked
// to the incoming stream no matter where in the sequence it started. No
// explicit bit-slip search is needed -- which is exactly why real bit-error-
// rate testers are built this way.
//
// The first ORDER bits are consumed by that lock and are excluded from the
// count, so bit_cnt = (bits presented) - ORDER, matching the C reference.
//
// ERROR MULTIPLICATION. A self-synchronising checker counts each isolated
// channel error (number of taps + 1) = 3 times: once when it is compared, and
// again as it passes each of the two feedback taps. This is not a defect, it
// is inherent to the topology, and the testbench asserts the factor is exactly
// 3 at low error rates. It holds only while errors are sparse enough not to
// overlap inside the register, i.e. BER << 1/ORDER.
// ---------------------------------------------------------------------------
`timescale 1ns/1ps

module prbs_check #(
    parameter ORDER = 9,
    parameter TAP   = 5
) (
    input  wire        clk,
    input  wire        rst_n,
    input  wire        en,
    input  wire        din,
    output reg         locked,
    output wire        err,       // high this cycle when prediction mismatches
    output reg  [31:0] err_cnt,
    output reg  [31:0] bit_cnt
);

    reg [ORDER-1:0] lfsr;
    reg [7:0]       fill;

    wire pred     = lfsr[ORDER-1] ^ lfsr[TAP-1];
    wire mismatch = pred ^ din;

    assign err = en & locked & mismatch;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            lfsr    <= {ORDER{1'b0}};
            fill    <= 8'd0;
            locked  <= 1'b0;
            err_cnt <= 32'd0;
            bit_cnt <= 32'd0;
        end else if (en) begin
            // self-sync: shift in the RECEIVED bit, not the predicted one
            lfsr <= {lfsr[ORDER-2:0], din};

            if (!locked) begin
                if (fill == ORDER[7:0] - 8'd1)
                    locked <= 1'b1;
                fill <= fill + 8'd1;
            end else begin
                bit_cnt <= bit_cnt + 32'd1;
                if (mismatch)
                    err_cnt <= err_cnt + 32'd1;
            end
        end
    end

endmodule
