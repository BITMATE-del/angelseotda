# Railway PostgreSQL sandbox debit audit (staging only)

This is **not a playable bet implementation**.

The `applySandboxDebit` primitive in `src/lib/railway/sandboxLedger.server.ts`
has **no public API or browser entry point** and must remain isolated until the
complete wagering and settlement engine is audited. It permits a single
SANDBOX_DEBIT receipt per participant/round and is used only by an automated
database test with an enforced transaction rollback.

## What the rollback audit checks
- A synthetic account begins with 100.000P balance, 20.000P locked.
- One 30.000P debit reduces the balance to 70.000P and increases the round POT to 30.000P.
- The participant contribution, action, receipt and negative ledger entry agree.
- The same request ID does not debit again; changing the actor is rejected.
- A second separate debit by the same participant in that round is rejected.
- The test deliberately throws inside its top-level DB transaction to roll back
  **all inserted accounts, wallets, rounds, and receipts**.
- It then checks there are no remaining synthetic test accounts.

Do not activate a real wagering endpoint based only on these checks. Remaining
work: per-street wager rules, raise/reopen rounds, calls, folds, all-ins,
side-pot contributions, winners, rake, reconciliation and refund/void paths,
multi-user concurrency, real Telegram authentication and external HTTP tests.
The app settings `payments_enabled=false` and `settlement_enabled=false`
and runtime constraint `accepts_bets=false` remain unchanged.
