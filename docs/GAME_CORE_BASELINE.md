# ANGEL SUTDA — GAME CORE STABLE BASELINE

- 베이스라인 버전: `STABLE_1` (`app_settings.game_core_version`)
- 동결 기록: `app_settings.game_core_baseline` (검증 항목 PASS 기록 포함)
- 상태 구분: **GAME CORE = READY** / **서비스 전체 PRODUCTION READY = 준비 단계**

## 동결 원칙

1. 검증 완료된 게임 엔진(베팅·정산·사이드팟·재경기·카드 보안)은 재작성하지 않는다.
2. 기능 추가를 이유로 위 로직을 수정하지 않는다.
3. 수정은 **실제 재현된 버그**에 한해 최소 범위로만 한다.
4. TEST DRIVER(`test_driver_enabled`)는 `false` 유지. QA 임시 권한은 사용 후 즉시 회수한다.

## 회귀 보호 (Vitest 68 tests)

- `src/lib/game/handRules.test.ts` — 족보/암행어사/땡잡이/구사 (41)
- `src/lib/game/potInvariants.test.ts` — MAIN/SIDE POT 층 분리, 초과금 반환, 다이 데드머니, 재경기 이월, 자동퇴장 경계 (8)
- `src/lib/services/wallet.test.ts` — 충전 7%/면제권, 출금 0% (6)
- `src/lib/game/cardSecurity.test.ts` — 카드 보안 경계 / RPC allowlist (13, `GAME_SECURITY_1`)

보안 베이스라인은 `docs/GAME_SECURITY_BASELINE.md` (`GAME_SECURITY_1`) 및
경계 정의 `docs/GAME_SECURITY.md` 를 따른다.

`src/lib/game/potInvariants.ts` 는 **참조 구현**이며 정산 권한은 서버 RPC에만 있다.


## 운영 CRITICAL 경고 7종 (관리자 > 시스템 상태)

`admin_critical_alerts()` — 30초 자동 갱신, 관리자 전용.

| 코드 | 의미 |
| --- | --- |
| POT_MISMATCH | 정산 라운드 POT 합계 불일치 (이월 POT 반영) |
| POINT_MISMATCH | 마이너스 잔액 / locked 이상 |
| SETTLEMENT_FAILED | 종료됐지만 정산되지 않은 라운드 (관리자 강제종료 제외) |
| ROUND_STUCK | 5분 이상 진행 정지 라운드 |
| REALTIME_DISCONNECTED | 실시간 구독 테이블 수 |
| USDT_WATCHER_OFFLINE | 자동충전 감시기 (비활성 시 OFF) |
| CRYPTO_CREDIT_ERROR | 자동충전 지급 오류 |

## 운영 전 SMOKE 결과 (실제 로그인 세션 + 실제 서버 RPC, TEST DRIVER 미사용)

- 2장 2인 3판: POT=베팅합, 정산 SETTLED/REMATCH, 무결성 3/3 PASS, 퇴장 LEFT·좌석 0
- 3장 3인 3판: POT=베팅합, 최종 2장 판정, 무결성 3/3 PASS, 퇴장 LEFT·좌석 0
- 회원: 신규 가입 → 로그인 → 프로필/출석/상점/거래내역 정상
- 재무: 최소금액 미달 `MIN_CHARGE_NOT_MET` 거부, USDT 신청 생성/취소, 출금 0% 수수료·포인트 잠금·반려 시 잠금 해제
- 관리자: 경고/상태/무결성 조회, 포인트 지급·회수, 출금 반려, 방 SAFE CLOSE·강제삭제
- 권한: 일반회원·비로그인 관리자 RPC 호출 전부 거부, QA 임시 권한 회수 후 즉시 차단 확인
- 최종 상태: CRITICAL 경고 0건, 무결성 카드/포인트/중복정산 0건

### 알려진 잔여 항목

