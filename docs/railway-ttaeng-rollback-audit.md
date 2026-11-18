# Railway ttaeng escrow — rollback-only verification

This change is **not production authorization**. The prior original game
source paths documented in this project are not present in the current
GitHub feature branch; the existing `originalGameFeePolicy.server.ts`
calculation is therefore provisional until verified against the supplied
original game source. Production parity is NOT certified.

- Migration `db/0009_railway_ttaeng_rollback_audit.sql` adds one audit-only
  escrow table. It is never used by public routes or workers.
- `ttaengEscrowRollbackAudit.server.ts` locks all participants' wallets in
  stable account order. If any member cannot reserve 1500P, it records
  nothing; otherwise it reserves 1500P each in `locked_balance`.
- The audit runner derives the winning hand from server-owned dealt cards,
  releases the holds, and transfers eligible ttaeng bonus to one winner.
  Winner receives no fee deduction; losing members' payments add to the
  winner's bonus exactly. The caller-provided winner is audit-only and is
  **not** a production winner-authorization mechanism.
- The same round cannot resolve twice. The full synthetic transaction
  must throw the intentional rollback sentinel. Following rollback, all
  test accounts, escrow rows and audit ledger events must be absent.
- Regular predeploy schema checks fail if any audit escrow or event persists.

Verification checkpoints expected from Railway predeploy:
`TTAENG_RESERVE_ALL_OR_NONE_PASS`,
`TTAENG_WINNER_TRANSFER_ZERO_SUM_PASS`,
`TTAENG_DOUBLE_RESOLVE_BLOCKED`,
`TTAENG_AUDIT_ROLLBACK_VERIFIED`.

Once confirmed, restore the routine command to
`bun scripts/check-angel-schema.mjs` and keep
`payments_enabled=false`, `settlement_enabled=false`,
`accepts_bets=false`.

The affiliate hierarchy and accrual postings, rematch carry-over rules,
original source parity, real Telegram sessions and integrated production
settlement remain unimplemented.
