// ---------------------------------------------------------------------------
// link_top -- the whole link, minus the channel.
//
//   prbs_gen -> manchester_enc -> [ hb_tx ]  ...  [ hb_rx ] -> manchester_dec
//                                                                    |
//                                                              prbs_check
//
// The half-bit stream is brought out as hb_tx and back in as hb_rx rather than
// wired straight through, so the testbench can corrupt it. Keeping the error
// injection OUTSIDE this module is deliberate: link_top stays synthesisable
// and is the thing you would actually tape out, while the impairment model
// lives in the testbench where it belongs.
//
// Everything runs on a single half-bit clock: one payload bit per two cycles.
// ---------------------------------------------------------------------------
`timescale 1ns/1ps

module link_top #(
    parameter ORDER = 9,
    parameter TAP   = 5
) (
    input  wire        clk,
    input  wire        rst_n,
    input  wire        en,

    output wire        hb_tx,       // transmitted half-bit stream
    input  wire        hb_rx,       // received half-bit stream (possibly corrupted)

    output wire        rx_bit,
    output wire        rx_valid,
    output wire        rx_viol,     // Manchester violation this cycle
    output wire        locked,
    output wire [31:0] err_cnt,     // PRBS mismatches (see multiplication note)
    output wire [31:0] bit_cnt,     // payload bits checked after lock
    output reg  [31:0] viol_cnt,    // illegal Manchester symbols
    output reg  [31:0] tx_bit_cnt   // payload bits transmitted
);

    // ----------------------------------------------------------- transmit
    wire tx_bit;
    wire bit_req;

    prbs_gen #(.ORDER(ORDER), .TAP(TAP)) u_gen (
        .clk   (clk),
        .rst_n (rst_n),
        .en    (bit_req),      // advance exactly once per payload bit
        .dout  (tx_bit)
    );

    manchester_enc u_enc (
        .clk     (clk),
        .rst_n   (rst_n),
        .en      (en),
        .din     (tx_bit),
        .dout    (hb_tx),
        .phase   (),
        .bit_req (bit_req)
    );

    // ----------------------------------------------------------- receive
    //
    // PHASE ALIGNMENT. manchester_enc registers its output, so the first half
    // of the first payload bit does not appear on hb_tx until one cycle after
    // en rises. Enabling the decoder at the same moment as the encoder makes it
    // sample that dead cycle as a first half, and every symbol boundary is then
    // off by one: the decoder compares the second half of bit k against the
    // first half of bit k+1. Those differ whenever consecutive payload bits
    // differ, so roughly half of all symbols are flagged as violations and the
    // data is garbage -- which is exactly the failure this cost one debug pass.
    //
    // Delaying the decoder's enable by one cycle puts it on the right boundary.
    reg en_d;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) en_d <= 1'b0;
        else        en_d <= en;
    end

    manchester_dec u_dec (
        .clk    (clk),
        .rst_n  (rst_n),
        .en     (en_d),
        .din    (hb_rx),
        .dout   (rx_bit),
        .dvalid (rx_valid),
        .viol   (rx_viol)
    );

    prbs_check #(.ORDER(ORDER), .TAP(TAP)) u_chk (
        .clk     (clk),
        .rst_n   (rst_n),
        .en      (rx_valid),
        .din     (rx_bit),
        .locked  (locked),
        .err     (),
        .err_cnt (err_cnt),
        .bit_cnt (bit_cnt)
    );

    // ----------------------------------------------------------- counters
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            viol_cnt   <= 32'd0;
            tx_bit_cnt <= 32'd0;
        end else begin
            if (rx_viol)  viol_cnt   <= viol_cnt   + 32'd1;
            if (bit_req)  tx_bit_cnt <= tx_bit_cnt + 32'd1;
        end
    end

endmodule
