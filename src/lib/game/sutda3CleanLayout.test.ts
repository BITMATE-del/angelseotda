import { describe, expect, it } from "vitest";
import { SUTDA2_LAYOUT } from "./sutda2CleanLayout";
import { SUTDA3_LAYOUT } from "./sutda3CleanLayout";

/**
 * 3장 섯다 좌표 회귀 — 2장 디자인 유지 + 카드 영역만 3장으로 확장.
 * (게임 로직/규칙과 무관한 프레젠테이션 좌표 검증)
 */
describe("SUTDA3 CLEAN LAYOUT", () => {
  it("2장 좌표는 그대로 유지된다", () => {
    expect(SUTDA2_LAYOUT.cardSlots).toBe(2);
    expect(SUTDA2_LAYOUT.self.width).toBe(630);
    expect(SUTDA2_LAYOUT.opponent.width).toBe(410);
  });

  it("3장은 카드 슬롯 3개를 예약한다", () => {
    expect(SUTDA3_LAYOUT.cardSlots).toBe(3);
  });

  it("stage · POT · progress · bottom bar 는 2장과 동일하다", () => {
    expect(SUTDA3_LAYOUT.stage).toEqual(SUTDA2_LAYOUT.stage);
    expect(SUTDA3_LAYOUT.pot).toEqual(SUTDA2_LAYOUT.pot);
    expect(SUTDA3_LAYOUT.progress).toEqual(SUTDA2_LAYOUT.progress);
    expect(SUTDA3_LAYOUT.bottomBar).toEqual(SUTDA2_LAYOUT.bottomBar);
  });

  it("카드 3장 + 간격이 card zone 안에 들어간다", () => {
    for (const spec of [SUTDA3_LAYOUT.self, SUTDA3_LAYOUT.opponent]) {
      const need = spec.cardWidth * 3 + spec.cardGap * 2;
      expect(need).toBeLessThanOrEqual(spec.cardZone.width);
    }
  });

  it("card zone · status zone 이 HUD 프레임 안에 있고 서로 겹치지 않는다", () => {
    for (const spec of [SUTDA3_LAYOUT.self, SUTDA3_LAYOUT.opponent]) {
      expect(spec.cardZone.x + spec.cardZone.width).toBeLessThanOrEqual(spec.width - 14);
      expect(spec.statusZone.y + spec.statusZone.height).toBeLessThanOrEqual(spec.height);
      expect(spec.infoZone.x + spec.infoZone.width).toBeLessThanOrEqual(spec.cardZone.x);
      expect(spec.avatarZone.x + spec.avatarZone.width).toBeLessThanOrEqual(spec.infoZone.x);
    }
    /** 빈 좌석은 카드 zone 을 쓰지 않으므로 info zone 이 프레임 안에만 있으면 된다 */
    const empty = SUTDA3_LAYOUT.empty;
    expect(empty.infoZone.x + empty.infoZone.width).toBeLessThanOrEqual(empty.width - 14);
  });


  it("좌석 슬롯이 stage 밖으로 나가지 않는다", () => {
    for (const pos of SUTDA3_LAYOUT.opponentSlots) {
      expect(pos.x + SUTDA3_LAYOUT.opponent.width).toBeLessThanOrEqual(SUTDA3_LAYOUT.stage.width);
    }
    expect(SUTDA3_LAYOUT.selfSlot.x + SUTDA3_LAYOUT.self.width).toBeLessThanOrEqual(
      SUTDA3_LAYOUT.stage.width,
    );
    /** self HUD 하단 ~ 액션바 상단 여백 확보 (하단 잘림 방지) */
    expect(SUTDA3_LAYOUT.selfSlot.y + SUTDA3_LAYOUT.self.height).toBeLessThanOrEqual(
      SUTDA3_LAYOUT.bottomBar.y - 20,
    );
  });
});

describe("3장 현재 족보 미리보기 zone (표시 전용)", () => {
  const self = SUTDA3_LAYOUT.self;
  const zone = self.handPreviewZone!;

  it("본인 좌석에만 존재한다 (상대 좌석 없음 · 2장 본인 좌석도 존재)", () => {
    expect(zone).toBeDefined();
    expect(SUTDA3_LAYOUT.opponent.handPreviewZone).toBeUndefined();
    expect(SUTDA2_LAYOUT.opponent.handPreviewZone).toBeUndefined();
    const two = SUTDA2_LAYOUT.self.handPreviewZone!;
    expect(two).toBeDefined();
    expect(two.y).toBeGreaterThanOrEqual(
      SUTDA2_LAYOUT.self.cardZone.y + SUTDA2_LAYOUT.self.cardZone.height,
    );
    expect(two.y + two.height).toBeLessThanOrEqual(SUTDA2_LAYOUT.self.statusZone.y);
  });

  it("카드 zone 바로 아래에 있고 카드와 겹치지 않는다", () => {
    expect(zone.y).toBeGreaterThanOrEqual(self.cardZone.y + self.cardZone.height);
    expect(zone.x).toBe(self.cardZone.x);
    expect(zone.width).toBe(self.cardZone.width);
  });

  it("하단 상태줄과 x·y 어느 쪽으로도 겹치지 않는다", () => {
    const status = self.statusZone;
    const xOverlap = zone.x < status.x + status.width && status.x < zone.x + zone.width;
    const yOverlap = zone.y < status.y + status.height && status.y < zone.y + zone.height;
    expect(xOverlap && yOverlap).toBe(false);
  });

  it("HUD 프레임 안에 들어간다", () => {
    expect(zone.x + zone.width).toBeLessThanOrEqual(self.width);
    expect(zone.y + zone.height).toBeLessThanOrEqual(self.height);
  });
});
