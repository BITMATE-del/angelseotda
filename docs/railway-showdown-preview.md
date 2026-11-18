# Railway showdown preview: source-rule bridge (staging only)

The pure module `src/lib/railway/showdownPreview.server.ts` combines the
original game hand evaluators with the provisional, non-mutating side-pot model.
It is **not** connected to a public game API or any money transfer.

## Source rule reuse
- **SUTDA2:** existing `evaluateSutda2` and `contextualScores`.
- **SUTDA3:** requires a verified server-stored, card-owned two-card final
  selection from the original three cards; evaluates that pair using the
  existing `evaluateSutda2` and contextual score logic. No browser rank.
- **DORI:** requires the verified, server-stored three-card make selection
  when a valid make exists, uses `validateDoriMake`, then the existing
  `doriEffectiveRanks`. Impossible make yields the existing HWANG state.
- **Fold win:** one remaining participant qualifies provisionally without
  revealing any private hand.

## Deliberate stop conditions
- The input contains any duplicate/unknown card IDs, duplicate account IDs,
  invalid seats, or inconsistent hand sizes: reject entirely.
- Required final pair or Dori make is not available: `SELECTION_REQUIRED`.
- GUSA / MUNG_GUSA: `SPECIAL_RULE_REVIEW` until the full rematch policy is
  reconciled against legacy settlement functions.
- Tied top-ranked hands or tied side-pot winners: `REMATCH_REQUIRED` and
  **no payouts**.
- Unresolvable side pot or unsupported fee edge cases: `POT_RULE_REVIEW`.
- A successful calculation returns `READY_FOR_REVIEW`, not `SETTLED`, and
  `realSettlement=false`.

## Remaining production blockers

The existing legacy RPCs for rematch/carry-over, selected-hand submission,
Dori special ties, winner confirmation, settlement/void/retry and the
side-pot fee treatment have not yet been ported or fully compared.
Server-owned selection persistence, true betting action state, multi-user
authenticated integration tests, and reconciliation of settled balances
are all required before connecting any monetary endpoint.

**Safety invariant:** staging remains `payments_enabled=false`,
`settlement_enabled=false`, and `accepts_bets=false`. Existing game and
production database remain unchanged.
