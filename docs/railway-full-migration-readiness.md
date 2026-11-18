# ANGEL SUTDA — Supabase → Railway migration readiness
Date: 2026-11-16. Based on the user-provided 900-entry `ANGEL_SUTDA_phase2_phase3_reviewed.zip`, plus the feature branch.

**Do not deploy to production.** Railway staging currently has only an isolated subset of the legacy app. A successful build, preview test, or database install is NOT a complete migration.

## Source dependency inventory
Static search for `supabase.` or an import from the Supabase client in the original source:

| Area | TypeScript/TSX files | Direct Supabase-dependent files |
|---|---:|---:|
| `src/routes` | 17 | 12 |
| `src/lib/services` | 25 | 20 |
| `src/lib/telegram` | 3 | 1 |
| `src/lib/admin` | 1 | 1 |

These counts do not include all transitive imports or background workers, and some files overlap in responsibilities.

## Production-critical systems NOT yet migrated
- Username/password sign-up and recovery, legacy Supabase Auth users, binding/linking the same Telegram user without creating duplicate identities.
- Full 2-card / 3-card / Dori turn and betting state machine, automatic timeouts, dealer rotation, open-card/hand selection, special hands/rematches, fold-win privacy, carry pots and side pots.
- True money movement: wallets, locked amounts, transaction/ledger balancing, charge/withdrawal approval, crypto watcher, payouts, rake, refunds/voids, idempotent workers.
- Room listing, real-time occupancy, reconnects and mobile UX parity for the existing UI.
- Shop/inventory, equipped assets, affiliates, invitation/referral tree, commissions, rankings, notices, customer support, staff/admin role permissions.
- Telegram official bot identity validation, signed Mini App initData, webhook gateway removal and live bot menu.
- Complete multi-user Telegram game sessions, performance/security scans, production migration strategy and rollback plan.

## Railway staging features currently demonstrated
- Isolated PostgreSQL schema, authenticated Telegram session infrastructure
  (actual bot-ID parity and live Telegram authentication still unverified).
- Waiting-room CRUD and serialized room/seat/round preparation.
- Private 20-card server shuffle and own-card read; preview-only turns.
- Read-only betting amount examples and pure side-pot + 3% fee preview.
- Rollback-tested single sandbox debit with no external money movement.
- Original evaluator bridge (Sutda2, user-selected Sutda3, Dori make):
  tie/rematch and GUSA cases are blocked rather than settled.
- New immutable, card-ownership-verified final-hand selections stored in
  PostgreSQL, with rollback audit. No public real settlement.

## Hard launch gate
Do not point `angel-sd.com` or the live Telegram Mini App to the staging service until ALL the above production-critical systems have been implemented, their data/role behavior is verified, security tests pass, and production rollback is prepared. Never enable `payments_enabled` or `settlement_enabled` merely because a calculation-only test passes.
