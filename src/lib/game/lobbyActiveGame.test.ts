/**
 * 로비 "게임으로 복귀" 배너 회귀 테스트 (소스 경계 감사).
 *
 * 실제 재현된 버그: 나가기 예약이 확정되어 서버 좌석(game_room_players)이 DELETE 된 뒤에도
 * 로비 배너가 30초 이상 남아 새로고침해야 사라졌다(stale cache).
 * 배너는 서버 상태(my_active_game)만을 근거로 하고, 좌석 변화 시 즉시 재확인되어야 한다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOBBY = readFileSync(join(process.cwd(), "src/routes/rooms.tsx"), "utf8");
const GAME = readFileSync(join(process.cwd(), "src/routes/game.$roomId.tsx"), "utf8");

describe("lobby return-to-game banner", () => {
  it("배너 근거는 서버 RPC(my_active_game) 결과뿐이다 (localStorage 기반 금지)", () => {
    expect(LOBBY).toContain("fetchMyActiveGame");
    const bannerBlock = LOBBY.slice(LOBBY.indexOf("진행 중인 게임이 있습니다") - 400);
    expect(/localStorage|sessionStorage/.test(bannerBlock)).toBe(false);
  });

  it("활성 게임 조회는 캐시를 붙들지 않고 주기적으로 서버를 다시 확인한다", () => {
    const block = LOBBY.slice(LOBBY.indexOf('"my-active-game"'), LOBBY.indexOf('"my-active-game"') + 400);
    expect(block).toMatch(/refetchInterval:\s*\d+/);
    expect(block).toMatch(/staleTime:\s*0/);
  });

  it("좌석(game_room_players) 변화 시 배너 상태를 즉시 재확인한다", () => {
    expect(LOBBY).toMatch(/table:\s*"game_room_players"/);
    const idx = LOBBY.indexOf('table: "game_room_players"');
    expect(LOBBY.slice(idx, idx + 250)).toContain('queryKey: ["my-active-game"]');
  });

  it("나가기 처리 직후에도 활성 게임 상태를 무효화한다", () => {
    const idx = GAME.indexOf("async function handleLeave");
    expect(idx).toBeGreaterThan(-1);
    expect(GAME.slice(idx, idx + 900)).toContain('"my-active-game"');
  });
});