- 과거 TEST DRIVER 세션의 라운드 1건(POT 4,000P, 지급 0)이 POT 무결성 목록에 남아 있다. 삭제된 테스트 방의 이력이며 현재 엔진에서는 재현되지 않는다.
- Supabase 보안 린터의 SECURITY DEFINER 경고 122건은 기존 상태이며, 각 함수는 내부에서 권한을 검사한다.

## BUGFIX REGRESSION (2026-09-04)

1. 구사 재경기 판정
   - 일반 구사: 최고 정상 족보가 알리(806) 이하일 때만 REMATCH
   - 멍텅구리구사: 최고 정상 족보가 9땡(909) 이하일 때만 REMATCH
   - 조건 미충족 구사는 3끗(103)으로 계산 (장땡/땡/광땡 승리 확정)
   - 회귀 테스트: src/lib/game/gusaRematch.test.ts
2. 잔액 기반 AUTO_ROOM_KICK 시점
   - active round / 미정산 라운드 / rematch_pending 상태에서는 좌석 제거 금지
   - 최종 SETTLED + 재경기 없음 + payout 반영 이후에만 잔액 검사
3. ALL-IN 확인 UI는 전역 portal modal(fixed inset-0)로만 렌더링하며 중복 RPC 호출을 차단한다.

## ALL-IN / REMATCH / AUTO KICK 회귀 기준 (2026-09-04, E2E 검증 완료)

카드/베팅/정산/Realtime 변경 시 아래 9개 기준을 전부 통과해야 GAME CORE = READY 이다.

| # | 기준 | 검증 방법 | 상태 |
| --- | --- | --- | --- |
| 1 | active round 진행 중에는 잔액 0P여도 AUTO_ROOM_KICK 금지 | `enforce_room_balance_eligibility` → `skipped: ROUND_ACTIVE` | PASS |
| 2 | `rematch_pending` 상태에서는 잔액 0P여도 KICK 금지 | `skipped: REMATCH_PENDING`, `trg_round_finished_balance_eligibility` 는 `settlement_status='REMATCH'` 시 early return | PASS |
| 3 | 최종 잔액 검사는 terminal settlement(SETTLED + 재경기 없음 + payout 반영) 이후에만 실행 | 미정산(`settled=false`) 라운드에서 좌석 무변경 | PASS |
| 4 | ALL-IN 승리자는 payout 반영 후 KICK 금지 | CASE C: 20,000P → ALL-IN 19,000P → 0P → POT 42,000 payout → 42,000P, KICK 0 | PASS |
| 5 | ALL-IN 패배자는 terminal SETTLED 이후 최종 0P일 때만 ZERO_BALANCE KICK | CASE D: payout 0 → SETTLED → seat DELETE + `AUTO_ROOM_KICK(ZERO_BALANCE)` 1건 | PASS |
| 6 | REMATCH 는 첫 라운드 payout 0, carry POT 유지, 참가자·좌석·카드·사이드팟 자격 유지 | CASE E: carry 42,000 → 재경기 POT 43,000, 0P ALL-IN 좌석 유지 | PASS |
| 7 | 결과 snapshot 표시 구간(8초) 종료 후 ghost seat 0 | 서버 DELETE 이후 새로고침 없이 좌석 소멸 | PASS |
| 8 | 좌석 제거는 서버 DELETE → Realtime 전파 순서, 모든 접속 세션 즉시 반영, reconnect 후 stale seat 재등장 0 | 2세션 동시 관찰 | PASS |
| 9 | POT/POINT invariant: 버튼 금액 = 잔액 감소 = `game_actions.amount` = POT 증가량, payout 합계 일치 | `potInvariants.test.ts` + 실 DB 확인 | PASS |

### 금지 사항

- 위 기준을 우회하기 위해 잔액 검사 트리거를 삭제하거나 좌석 삭제를 클라이언트에서 수행하는 것
- REMATCH 체인 도중 carry POT 초기화 또는 참가자 재산정
- 결과 공개 구간에서 좌석을 선제 제거하는 것 (ghost/flicker 유발)

### 최종 판정

GAME CORE = READY (STABLE_1 유지, GAME_SECURITY_1 무변경, Vitest 76 PASS)

