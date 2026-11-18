# Railway staging virtual wagering — November 17, 2026

This non-monetary phase is explicitly **not a real betting or payout engine**.

## What is implemented
- Authenticated room owner starts a simulated betting phase after cards are dealt.
- All participants see their own **hypothetical** balance and contribution.
- The server computes turn order, allowed actions, pending call/raise responses,
  all-in virtual-balance limits and fold exclusions. Raising reopens actions for
  previously acted participants.
- Actions: die, check, call, ping, ttadang, half, quarter and all_in.
- `angel_wager_simulations` stores only isolated JSON simulation state.
  `angel_wager_sim_actions` stores monotonic revisions and idempotent request IDs.
- Room and round row locks serialize concurrent requests; the browser cannot
  choose the actor, inject a bet amount, or change the wager sample credit.
- A 5-second lobby refresh presents new simulated turn state.

## Fail-closed invariants

Every simulation remains separate from `angel_wallets`, real
`angel_rounds.pot`, `angel_round_players.committed_amount`, ledger events
and real payouts. Existing `accepts_bets=false`, disabled payments and disabled
settlement settings are unchanged. The simulated bankroll is only 10x the
configured room base bet and is NOT spendable currency.

## Verification

- New unit tests exercise raise reopening, matching calls, CHECK/FOLD,
  early all-in restriction, credit ceiling, invalid actor and state termination.
- Railway staging rollback audit creates three synthetic players, performs
  CHECK → PING → CALL → CALL, checks replay and out-of-turn rejection,
  confirms no financial changes, then rolls back the entire fixture.
- A passing audit needs both `WAGER_SIM_DB_AUDIT_PASS` and
  `WAGER_SIM_ROLLBACK_VERIFIED` in Railway pre-deploy logs.

## Still missing before production

True wallet/ledger debits, multiple betting streets, timeout and reconnection
handling, in-round all-in side pots, game-specific actions and minimum bet rules,
winner distribution, 3% POT fees, special dori/sutda ties and rematches,
void/refund paths, admin/affiliate/shopping flows, Telegram multiuser E2E,
production rollback and migration of the original app. The legacy code is
retained for rule comparison, not treated as runtime dependency in staging.
