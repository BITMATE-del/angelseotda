# ANGEL SUTDA — GAME SECURITY / ANTI-CHEAT 경계

> **동결 상태: `GAME_SECURITY_1`** — 이 문서는 운영 베이스라인이다.
> 카드/게임방/Realtime/RPC 관련 수정 시 `docs/GAME_SECURITY_BASELINE.md` 의
> 필수 회귀 기준(Vitest 68 + 공격형 감사 33×2 + 플레이 회귀 + Realtime/브라우저 감사)을
> 반드시 통과해야 한다. 실제 재현된 취약점이 없으면 아래 경계 코드를 수정하지 않는다.

STABLE_1 게임 코어(베팅 금액, POT, side pot, 정산, rematch, 족보 우선순위)는
이 문서의 대상이 아니며 보안 보강으로 변경하지 않는다.


## 1. 카드 관련 테이블 권한

| 테이블 | anon | authenticated | 비고 |
| --- | --- | --- | --- |
| `game_cards` | 없음 | 없음 (SELECT/INSERT/UPDATE/DELETE 전부 회수) | 서버 SECURITY DEFINER 함수만 접근 |
| `game_rounds` | 없음 | 컬럼 단위 SELECT (`deck`, `deck_pos` 제외) | realtime payload에서도 덱 제외 |
| `game_round_players` | 없음 | 본인 행 SELECT만 | 상대 `selected_cards`/`hand_code` 차단 |
| `game_actions` | 없음 | SELECT | 카드 정보 없음(금액/턴만) |

## 2. 카드 상태를 바꿀 수 있는 서버 함수 allowlist

| 함수 | WHO | WHEN | WHAT CAN CHANGE |
| --- | --- | --- | --- |
| `start_game_round(_room_id)` | 방 참가자(로그인) | 방 status/READY 조건 충족 시 | 라운드 생성, 서버 셔플 덱 생성, 첫 카드 배분 |
| `deal_next_card(_round_id)` | 내부(service_role)만 | 정해진 phase에서 서버 흐름이 호출 | 다음 카드 1장 배분(덱 순서 고정) |
| `confirm_card_squeeze(_round_id)` | 본인(라운드 참가자) | SQUEEZING | 본인 확인 상태 / phase 전환 |
| `select_open_card(_round_id,_card)` | 본인 | OPEN_CARD_SELECTION | 본인 공개패 1장 지정(본인 보유 카드만) |
| `select_final_hand(_round_id,_c1,_c2)` | 본인 | FINAL_HAND_SUBMIT / HAND_SELECTION | 본인 `selected_cards` (보유·서로 다른 2장만) |
| `advance_round_state(_round_id)` | 라운드 참가자 | 타임아웃/정지 복구 | phase 전환만. 카드 값 변경 없음 |
| `settle_round(_round_id)` | 내부(service_role) | SHOWDOWN | 정산 결과 |

클라이언트가 보낼 수 있는 값은 "행동 의도"와 **본인 보유 카드 코드**뿐이다.
card id/month/variant/deck index/seed/winner는 어떤 함수에서도 클라이언트가 지정할 수 없다.

## 3. 조회 함수(projection)

- `get_my_cards(_round_id)` — 본인 카드만, 현재 규칙상 공개 가능한 순서까지.
- `get_round_state(_round_id)` — 좌석/POT/액션/phase + **공개 규칙을 통과한 카드만**.
  - 상대: 3장방 `open_card` 1장만. 그 외 hidden 0건.
  - SHOWDOWN 이후: FOLD WIN 숨김 선택 시 공개 금지.
  - 3장방 결과: `selected_cards` 2장만.
- `round_player_hand` — SECURITY INVOKER(RLS 적용). 상대 호출 시 권한 거부.

## 4. TEST ONLY RPC

`test_seed_round_cards`, `test_set_points`, `test_driver_assert`, `test_pot_report`

- DB EXECUTE: PUBLIC / anon / authenticated 전부 REVOKE, `service_role`만 허용.
- 함수 내부 2중 방어: 로그인 + `test_driver_enabled=true` + SUPER_ADMIN +
  `is_test_room=true` + 참여자 전원 `is_test_user=true`.
- 현재 `app_settings.test_driver_enabled = false`.

## 5. 보안 이벤트 로그

`log_security_event(code, detail)` → `game_error_logs(fn='SECURITY')`.
허용 코드: `HIDDEN_CARD_ACCESS_ATTEMPT`, `ILLEGAL_CARD_MUTATION`,
`ILLEGAL_CARD_SEED_ATTEMPT`, `INVALID_FINAL_HAND`, `DUPLICATE_DEAL_ATTEMPT`,
`TEST_DRIVER_PRODUCTION_ATTEMPT`. 카드 값은 기록하지 않는다.
