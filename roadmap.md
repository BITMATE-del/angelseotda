# ANGEL SUTDA 운영(관리자) 보강 로드맵

## GAME CORE 동결 (완료)
- [x] 게임 코어 `STABLE_1` 베이스라인 기록 (`docs/GAME_CORE_BASELINE.md`)
- [x] 운영 CRITICAL 경고 7종 관리자 화면 집계 (30초 자동 갱신)
- [x] POT/사이드팟/이월/자동퇴장 불변식 Vitest 회귀 8건 추가 (총 55건)
- [x] 운영 전 SMOKE: 2장 2인 3판 · 3장 3인 3판 · 회원 · 재무 · 관리자 · 권한 차단
- [x] 모니터링 오탐 교정(이월 POT·다이 카드·강제종료 라운드), 잔여 테스트 방/신청 정리


## 긴급: 2장 상태머신·테이블 겹침 교정
- [x] FIRST_BETTING 완료 후 두 번째 카드 배분을 강제하고 조기 정산 차단
- [x] 명시적 2장 phase transition guard·카드 무결성·SHOWDOWN guard 추가
- [x] DRAW/GUSA/REMATCH를 SHOWDOWN 이후로 제한하고 phase 로그 기록
- [x] POT safe zone, 2인 HUD, 현금다발, REMATCH overlay 겹침 수정
- [ ] 실제 DB 카드 수·phase·action/log 검증 및 브라우저 1366/1600/1920 캡처
- [ ] test01/test02 10판 연속 2장 검증

## Phase 1 — DB/RPC 기반 (진행)
- [ ] profiles 제재 컬럼(suspended_until, chat_banned_until) + 채팅 차단 서버 검증
- [ ] room_event_logs (room_number 기준 영구 로그) + 기록/검색 RPC
- [ ] 방 관리 RPC: admin_list_rooms / admin_room_snapshot / admin_safe_close_room / admin_force_delete_room / stuck room
- [ ] 회원 RPC: 정지·정지해제·채팅금지·해제, 회원정보 수정(username/nickname/telegram/wallet/상태/계급/총판), locked 보정(super)
- [ ] 상점 RPC: items status/sort/images 컬럼 + upsert/상태변경/삭제, 이미지 스토리지 버킷
- [ ] 설정 RPC: 게임/운영/재무/계급/랭킹 설정 저장 + 수수료 합계 검증
- [ ] 관리자 permission 구조(admin_permissions)

## Phase 2 — 관리자 UI
- [ ] 사이드바 독립 스크롤 + 요구 그룹 구조
- [ ] 방 관리(목록/필터/삭제 모달/SAFE CLOSE/FORCE DELETE)
- [ ] 방 번호별 로그 검색 화면
- [ ] 회원 관리(Lv 제거·계급 표시, 정지/채팅금지/포인트/계급/로그 버튼 실동작, 상세 탭)
- [ ] 비밀번호 강제 재설정(서버 전용 Auth Admin)
- [ ] 상점 관리(등록/이미지 업로드/미리보기/판매상태/RARE)
- [ ] 시스템 설정 화면(게임/운영/재무/계급/랭킹)
- [ ] 운영 로그 검색 + BEFORE/AFTER 비교
- [ ] 2단계 확인 모달 / 대량 포인트 경고 / 처리중·성공·실패 표시

## Phase 3 — 실서버 검증
- [ ] 회원 제재·정보변경·비밀번호 재설정 E2E
- [ ] 방 SAFE CLOSE / FORCE DELETE / 로그 검색 E2E
- [ ] 상점 NORMAL/RARE 등록→구매 E2E
- [ ] 권한 공격 테스트 / 기존 기능 회귀 / 1366·1600·1920 메뉴 점검

## 진행 상태 (업데이트)
- [x] 관리자 DB/RPC 기반 migration 적용
- [x] 공통 UI/서비스/서버 비밀번호 재설정 함수
- [x] AdminMembers / AdminRooms / AdminRoomLogs / AdminItems / AdminLogSearch 작성
- [x] admin.tsx 메뉴 그룹화 + 사이드바 독립 스크롤 + 신규 패널 연결 (구 패널 제거)
- [x] 실서버 RPC 검증(조회/정지/채팅금지/정보수정/잠금보정/안전종료/강제삭제/방로그/상품CRUD/RARE제약/수수료합계/권한차단) — 점검 트랜잭션 롤백
- [ ] 관리자 로그인 세션 필요 항목: 브라우저 내 관리자 조작 E2E, 비밀번호 재설정 서버함수 실호출

