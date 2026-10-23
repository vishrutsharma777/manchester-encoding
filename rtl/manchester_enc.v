// ---------------------------------------------------------------------------
// manchester_enc -- one payload bit becomes two half-bits.
//
//     bit 1  ->  {1, 0}
//     bit 0  ->  {0, 1}
//
// Same convention as the MATLAB link model in eqs-hbc-link/+dut/linkSim.m,
// where a bit is encoded antipodally as [+A -A] or [-A +A]. Two properties
// follow, and both matter for an EQS-HBC link:
//
//   1. The code is DC-free -- every bit carries one rising and one falling
//      edge, so the mean is zero regardless of payload. That is what allows a
//      capacitively-coupled, high-impedance receiver to work at all: there is
//      no DC path through the body channel to carry a baseline.
//
//   2. Detection becomes differential (second half subtracted from the first),
//      which rejects any interferer slow compared to the bit rate. That is why
//      mains hum costs an EQS link far less than switched-mode appliance noise
//      at 40-110 kHz, which sits close enough to the signalling rate to
//      survive the subtraction.
//
// The clock here is the HALF-BIT clock: one payload bit takes two cycles.
// bit_req is asserted on the first half, when din is sampled, so the upstream
// PRBS generator can advance exactly once per payload bit.
// ---------------------------------------------------------------------------
`timescale 1ns/1ps

module manchester_enc (
    input  wire clk,
    input  wire rst_n,
    input  wire en,
    input  wire din,
    output reg  dout,      // half-bit stream
    output wire phase,     // 0 = first half, 1 = second half
    output wire bit_req    // high while din is being consumed
);

    reg ph;
    reg held;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            ph   <= 1'b0;
            held <= 1'b0;
            dout <= 1'b0;
        end else if (en) begin
            if (!ph) begin
                held <= din;      // first half: sample and send as-is
                dout <= din;
            end else begin
                dout <= ~held;    // second half: send the complement
            end
            ph <= ~ph;
        end
    end

    assign phase   = ph;
    assign bit_req = en & ~ph;

endmodule