## 운영 기준선 고정: 좌석 표시 / 입장 검사 / 장기 미접속 (2026-09-04)

아래 4개 동작은 운영 기준선이며 이후 수정 시 회귀 기준으로 유지한다.

| # | 기준 | 구현 위치 | 상태 |
| --- | --- | --- | --- |
| 1 | 장착 CHARACTER 는 게임방 좌석에 실제 반영 (storage path → 조회 URL 해석, 실패 시에만 기본 캐릭터) | `room_loadouts` / `equipped_item_asset`, `useShopImage`, `SeatPortrait` | PASS |
| 2 | 좌석 1줄 = `칭호 \| 닉네임` (칭호 없으면 `칭호없음 \| 닉네임`), 2줄 = 계급, 3줄 = 보유 P. 계급명을 칭호 자리에 쓰지 않는다 | `seatPrefixLabel`, `PlayerSeatHUD` | PASS |
| 3 | 최소입장금은 **입장 시에만** 검사. 입장 후 잔액이 최소금액 미만이어도 강퇴 금지. 최종 정산 후 0P 일 때만 `ZERO_BALANCE` 퇴장 | `join_room`, `enforce_room_balance_eligibility` (`game_points <= 0`) | PASS |
| 4 | DISCONNECTED 상태로 실제 행동 턴 3회 연속 미응답 시 LONG_ABSENCE. 재접속 시 카운트 0 초기화, 좌석 제거는 라운드 종료 후 | `missed_turn_count`, `enforce_turn_timeout`, `game_heartbeat`, `room_table_state.missedTurns`, `seatConnectionLabel` | PASS |

### 금지 사항

- 좌석 표시에서 계급을 칭호로 대체하거나 두 체계를 합치는 것
- 입장 이후 최소입장금 미달을 이유로 좌석을 제거하는 것 (`BELOW_ROOM_MINIMUM` 부활 금지)
- 라운드 진행 중 LONG_ABSENCE 좌석을 즉시 삭제하는 것
- 장착 캐릭터를 raw storage path 로 `<img src>` 에 직접 연결하는 것

### 회귀 기준

- Vitest **83 tests** PASS 를 최소 기준으로 유지한다
  (`handRules 41`, `cardSecurity 13`, `potInvariants 8`, `gusaRematch 8`, `wallet 6`, `seatDisplay 7`)

## SEAT_1 / TURN_ORDER_1 기준선 (좌석번호 · 선 순환)

1. **좌석번호 저장**: `game_room_players.seat` = 1..`game_rooms.max_players`, `unique(room_id, seat)` + `CHECK(seat >= 1)`. 0번 좌석은 존재하지 않는다.
2. **빈자리 착석**: `select_seat(_room_id, _seat)` — 범위 검사, 중복 좌석 차단, `unique_violation` 캐치로 동시 착석 시 1명만 성공.
3. **좌석 이동**: 진행 중인 라운드(`game_rounds.status <> 'finished'`)가 있으면 이미 착석한 사용자의 좌석 이동 금지. WAITING 상태에서만 빈 자리 이동 허용.
4. **퇴장 후 좌석 유지**: 좌석번호는 재배열/당김이 없다. 나간 자리만 EMPTY 로 표시된다(`GameTableLayout` 슬롯 1..max 고정).
5. **선(先) 결정**: 첫 정규판 = 착석자 최소 좌석번호. 이후 정규판 = 좌석번호 순환(빈 좌석 skip, 퇴장한 선은 다음 occupied seat). REMATCH 판은 직전 `dealer_seat` 유지.
6. **카드 지급/첫 action 순서**: `start_game_round` 의 지급 루프와 `current_turn_user_id` 모두 `((seat - dealer_seat + 100) % 100)` 순서.
7. **표시 동기화**: `get_round_state.dealerSeat` 가 유일한 선 기준이며 좌석 HUD 의 `선` 배지에 사용된다(클라이언트 추정 금지).
8. **회귀 테스트**: `src/lib/game/seatOrder.test.ts` 포함 Vitest 91 PASS 를 최소 기준으로 유지한다.
