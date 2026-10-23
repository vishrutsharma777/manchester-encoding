function compare_with_c()
%COMPARE_WITH_C Diff the RTL PRBS stream against the C (MEX) engine.
%
%   >> cd manchester-encoding
%   >> scripts/compare_with_c
%
%   Closes the loop on the cross-language check. The same polynomial is
%   implemented four times:
%
%       C       eqs-hbc-link/ber/ber_core.c      (MEX)
%       MATLAB  the plain-loop reference below
%       Python  scripts/golden_model.py
%       Verilog rtl/prbs_gen.v  -> sim/prbs_rtl.txt
%
%   If all four agree bit-for-bit, the specification is pinned down. If they
%   do not, one of them is wrong and the disagreement says which.
%
%   Requires sim/prbs_rtl.txt (run `make prbs` first). The C engine is
%   optional: it is looked for in a clone of eqs-hbc-link next to this repo
%   (run its wirSetup once to build the MEX); without it the script still
%   checks the RTL against a plain MATLAB LFSR.

    here = fileparts(fileparts(mfilename('fullpath')));
    dump = fullfile(here, 'sim', 'prbs_rtl.txt');

    if ~exist(dump, 'file')
        error('compare_with_c:noDump', ...
              'sim/prbs_rtl.txt not found. Run `make prbs` first.');
    end

    txt = fileread(dump);
    txt = txt(txt == '0' | txt == '1');
    rtl = uint8(txt(:)' - '0');
    n   = numel(rtl);
    fprintf('RTL stream: %d bits from %s\n\n', n, dump);

    ORDER = 9;
    TAP   = 5;

    % ---------------------------------------------------- MATLAB reference
    ref = matlabPRBS(n, ORDER, TAP, 1);
    okM = isequal(ref, rtl);
    fprintf('MATLAB reference vs RTL : %s\n', tf(okM));
    if ~okM
        fprintf('   first mismatch at bit %d\n', find(ref ~= rtl, 1));
    end

    % ---------------------------------------------------------- C engine
    % eqs-hbc-link cloned next to this repo, else the original folder layout
    cands = {fullfile(fileparts(here), 'eqs-hbc-link', 'ber'), ...
             fullfile(fileparts(fileparts(here)), 'matlab', 'wireless', ...
                      'wi-r-validation', 'ber')};
    hit = find(cellfun(@(d) exist(fullfile(d, ['ber_core.' mexext]), 'file') > 0, cands), 1);
    if isempty(hit), hit = 1; end
    mexDir = cands{hit};
    okC = [];
    if exist(fullfile(mexDir, ['ber_core.' mexext]), 'file')
        addpath(mexDir);
        cbits = ber_core('gen', ORDER, n, 1);
        okC = isequal(cbits, rtl);
        fprintf('C (MEX) engine  vs RTL  : %s\n', tf(okC));
        if ~okC
            fprintf('   first mismatch at bit %d\n', find(cbits ~= rtl, 1));
        end
    else
        fprintf('C (MEX) engine  vs RTL  : SKIPPED (ber_core not built at %s)\n', mexDir);
    end

    % ------------------------------------------------------ maximal length
    period = 2^ORDER - 1;
    okP = n >= 2*period && isequal(rtl(1:period), rtl(period+1:2*period));
    fprintf('maximal-length period %-3d : %s\n', period, tf(okP));

    fprintf('\n');
    allOk = okM && okP && (isempty(okC) || okC);
    if allOk
        fprintf('ALL IMPLEMENTATIONS AGREE\n');
    else
        error('compare_with_c:mismatch', 'implementations disagree');
    end
end

% ---------------------------------------------------------------------------
function b = matlabPRBS(n, order, tap, seed)
%MATLABPRBS Plain-loop LFSR, deliberately written the slow obvious way so it
%   is an independent reference rather than a restatement of the C.
    mask = uint32(2^order - 1);
    reg  = uint32(seed);
    if reg == 0, reg = uint32(1); end
    b = zeros(1, n, 'uint8');
    for i = 1:n
        fb = bitand(bitxor(bitshift(reg, -(order-1)), ...
                           bitshift(reg, -(tap-1))), uint32(1));
        reg  = bitand(bitshift(reg, 1) + fb, mask);
        b(i) = uint8(fb);
    end
end

% ---------------------------------------------------------------------------
function s = tf(x)
    if x, s = 'PASS'; else, s = 'FAIL'; end
end
