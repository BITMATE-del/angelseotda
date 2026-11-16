---
name: angel-game-ui-design-system
description: ANGEL SUTDA / 도리짓고땡 게임방 UI 디자인 시스템. 게임방 화면(테이블 배경, POT, 좌석 HUD, 버튼, 전통 장식)의 디자인을 만들거나 수정할 때 사용한다. "게임방 UI", "도리짓고땡 디자인", "POT 프레임", "좌석 프레임", "MASTER_REFERENCE", "골드 HUD", "테이블 배경" 등에서 트리거된다.
---

# ANGEL GAME UI DESIGN SYSTEM

게임방 화면의 그래픽은 업로드된 이미지 에셋으로 구성한다. CSS로 다시 그리지 않는다.

## 절대 원칙

1. 골드 프레임, POT 프레임, 좌석 프레임, 전통 문양(구름·학·낙관·모서리), 테이블 배경을 CSS gradient/border/box-shadow로 재현하지 않는다. 이유: 레퍼런스는 회화 톤의 화투 아트이며 CSS 근사치는 필연적으로 싸구려로 보이고, 이미 최종 품질의 에셋이 존재한다.
2. 이미지 = 그래픽 레이어, HTML/CSS = 살아있는 값만. 오버레이 대상은 좌석번호, 칭호/닉네임/계급, 포인트, 아바타, 카드, POT 금액, 상태 텍스트(대기중/준비/올인/다이/짓기 완료), 버튼 라벨뿐이다. 값을 이미지에 굽지 않는다.
3. `MASTER_REFERENCE.jpg`가 최종 시각 기준이다. 배치·크기·비율을 판단할 때 이 이미지를 직접 열어(`code--view`) 확인한다.
4. 게임 로직은 절대 수정하지 않는다 — 섯다 코어/보안/정산, 도리 규칙·베팅·짓기·정산·보안, 서버 RPC, 서비스 계층. 이 스킬의 작업 범위는 프레젠테이션 레이어(컴포넌트 JSX/클래스/스타일)뿐이다. 로직 변경이 필요해 보이면 멈추고 사용자에게 확인한다.
5. 도리 전용 파일만 만진다: `src/routes/dori_.game.$roomId.tsx`, `src/components/game/dori/*`. 섯다 파일(`src/routes/game.$roomId.tsx`, `src/components/game/*` 중 dori 폴더 외)은 사용자가 명시적으로 "섯다에도 적용"이라 지시할 때만 수정한다.
6. 공통화·리팩터링을 이유로 기존 동결 코드를 건드리지 않는다. 프로젝트 기준선(STABLE_1, GAME_SECURITY_1, GAME_ROOM_UX_1, LOGGING_1, DORI_PRODUCTION_1, DATA_ACCESS_1)은 무변경 유지.

## 에셋 카탈로그

경로: `public/assets/game/` → 앱에서는 `/assets/game/<file>`.
프로젝트에 아직 없으면 업로드 ZIP에서 `public/assets/game/`으로 복사한 뒤 사용한다. (게임방 그래픽은 크기가 크고 반복 참조되므로 CDN 에셋 포인터로 옮기는 것도 허용 — 단 경로 상수는 한 곳에 모은다.)

| 파일 | 원본 크기 | 용도 |
| --- | --- | --- |
| `MASTER_REFERENCE.jpg` | 1672×941 | 시각 기준 이미지. 앱에 렌더링하지 않는다. |
| `game-table-bg.webp` | 1672×941 | 게임판 전체 배경(딥그린 테이블 + 나무 프레임 + 등불/꽃). 스테이지 최하단 레이어, `object-cover`. |
| `pot-frame.png` | 1720×826 | 중앙 POT 장식 액자. 내부에 "POT" 라벨 + 금액 텍스트만 얹는다. |
| `pot-coins.png` | 1087×396 | POT 상단 금화 더미. 금액 변화 연출용 별도 레이어. |
| `seat-frame-opponent.png` | 425×215 | 상단·좌·우 상대 좌석 프레임. |
| `seat-frame-self.png` | 585×250 | 하단 내 좌석 프레임(카드 5장 영역 포함, 상대보다 크게). |
| `seat-frame-empty.png` | 409×205 | 빈 좌석 프레임(착석 버튼 자리). |
| `seat-number-badge.png` | 135×155 | 좌석 번호 배지. 프레임 좌상단에 겹치고 안에 번호 텍스트. |
| `dealer-badge.png` | 150×160 | 선(딜러) 표시. |
| `button-gold.png` | 321×118 | 기본/긍정 버튼 배경 — 착석, 준비, 체크, 콜, 레이즈, 올인, 판 시작. |
| `button-red.png` | 307×120 | 위험/취소 버튼 배경 — 다이, 나가기. |
| `cloud-left.png` / `cloud-right.png` | 240×165 | POT 좌우 구름 장식. |
| `corner-left.png` / `corner-right.png` | ~245×170 | 테이블 모서리 장식. |
| `dori-logo.png` | 375×190 | 좌상단 도리짓고땡 로고. |
| `red-stamp.png` | 185×180 | 붉은 낙관 포인트 장식. |
| `center-crane.png` | 342×205 | 테이블 중앙 학 문양(POT 아래 배경 레이어). |

