# Manchester + PRBS9 link: error-injection sweep

200000 payload bits per case. `mult` = PRBS errors / first-half hits,
which the self-synchronising checker fixes at taps+1 = 3.

| 1-in-N  | injected | 1st half | 2nd half | violations | PRBS errs | checked | mult |
|---------|----------|----------|----------|------------|-----------|---------|------|
|       0 |        0 |        0 |        0 |          0 |         0 |  199991 | 0.00 |
|  100000 |        2 |        1 |        1 |          2 |         3 |  199991 | 3.00 |
|   10000 |       43 |       15 |       28 |         43 |        45 |  199991 | 3.00 |
|    1000 |      398 |      190 |      208 |        398 |       570 |  199991 | 3.00 |
|     100 |     3985 |     2004 |     1981 |       3943 |      5896 |  199991 | 2.94 |

All checks passed.
