# ANGEL SUTDA — GAME SECURITY BASELINE `GAME_SECURITY_1`

- 보안 베이스라인 버전: `GAME_SECURITY_1` (`app_settings.game_security_version`)
- 동결 기록: `app_settings.game_security_baseline`
- 게임 코어 베이스라인: `STABLE_1` (`docs/GAME_CORE_BASELINE.md`) — 함께 유지된다.
- 경계 정의 문서: `docs/GAME_SECURITY.md` (권한/allowlist/projection/로그 규칙)

## 1. 동결 원칙

1. 카드 보안 관련 코드(테이블 권한, projection RPC, allowlist RPC, 카드 마스킹,
   realtime 구독 대상, TEST DRIVER 격리)는 **실제 재현된 취약점**이 없는 한 수정하지 않는다.
2. 보안 보강을 이유로 STABLE_1 게임 로직(베팅·POT·side pot·정산·재경기·족보)을 변경하지 않는다.
3. 수정이 필요하면 순서를 지킨다: **취약점 재현 → 원인 특정 → 최소 수정 → 회귀 통과**.
4. `app_settings.test_driver_enabled = false` 유지. QA 임시 권한은 사용 즉시 회수한다.
5. 클라이언트에서 카드 셔플/배분/족보 확정/정산을 수행하는 코드를 다시 추가하지 않는다.
   (`src/lib/game/engine.ts` 는 타입 전용 모듈로 동결)

## 2. 필수 회귀 기준 (카드 / 게임방 / Realtime / RPC 수정 시)

아래 항목은 **선택이 아니라 필수**다. 하나라도 실패하면 배포하지 않는다.

| # | 기준 | 명령 / 방법 | 통과 기준 |
| --- | --- | --- | --- |
| 1 | 정적 보안 회귀 + 게임 규칙 회귀 | `bunx vitest run` | **68 tests PASS** |
| 2 | 카드 보안 경계 테스트 | `src/lib/game/cardSecurity.test.ts` (13) | 전부 PASS |
| 3 | 공격형 실 세션 감사 (2장) | `/tmp/smoke/sec_cards.py sutda2` | `TOTAL 33 FAIL 0` |
| 4 | 공격형 실 세션 감사 (3장) | `/tmp/smoke/sec_cards.py sutda3` | `TOTAL 33 FAIL 0` |
| 5 | 게임 플레이 회귀 | `/tmp/smoke/game_smoke.py sutda2 3`, `sutda3 3` | `BAD 0`, 좌석 0 |
| 6 | Realtime payload 감사 | 인증 세션 구독 후 `game_rounds` 프레임 필드 확인 | `deck`/`deck_pos` 및 카드 필드 0건 |
| 7 | 브라우저 감사 | 로그인 세션으로 게임방 진입 후 DOM/localStorage/network/WS 스캔 | 상대 카드 코드 0건 |
| 8 | 타입 안정성 | `tsgo --noEmit` | 오류 0 |
| 9 | 문서 정합성 | `docs/GAME_SECURITY.md` allowlist ↔ 실제 사용 RPC | 불일치 0 (테스트 #2가 검사) |

Vitest 68 구성: 족보 41 + POT 불변식 8 + 지갑 정책 6 + 카드 보안 13.

## 3. `GAME_SECURITY_1` 동결 시점 검증 결과 (실제 서버/실제 로그인 세션)

- 공격형 감사: 2장 33/33 PASS, 3장 33/33 PASS
  (회원 A→B 카드, `game_cards` 직접 접근, deck 예측, 위조 `selected_cards`,
  중복 딜, 관리자/관전자 raw card, 로그 누출 전부 차단)
- Realtime: `game_rounds` 프레임 정상 수신 + `deck`/`deck_pos` 미포함(26 필드)
- 브라우저: DOM/localStorage/sessionStorage/REST/WebSocket 상대 카드 0건, deck 0건
- 게임 회귀: 2장 3판 / 3장 3판 `BAD 0`, POT = 베팅합, 불변식 OK
- Vitest 68 PASS, 타입체크 0 오류

## 4. 알려진 잔여 항목 (CRITICAL 아님)

- Supabase 보안 린터 SECURITY DEFINER 경고 121~122건: 서버 권한 함수 설계상 의도된 형태이며
  각 함수가 내부에서 로그인·역할·참가자·phase를 검사한다. 카드 노출 경로가 아니다.
- 과거 TEST DRIVER 세션 라운드 1건이 POT 무결성 목록에 남아 있다(삭제된 테스트 방 이력).