## 레이어 순서

배경(`game-table-bg`) → 모서리/구름/학/로고/낙관 장식 → POT(`center-crane` → `pot-frame` → `pot-coins` → 금액 텍스트) → 좌석 프레임 → 좌석 내부 값·카드 → 버튼 → 결과/토스트.

장식 레이어는 `pointer-events-none`, 값 레이어만 상호작용을 받는다. 좌석 프레임과 그 안의 값은 하나의 relative 컨테이너에 두고, 프레임은 `absolute inset-0` 이미지, 값은 그 위 flex 레이아웃으로 배치한다. 프레임 원본 비율을 유지해야 장식이 뒤틀리지 않으므로 컨테이너 크기는 표의 원본 비율을 따른다.

## 도리 좌석/좌표 (검증 완료 — 유지)

- 스테이지: `DoriGameStage` 1600×900 고정 + uniform scale. 좌석 앵커는 스테이지 중앙 1180×660 safe area 기준(뷰포트 퍼센트 금지).
- 배치: seat1 하단 중앙(본인), seat2 좌측, seat3 상단 중앙, seat4 우측, POT 중앙. 내 좌석이 항상 하단이 되도록 회전(`rotate`)하는 기존 동작 유지.
- POT safe zone 420×240 중앙. 좌석 HUD/카드/액션바와 겹치지 않게 유지.
- safe area는 보이지 않는 좌표 기준일 뿐 — 테두리·배경을 그려 이중 테이블로 보이게 하지 않는다.
- 디자인 변경 후에도 이 배치가 깨지지 않아야 한다.

## 도리 진행 단계 (수정 금지)

`DEALING → BETTING_1(3장) → BETTING_2(4장) → MAKE_SELECTION(5장) → BETTING_FINAL → SHOWDOWN → FINISHED`

UI는 단계별로 무엇을 보이게 할지만 결정한다. 상대의 hidden card, 황 여부, 선택 카드, 족보는 SHOWDOWN 이전에 어떤 형태로도 렌더링하지 않는다(장식·툴팁·aria-label 포함). 상대 카드는 항상 뒷면 장수만.

## 섯다

기존 5인 좌석/2장/3장/베팅/정산/보안 로직 유지. 동일 디자인 시스템은 사용자가 명시적으로 요청할 때만 섯다 게임방에 적용하고, 그때도 로직 파일은 건드리지 않는다.

## 완료 전 검증

1. 실제 게임방을 1920×1080, 1600×900, 1366×768, 1280×720에서 확인하고 resize sweep으로 좌석 튐/overflow 0 확인 (Playwright 스크린샷).
2. 5장 상태에서 카드가 내 좌석 프레임을 넘지 않는지 확인.
3. `bunx vitest run` 전체 PASS + `tsgo` 타입체크 PASS.
4. console error / 신규 SYSTEM_ERROR 0.
5. 변경 파일 목록이 도리 전용 UI 파일 범위 안에 있는지 diff로 확인.

## 목표 톤

딥그린 테이블, 골드 HUD, 중앙 대형 POT, 전통 장식(구름·학·낙관), 큰 화투 카드, 상대보다 확실히 큰 내 좌석. 판단이 갈리면 `MASTER_REFERENCE.jpg`를 다시 열어 비교한다.
