# Railway staging: side-pot and POT rake model

This is a **pure calculation preview**. It must not be used to settle a real
member's balance, and the public Telegram page does not call this module.

Files:
- `src/lib/railway/sidePotsPreview.server.ts` — deterministic side pots,
  fold exclusions, uncalled-excess refunds, tie splits and 3% rake
- `src/lib/railway/sidePotsPreview.test.ts` — boundary tests, including
  no-winner rejection and exact milli-point accounting

## Observed source constraints

The legacy `place_bet_action` implementation verifies participant status,
current turn, duplicate action IDs, fold / all-in state, and betting phase.
The legacy `sutda2Rules`, `sutda3Rules`, and `doriRules` contain
different hand selection / contextual comparison logic. No final winner is
accepted from the browser in this staging model.

## Rules requiring parity review before monetary use

- How the existing deployed settlement RPC handles unmatched bets, refunds
  and players who fold
- How it allocates fees to side pots and handles rounding remainders
- How ties, special-hand rematches, Dori make selection and three-card pair
  selection affect eligibility and final rank

The current fee preview implements **3% of the contestable pot rounded down
to 0.001P** with provisional proportional allocation across winning payouts.
Odd milli-point ties go to the lowest numbered seat. This is an explicitly
provisional accounting policy, not claimed to match an uninspected production
settlement RPC.

The invariant always enforced is:
`sum(payouts) + rake === sum(contributions)`.

Database policy remains unchanged:
`payments_enabled=false`, `settlement_enabled=false`, and
`angel_round_runtime.accepts_bets=false`.

No new public API or production deployment is authorized by these tests.
