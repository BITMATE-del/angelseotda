# Railway staging: server-authoritative CHECK/FOLD preview turn engine

This branch now saves **CHECK** and **FOLD** decisions in PostgreSQL
(`angel_game_actions`) and derives the next actor exclusively on the server.
A CHECK/FOLD action is authenticated using the signed Telegram session;
the browser cannot choose another actor or inject a new turn seat.

## Rules and invariants

1. The round must already have server-dealt private hands and be in
   `DEALT_PREVIEW`; the room is row-locked on every action.
2. Each player acts at most once in this **non-monetary rehearsal**.
   Historical `PREVIEW_PASS` actions are treated as CHECK.
3. A FOLD immediately excludes its owner from later turns and winner
   computation. The round completes on the last live actor or when only
   one non-folded participant remains.
4. Out-of-turn, duplicate actions, request-ID conflicts, and extra actions
   after terminal completion are rejected server-side.
5. A successful request never updates a wallet, POT, ledger or rake.
   `accepts_bets=false` remains enforced in the DB.
6. The browser receives only seat numbers, never an opponent's private cards.
7. A rollback-only SQL integration audit creates three synthetic accounts,
   executes CHECK, FOLD, CHECK, retries and invalid actions, verifies no
   monetary entries, and rolls back the entire fixture.
8. A five-second client refresh allows multiple authenticated participants
   to see turn/fold results, while retaining pending card selection.

## Still required for a playable full migration

This is not a real betting engine. Real wager rules, repeated calling/raising,
all-in, timed decisions, game-phase transitions, reconciliation, rematches,
side-pot and rake accounting, actual wallet transfers, complete owner/admin
permissions, historical migration and end-to-end Telegram bot access remain
separate production blockers. Do not enable payments or settlement without
integrated real-user tests and production rollback procedures.
