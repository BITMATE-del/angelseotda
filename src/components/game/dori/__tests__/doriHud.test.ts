/**
 * PHASE 4.1 — HUD 값 해석 회귀 테스트 (프레젠테이션 전용).
 * 서버 dori_room_state 는 장착 아이템을 JSONB {name, assetUrl, itemId} 로 준다.
 */
import { describe, expect, it } from "vitest";
import { equippedAssetUrl, equippedName } from "../DoriSeatHUD";
import { DORI_HUD_LAYOUT, doriCardStep } from "../doriHudLayout";

describe("equipped asset 해석", () => {
  it("JSONB 객체의 assetUrl 을 사용한다", () => {
    expect(equippedAssetUrl({ name: "황금천사", assetUrl: "/characters/golden-angel.jpg", itemId: "x" }))
      .toBe("/characters/golden-angel.jpg");
  });
  it("문자열도 그대로 허용한다", () => {
    expect(equippedAssetUrl("/characters/white-tiger.jpg")).toBe("/characters/white-tiger.jpg");
  });
  it("미장착/빈 값은 null", () => {
    expect(equippedAssetUrl(null)).toBeNull();
    expect(equippedAssetUrl({ name: "칭호", assetUrl: null })).toBeNull();
    expect(equippedAssetUrl("")).toBeNull();
  });
  it("칭호 이름을 JSONB 에서 읽는다", () => {
    expect(equippedName({ name: "천상계", assetUrl: null })).toBe("천상계");
    expect(equippedName("전설")).toBe("전설");
    expect(equippedName(null)).toBe("");
  });
});

describe("HUD 규격", () => {
  it("내 좌석이 상대 좌석보다 크다", () => {
    expect(DORI_HUD_LAYOUT.self.width).toBeGreaterThan(DORI_HUD_LAYOUT.opponent.width);
    expect(DORI_HUD_LAYOUT.self.height).toBeGreaterThan(DORI_HUD_LAYOUT.opponent.height);
  });

  it("INFO 영역과 CARDS 영역이 겹치지 않는다", () => {
    for (const spec of [DORI_HUD_LAYOUT.opponent, DORI_HUD_LAYOUT.self]) {
      const hSep = spec.info.x + spec.info.width <= spec.cards.x;
      const vSep = spec.info.y + spec.info.height <= spec.cards.y;
      expect(hSep || vSep).toBe(true);
    }
  });

  it("카드 3/4/5장이 CARDS 영역을 넘지 않는다", () => {
    for (const spec of [DORI_HUD_LAYOUT.opponent, DORI_HUD_LAYOUT.self]) {
      for (const count of [3, 4, 5]) {
        const step = doriCardStep(count, spec.cards.width, spec.cardWidth);
        const total = spec.cardWidth + step * (count - 1);
        expect(total).toBeLessThanOrEqual(spec.cards.width + 0.01);
      }
    }
  });

  it("모든 영역이 HUD 박스 안에 있다", () => {
    for (const spec of [DORI_HUD_LAYOUT.opponent, DORI_HUD_LAYOUT.self]) {
      for (const area of [spec.avatar, spec.info, spec.cards, spec.status, spec.seatBadge]) {
        expect(area.x + area.width).toBeLessThanOrEqual(spec.width);
        expect(area.y + area.height).toBeLessThanOrEqual(spec.height);
      }
    }
  });
});
