# ANGEL SUTDA — original fee and ttaeng parity, staging only

This is based on the **user-supplied source archive**
`ANGEL_SUTDA_phase2_phase3_reviewed.zip`, in particular:
- `src/lib/gameFeePolicy.ts`
- `supabase/migrations/20261113093100_angel_game_rake.sql`
- `supabase/migrations/20261113093200_angel_ttaeng_escrow.sql`
- `docs/ANGEL_TELEGRAM_GAME_FEE_HANDOFF.md`

These source files are a rule reference only. **Do not connect Supabase**.

## Source-verified policy

1. Game fee: **3% of the final gross winning payout**, not a separate
   charge on each player's stake; only final SETTLED / DONE rounds qualify.
   The original migration rounds to integer game points with **cumulative
   rounding across winners** to prevent duplicate rounding.
2. Affiliate: if a winner has an active referring affiliate, **20% of their
   game fee is accrued** to that affiliate's snapshot ledger. It is *not*
   an automatic wallet payout. No affiliate -> company retains whole fee.
   The charge/deposit fee itself is 0%, and charge commission is 0.
3. Ttaeng applies only to **two-card or three-card Sutda**, never Dori.
   Before a new eligible round, all players must be able to reserve the
   maximum configured liability; if any player cannot, the entire round
   skips ttaeng. No additional retroactive debit may occur.
4. Per losing participant: 1–9 ttaeng **500P**, jang-ttaeng **1000P**,
   gwang-ttaeng / sam-ttaeng **1500P**. The winner's own escrow is
   refunded. The winner receives the sum paid by **other** players,
   with **0% operator fee on the ttaeng transfer**.
5. Ties/rematches, VOID/REFUNDED, normal hand, all opponents folding,
   or any non-final round refund the entire reserved liability.

## Implementation

- `src/lib/railway/originalGameFeePolicy.server.ts`: pure bigint integer
  calculations and explicit fail-closed inputs.
- `src/lib/railway/originalGameFeePolicy.test.ts`: source-parity tests
  for cumulative rounding, 20% affiliate accrual, all ttaeng tiers,
  refund/void/fold, and Dori rejection.
- `src/lib/railway/simulatedShowdown.server.ts`: read-only preview now
  reconstructs gross winning side-pot amounts and applies original
  whole-point fee rounding. Fractional 0.001P *winning gross* is blocked
  under `LEGACY_POINT_PRECISION_REVIEW`, not silently rounded.
  Uncalled overbets are refunded without fee.
- Existing `settlementRollbackAudit.server.ts` remains callable only
  within an isolated, aborting staging PostgreSQL audit; no HTTP routes.

## Still blocked

The current Railway `angel_accounts` schema has no authenticated
affiliate/referral hierarchy. Thus 20% affiliate accrual calculation is
implemented, but **actual identification and ledger snapshot posting are not**.

The ttaeng escrow calculation is implemented, but no real reservation or
transfer is connected to public game actions. Rematch carry-over, Dori
exceptions, and original game's final-round validation still require
end-to-end parity. The original source uses integer points whereas staging
wallets use numeric(20,3), a material launch compatibility issue.

Do not activate real betting, transfer, affiliate payout, or game rake from
this change alone. Preserve original game and current production data.
