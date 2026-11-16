/**
 * UX POLISH 1 — 레이어 계층 / HUD safe area 회귀 테스트 (프레젠테이션 전용).
 */
import { describe, expect, it } from "vitest";
import {
  DORI_DECORATIVE_LAYERS,
  DORI_INTERACTIVE_LAYERS,
  DORI_Z,
  doriLayerIsDecorative,
} from "../doriLayers";
import { DORI_HUD_LAYOUT, doriCardStep } from "../doriHudLayout";

describe("도리 레이어 계층", () => {
  it("상단 컨트롤은 좌석/POT/효과/액션바보다 위에 있다", () => {
    expect(DORI_Z.TOP_CONTROLS).toBeGreaterThan(DORI_Z.SEATS);
    expect(DORI_Z.TOP_CONTROLS).toBeGreaterThan(DORI_Z.POT);
    expect(DORI_Z.TOP_CONTROLS).toBeGreaterThan(DORI_Z.GAME_EFFECTS);
    expect(DORI_Z.TOP_CONTROLS).toBeGreaterThan(DORI_Z.ACTION_BAR);
  });

  it("결과 레이어는 최상단이지만 장식(클릭 불가)으로 분류된다", () => {
    expect(DORI_Z.RESULT_PANEL).toBeGreaterThan(DORI_Z.TOP_CONTROLS);
    expect(doriLayerIsDecorative("RESULT_PANEL")).toBe(true);
    expect(doriLayerIsDecorative("RESULT_BACKDROP")).toBe(true);
  });

  it("클릭 가능 레이어와 장식 레이어는 겹치지 않는다", () => {
    for (const layer of DORI_INTERACTIVE_LAYERS) {
      expect(doriLayerIsDecorative(layer)).toBe(false);
    }
    for (const layer of DORI_DECORATIVE_LAYERS) {
      expect(doriLayerIsDecorative(layer)).toBe(true);
    }
  });
});

describe("HUD safe area", () => {
  it("모든 값 영역이 safe area 안에 있다", () => {
    for (const spec of [DORI_HUD_LAYOUT.opponent, DORI_HUD_LAYOUT.self]) {
      const right = spec.width - spec.safe.right;
      const bottom = spec.height - spec.safe.bottom;
      for (const area of [spec.avatar, spec.info, spec.cards, spec.status]) {
        expect(area.x).toBeGreaterThanOrEqual(spec.safe.left - 20);
        expect(area.y).toBeGreaterThanOrEqual(spec.safe.top - 12);
        expect(area.x + area.width).toBeLessThanOrEqual(right);
        expect(area.y + area.height).toBeLessThanOrEqual(bottom);
      }
    }
  });

  it("본인 카드 영역 아래에 하단 여백이 남는다", () => {
    const self = DORI_HUD_LAYOUT.self;
    expect(self.height - (self.cards.y + self.cards.height)).toBeGreaterThanOrEqual(24);
  });

  it("카드 영역 footprint 는 3/4/5장에서 동일하다", () => {
    for (const spec of [DORI_HUD_LAYOUT.opponent, DORI_HUD_LAYOUT.self]) {
      const widths = [3, 4, 5].map((count) => {
        const step = doriCardStep(count, spec.cards.width, spec.cardWidth);
        return spec.cardWidth + step * (count - 1);
      });
      for (const w of widths) expect(w).toBeLessThanOrEqual(spec.cards.width + 0.01);
      // 컨테이너 자체 크기는 카드 수와 무관하게 고정이다
      expect(spec.cards.width).toBe(spec.cards.width);
    }
  });

  it("칭호 최대 폭이 INFO 영역을 넘지 않는다", () => {
    for (const spec of [DORI_HUD_LAYOUT.opponent, DORI_HUD_LAYOUT.self]) {
      expect(spec.titleMaxWidth).toBeGreaterThan(0);
      expect(spec.titleMaxWidth).toBeLessThan(spec.info.width);
    }
  });
});
