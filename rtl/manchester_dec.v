// ---------------------------------------------------------------------------
// manchester_dec -- two half-bits become one payload bit.
//
// A legal Manchester symbol always has two DIFFERENT halves. If both halves
// arrive equal the symbol is illegal, and viol is raised.
//
// WHY THAT IS USEFUL. Manchester gives error detection for free, with no
// redundancy beyond the coding already needed for DC balance. A single
// corrupted half-bit always produces a violation, so it is flagged even though
// the decoder still has to emit some bit. This makes the violation counter an
// independent check on the PRBS error counter downstream: at low error rates
// the two must agree on how many half-bits were hit, and the testbench
// asserts exactly that.
//
// Alignment is assumed, not recovered: this block does not do clock or frame
// recovery, so it must be started on a symbol boundary. Adding recovery is the
// natural next step and is listed in the README extensions.
// ---------------------------------------------------------------------------
`timescale 1ns/1ps

module manchester_dec (
    input  wire clk,
    input  wire rst_n,
    input  wire en,
    input  wire din,       // half-bit stream
    output reg  dout,
    output reg  dvalid,    // one cycle, on the second half
    output reg  viol       // illegal symbol: both halves equal
);

    reg ph;
    reg h1;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            ph     <= 1'b0;
            h1     <= 1'b0;
            dout   <= 1'b0;
            dvalid <= 1'b0;
            viol   <= 1'b0;
        end else begin
            dvalid <= 1'b0;
            viol   <= 1'b0;
            if (en) begin
                if (!ph) begin
                    h1 <= din;                // first half: remember it
                end else begin
                    dout   <= h1;             // legal symbol -> first half is the bit
                    dvalid <= 1'b1;
                    viol   <= (h1 == din);    // halves equal -> illegal
                end
                ph <= ~ph;
            end
        end
    end

endmodule
