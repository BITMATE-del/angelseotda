/**
 * 카드 이미지 매핑 감사 — 20장 canonical deck 의 id(card identity) ↔ 이미지 파일이
 * 1:1 로 연결되어 있는지 확인한다. 같은 월의 두 장은 서로 다른 파일이어야 한다.
 * (이미지는 month 가 아니라 반드시 id 기준으로 선택한다)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUTDA_CARDS, SUTDA_CARD_MAP } from "./sutdaCards";
import { cardFaceUrl, FACE_SKINS } from "@/lib/game/cardDeck";
import { SUTDA2_TABLE, tableRowCards } from "@/lib/game/sutda2Rules";

const PUBLIC = join(process.cwd(), "public");
const file = (url: string) => join(PUBLIC, url.replace(/^\//, ""));

describe("카드 identity → 이미지 매핑", () => {
  it("20장 canonical deck", () => {
    expect(SUTDA_CARDS).toHaveLength(20);
    expect(SUTDA_CARD_MAP.size).toBe(20);
  });

  it("모든 카드 이미지 파일이 존재하고 서로 다른 파일을 가리킨다", () => {
    const urls = SUTDA_CARDS.map((c) => c.assetUrl);
    expect(new Set(urls).size).toBe(20);
    for (const c of SUTDA_CARDS) {
      expect(existsSync(file(c.assetUrl)), c.assetUrl).toBe(true);
      expect(c.assetUrl).toContain(`/${c.id}.png`);
    }
  });

  it("같은 월의 두 카드는 서로 다른 이미지 내용을 가진다", () => {
    for (let m = 1; m <= 10; m++) {
      const pair = SUTDA_CARDS.filter((c) => c.month === m);
      expect(pair, `month ${m}`).toHaveLength(2);
      const [a, b] = pair.map((c) => readFileSync(file(c.assetUrl)).toString("base64"));
      expect(a, `month ${m} 두 카드가 동일 이미지`).not.toBe(b);
    }
  });

  it("모든 앞면 스킨에서도 id 기준으로 20장이 각각 다른 파일을 가진다", () => {
    for (const skin of FACE_SKINS) {
      const hashes = SUTDA_CARDS.map((c) => {
        const url = cardFaceUrl(c.id, skin.id);
        expect(existsSync(file(url)), url).toBe(true);
        return readFileSync(file(url)).toString("base64");
      });
      expect(new Set(hashes).size, `${skin.id} 스킨 중복 이미지`).toBe(20);
    }
  });

  it("족보표의 땡 행은 같은 월의 서로 다른 두 카드를 보여준다", () => {
    for (const row of SUTDA2_TABLE.filter((r) => r.category === "ttaeng")) {
      const [a, b] = tableRowCards(row);
      expect(a, row.name).not.toBe(b);
    }
  });
});