## 고객센터 · 이벤트 팝업 (진행)
- [ ] 상단 메뉴 고객센터(텔레그램 링크) 추가 — 링크는 관리자에서 설정/수정
- [ ] 관리자 고객센터 설정(@아이디 → https://t.me/... 정규화, 형식 검증)
- [ ] 이벤트 팝업 CRUD(활성/기간/이미지/CTA/우선순위/노출위치) + 오늘 다시 보지 않기(KST)

## DORI JITGO DDAENG (도리짓고땡) V1 — 신규 독립 게임
- [x] 도리 전용 규칙 모듈 `src/lib/game/dori/doriRules.ts` (20장 덱·5장 지급·짓기 10/20/30·땡/끗/황·선 순환·RAISE 3회·사이드팟)
- [x] 도리 규칙 회귀 테스트 24건 (총 139 PASS), 타입체크 PASS
- [x] 상단 메뉴: `게임방` → `섯다 입장` 표시명 변경 + `도리짓고땡 입장` 신설
- [x] `/dori` 입장/가이드 페이지 (게임방법·짓기·족보·베팅)
- [x] 도리 전용 DB 7테이블 + RLS(카드/라운드 클라이언트 직접조회 차단) + 방번호 시퀀스 + Ante 설정
- [ ] 도리 서버 RPC: 방 생성/입장/좌석(1~4)/READY/라운드 시작/카드 지급/내 카드 조회
- [ ] 도리 서버 RPC: `dori_submit_make` 검증, 베팅 엔진(CHECK/BET/CALL/RAISE/FOLD/ALL_IN), 쇼다운·사이드팟 정산
- [ ] `/dori/rooms`, `/dori/game/$roomId` + Dori 전용 UI 컴포넌트(4인 좌석·짓기 선택·베팅바·결과)
- [ ] 도리 Realtime 동기화 + hidden card 감사
- [ ] 실제 4세션 E2E (착석·20장·짓기·쇼다운·정산·선순환·RAISE 3회·ALL-IN·사이드팟·퇴장)

## DORI 4단계 운영 안정화 (완료)
- [x] 관리자 방 모니터링/안전종료/방치 판 정리(전액 환급) RPC + AdminDoriRooms
- [x] Soak 35판 (메모리·중복좌석·음수·POT 불일치 0)
- [x] 끊김/복구 실검증: 자기 턴·짓기 전후·올인·최종베팅·정산 직후·반복 5회·새로고침·2초 지연·3분 장기 미접속
- [x] 좌석 표시 정정(진행 중 / 접속 끊김), 재접속 즉시 heartbeat
- [x] 정상 거부 코드(ALREADY_IN_ANOTHER_ROOM·ROUND_NOT_ACTIVE·좌석계열) EXPECTED_REJECTION 분류
- [x] 로비 "게임으로 돌아가기" (dori_my_active_room)
- [x] 회귀: Vitest 179 PASS + 타입체크 PASS + 불변식 8종 0
- [ ] 운영 주의(미해결 제약): 전원 이탈 시 턴 타임아웃 구동자 없음 → 관리자 방치 판 정리로 처리

## SUTDA 3 CARD PHASE 1 (2026-09-09 중단 — 사용자 요청)
상태: 진행 중 중단. 이전 작업 재작업 필요로 여기서 정지.

### 실제 반영된 변경 (2건, UI 상수/사운드만)
- [x] `src/lib/game/sutda2Layout.ts` — 3장 전용 상수 추가 (2장 상수는 무변경)
  - `SUTDA3_HUD` (상대 470×188 / 본인 700×269, 실제 3장 프레임 에셋 비율 기준)
  - `SUTDA3_SEAT_SLOTS`(십자 4좌석), `SUTDA3_SELF_SLOT`(400,474)
  - 헬퍼 `sutdaHudSpec(cardMode,isMe)`, `sutdaSeatSlots`, `sutdaSelfSlot`
  - POT 좌표(`SUTDA2_POT_BOX`)와 `sutdaCardStep`은 공용 유지
- [x] `src/lib/services/gameSound.ts` — 이벤트 `CARD_THIRD`, `FINAL_SELECT` 추가(기존 sfx 재사용, 기존 매핑 무변경)

### 미착수 (다음 재개 시 작업 목록)
- [ ] `Sutda2SeatHUD` cardMode(2|3) prop화 + 3장 프레임 에셋 분기 + 선택 2장 골드 강조
- [ ] `Sutda2Board` / `Sutda2EmptySeat` cardMode 전달, `GameTableLayout`에서 cardMode 3 분기
- [ ] 3장 최종 승부패 선택 UI (`sutda3/Sutda3HandSelect.tsx`) — 정확히 2장 선택, 3번째 클릭 시 대체, 클라이언트 족보 계산 금지, 기존 `sendFinalHand` 사용
- [ ] 3장 진행단계 로그 (`useSutda2EventLog` mode 대응: 2장 지급 → 1차 베팅 → 세 번째 카드 → 최종 베팅 → 선택 → 쇼다운)
- [ ] 결과 overlay/FX 3장 연결, `sutda_round_result`에 `selectedCards` read-only 확장 검토
- [ ] 실제 2인(test04/test05) 대국 + 1920/1600/1366/1280 회귀 + typecheck/tests

### 조사 결과 메모
- `GameTableLayout.tsx` 337-375 = 2장 board 분기, 380-493 = 3장 legacy grid
- `game.$roomId.tsx`: 817-824 최종선택 조건, 653-664 `sendFinalHand`, 1216-1261 board, 1313-1335 side panel, 1343-1361 result overlay (모두 2장 전용 연결)
- 에셋 크기: opponent-3card 1983×793, self-3card 2022×778
- `game_round_players.selected_cards` jsonb 존재하나 결과 RPC는 미반환
- 기준: 250 tests PASS / typecheck PASS (중단 시점 회귀 미실행)
