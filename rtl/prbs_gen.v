// ---------------------------------------------------------------------------
// prbs_gen -- Fibonacci LFSR pseudo-random bit sequence generator.
//
// Polynomial x^ORDER + x^TAP + 1, left-shifting, output is the feedback bit.
// This is deliberately bit-for-bit identical to the C reference in
// eqs-hbc-link/ber/ber_core.c:
//
//     fb  = ((reg >> (order-1)) ^ (reg >> (tap-1))) & 1;
//     reg = ((reg << 1) | fb) & mask;
//     out = fb;
//
// so the same sequence can be produced in C, MATLAB, Python and RTL and
// compared. Supported: PRBS7 (7,6), PRBS9 (9,5), PRBS15 (15,14).
//
// The all-zero state is a lockup: it feeds back zero forever. Reset therefore
// loads 1, never 0.
// ---------------------------------------------------------------------------
`timescale 1ns/1ps

module prbs_gen #(
    parameter ORDER = 9,
    parameter TAP   = 5
) (
    input  wire clk,
    input  wire rst_n,
    input  wire en,      // advance one bit
    output wire dout     // combinational from current state
);

    reg [ORDER-1:0] lfsr;

    wire fb = lfsr[ORDER-1] ^ lfsr[TAP-1];

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            lfsr <= {{(ORDER-1){1'b0}}, 1'b1};   // seed 1: avoid lockup
        else if (en)
            lfsr <= {lfsr[ORDER-2:0], fb};
    end

    assign dout = fb;

endmodule
