/**
 * GAME SECURITY / ANTI-CHEAT 회귀 테스트 (소스 경계 감사).
 *
 * 실제 DB 권한/세션 공격 테스트는 별도 실세션 E2E에서 수행하고,
 * 여기서는 "클라이언트 번들이 카드 원본에 접근하는 코드를 다시 갖게 되는" 회귀를 막는다.
 * STABLE_1 게임 로직(베팅/POT/정산/족보)은 이 파일에서 다루지 않는다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(p) && !p.endsWith("types.ts")) out.push(p);
  }
  return out;
}

const ALL = files(SRC).map((p) => ({ p, s: readFileSync(p, "utf8") }));
const CODE = ALL.filter((f) => !f.p.endsWith(".test.ts") && !f.p.endsWith(".test.tsx"));

/** 클라이언트가 호출해도 되는 카드 관련 RPC allowlist (WHO/WHEN/WHAT은 docs/GAME_SECURITY.md) */
const CARD_RPC_ALLOWLIST = [
  "get_round_state",
  "get_my_cards",
  // 왕복 최적화 래퍼 — get_round_state + get_my_cards 를 그대로 호출만 한다(마스킹 규칙 동일)
  "get_round_snapshot",
  "select_open_card",
  "select_final_hand",
  "confirm_card_squeeze",
  "set_fold_win_reveal",
  "start_game_round",
  "advance_round_state",
  "place_bet_action",
  "enforce_turn_timeout",
  "settle_round",
  "room_table_state",
  // 2장 섯다 결과 표시 전용 — 정산 확정 후 서버 공개 정책(생존자/폴드승 REVEALED)만 반환
  "sutda_round_result",
  // 관리자 운영 RPC (라운드 카드가 아니라 카드 이미지/에셋·운영 처리)
  "admin_update_card_asset",
  "admin_handle_report",
  "admin_cleanup_test_data",
  "admin_abandoned_rounds",
  "admin_cancel_abandoned_round",
  // 도리짓고땡 전용 RPC (본인 카드만 반환 / 카드 원본 미노출)
  "dori_start_round",
  "dori_place_bet",
  // 정산 확정 후 결과 표시 전용 (지급액·손익·공개 가능한 족보만, 카드 원본 미반환)
  "dori_round_result",
  // 결과 조회 전용 — 서버 공개 정책이 적용된 지난 판 기록만 반환
  "dori_round_history",

  // 관리자 운영: 중단 판 정리 (환급/종료만 수행, 카드 미반환)
  "dori_admin_abort_round",
];

const FORBIDDEN_CARD_RPCS = [
  "deal_next_card",
  "test_seed_round_cards",
  "test_set_points",
  "test_driver_assert",
  "round_player_hand",
];

describe("card table boundaries", () => {
  it("opponent hidden card: no client code reads game_cards directly", () => {
    const hits = CODE.filter((f) => /from\(\s*["'`]game_cards["'`]\s*\)/.test(f.s));
    expect(hits.map((h) => h.p)).toEqual([]);
  });

  it("direct card insert/update: no client mutation of game_cards", () => {
    const hits = CODE.filter((f) => /game_cards[\s\S]{0,80}\.(insert|update|upsert|delete)\(/.test(f.s));
    expect(hits.map((h) => h.p)).toEqual([]);
  });

  it("round player rows are not read directly from the client", () => {
    const hits = CODE.filter((f) => /from\(\s*["'`]game_round_players["'`]\s*\)/.test(f.s));
    expect(hits.map((h) => h.p)).toEqual([]);
  });

  it("deck / deck_pos are never selected (no future-card prediction)", () => {
    const hits = CODE.filter((f) => /select\([^)]*\bdeck(_pos)?\b/.test(f.s));
    expect(hits.map((h) => h.p)).toEqual([]);
  });

  it("game_rounds is never selected with '*' (deck column would be included)", () => {
    const hits = CODE.filter((f) =>
      /from\(\s*["'`]game_rounds["'`]\s*\)[\s\S]{0,200}?\.select\(\s*["'`]\*["'`]\s*\)/.test(f.s),
    );
    expect(hits.map((h) => h.p)).toEqual([]);
  });
});

describe("card rpc surface", () => {
  it("test driver / dealing RPCs are not reachable from the client bundle", () => {
    for (const fn of FORBIDDEN_CARD_RPCS) {
      const hits = CODE.filter((f) => new RegExp(`rpc\\(\\s*["'\`]${fn}["'\`]`).test(f.s));
      expect(hits.map((h) => h.p), `forbidden rpc ${fn}`).toEqual([]);
    }
  });

  it("every card rpc used by the client is on the documented allowlist", () => {
    const used = new Set<string>();
    for (const f of CODE) {
      for (const m of f.s.matchAll(/rpc\(\s*["'`]([a-z0-9_]+)["'`]/g)) used.add(m[1]!);
    }
    const cardish = [...used].filter((fn) =>
      /card|round|deal|hand|deck|seed|squeeze|settle|bet|test_/.test(fn),
    );
    const unknown = cardish.filter((fn) => !CARD_RPC_ALLOWLIST.includes(fn));
    expect(unknown).toEqual([]);
  });
});

describe("no client-side card generation or seeding", () => {
  it("no card seed / forced hand / debug deck path in the app bundle", () => {
    const bad = /(?:force_card|assign_card|set_card|override_card|debug_card|mock_card|fixed_deck|force_hand|card_seed|shuffle_seed|test_card)/;
    const hits = CODE.filter((f) => bad.test(f.s));
    expect(hits.map((h) => h.p)).toEqual([]);
  });

  it("no query-parameter activated card cheat (?seed= / ?cards= / ?test=)", () => {
    const hits = CODE.filter((f) => /searchParams[\s\S]{0,60}(seed|cards|deck|forceHand)/.test(f.s));
    expect(hits.map((h) => h.p)).toEqual([]);
  });

  it("real gameplay never shuffles or deals in the browser", () => {
    const hits = CODE.filter(
      (f) =>
        /Math\.random/.test(f.s) &&
        /(deal|shuffle)\s*\(/.test(f.s) &&
        !f.p.includes("cardDeck") &&
        !f.p.includes("dev."),
    );
    expect(hits.map((h) => h.p)).toEqual([]);
  });
});

describe("no hidden card persistence in the browser", () => {
  it("cards are never written to localStorage / sessionStorage / IndexedDB", () => {
    const hits = CODE.filter((f) =>
      /(localStorage|sessionStorage|indexedDB)\.[a-zA-Z]+\([^)]*(card|deck|hand)/i.test(f.s),
    );
    expect(hits.map((h) => h.p)).toEqual([]);
  });

  it("round state / cards are never console-logged", () => {
    const hits = CODE.filter((f) =>
      /console\.(log|info|debug)\([^)]*(roundState|myCards|cards\b|deck)/.test(f.s),
    );
    expect(hits.map((h) => h.p)).toEqual([]);
  });
});

describe("realtime subscriptions", () => {
  it("no realtime subscription on card-bearing tables", () => {
    const hits = CODE.filter((f) => /table:\s*["'`](game_cards|game_round_players)["'`]/.test(f.s));
    expect(hits.map((h) => h.p)).toEqual([]);
  });
});
