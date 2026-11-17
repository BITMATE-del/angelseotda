# ANGEL SUTDA — atomic settlement rollback audit (Railway staging)

This module is **NOT a real-money settlement rollout**. It is never called from
HTTP and is not wired to the Telegram Mini App. It only runs inside a test
transaction that explicitly aborts after every validation. A one-time
environment variable `ANGEL_SETTLEMENT_ROLLBACK_AUDIT=1` must be set together
with both Railway staging guards. That flag must NOT be retained on the app
service after the audit.

## Test path

- Create three synthetic accounts and separate synthetic wallets with 100P
  each, then deal server-owned private cards and complete a virtual
  CHECK → PING → CALL → CALL wager phase.
- Verify insufficient **available** wallet balance stops settlement before
  any real POT, receipt, ledger event or payout is recorded.
- Restore the synthetic wallet balance, then perform a single transaction that
  debits 10P from each participant, credits 29.100P to the winner, writes
  30.000P gross POT and 0.900P rake, and records ledger entries.
- Verify the resulting ledger entries add to -0.900P, the total wallet
  decrease is exactly 0.900P, and each participant contribution/payout is
  recorded.
- Replaying the identical round returns the existing receipt without a
  second credit or debit.
- Deliberately throw a rollback sentinel and then query PostgreSQL to
  confirm the synthetic accounts and settlement audit events are absent.
- Every ordinary staging deployment must verify that the audit receipt
  table and its audit ledger event type remain empty.

## Safety and parity restrictions

The hand evaluator comes from the original server-owned logic; the side-pot
and 3% rounding policy is still provisional. Special rematches, 3-card
selection, Dori exceptions, deung-gap, deung-gap value/rake redistribution,
timers, void/refund, rake allocation, production wallet identity and
transaction reconciliation must be confirmed against the original game
before any real settlement is exposed.

The helper is deliberately exported for the isolated test script only. It
**must not** be linked from route handlers, external worker triggers, or a
persistent scheduled task. Never disable staging guards, reuse audit
credentials, or commit a settlement generated from the fake simulation.

This is a development proof of transaction invariants, not a user-facing
functional or monetary authorization test.
