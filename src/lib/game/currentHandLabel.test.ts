import { describe, expect, it } from "vitest";
import {
  doriCurrentHandLabel,
  sutda2CurrentHandLabel,
  sutda3CurrentHandLabel,
} from "./currentHandLabel";

describe("현재 최고패 라벨 (표시 전용)", () => {
  it("2장 섯다 — 첫 장만 받은 상태는 판정 대기", () => {
    expect(sutda2CurrentHandLabel([])).toBe("판정 대기");
    expect(sutda2CurrentHandLabel(["03-gwang"])).toBe("판정 대기");
  });

  it("2장 섯다 — 두 장 보유 시 실제 족보", () => {
    expect(sutda2CurrentHandLabel(["03-gwang", "08-gwang"])).toBe("38광땡");
    expect(sutda2CurrentHandLabel(["01-normal", "02-a"])).toBe("알리");
  });

  it("3장 섯다 — 선택 단계 문구와 선택 2장 족보", () => {
    expect(sutda3CurrentHandLabel(["03-gwang", "08-gwang", "02-a"], [], true)).toBe("판정 대기");
    expect(sutda3CurrentHandLabel(["03-gwang", "08-gwang", "02-a"], ["03-gwang"], true)).toBe(
      "1장 더 선택하세요",
    );
    expect(
      sutda3CurrentHandLabel(["03-gwang", "08-gwang", "02-a"], ["03-gwang", "08-gwang"], true),
    ).toBe("38광땡");
  });

  it("3장 섯다 — 선택 전에는 보유 3장 기준 최고 조합", () => {
    expect(sutda3CurrentHandLabel(["03-gwang", "08-gwang", "02-a"])).toBe("38광땡");
    expect(sutda3CurrentHandLabel(["03-gwang", "08-gwang"])).toBe("38광땡");
    expect(sutda3CurrentHandLabel([])).toBe("판정 대기");
  });

  it("도리 — 5장 미완성은 짓기 전", () => {
    expect(doriCurrentHandLabel(["01-normal", "02-a", "03-gwang"])).toBe("짓기 전");
    expect(doriCurrentHandLabel(["01-normal", "02-a", "03-gwang", "04-a"])).toBe("짓기 전");
  });

  it("도리 — 짓기 확정 후에는 남은 2장 족보", () => {
    const cards = ["01-normal", "02-a", "07-a", "05-a", "05-b"];
    expect(doriCurrentHandLabel(cards, ["01-normal", "02-a", "07-a"], ["05-a", "05-b"])).toBe(
      "5땡",
    );
  });

  it("도리 — 짓기 불가 5장은 황", () => {
    expect(doriCurrentHandLabel(["01-normal", "01-gwang", "02-a", "02-b", "03-gwang"])).toBe("황");
  });
});
