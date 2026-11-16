/**
 * 데이터 조회 권한 회귀 테스트.
 * DB에서 이미 컬럼 권한이 차단되어 있지만, 클라이언트가 민감 컬럼을 다시 요청하는
 * 회귀(=화면 오류)를 소스 단계에서 막는다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GAME_ROOM_COLUMNS } from "./roomColumns";

const SRC = join(process.cwd(), "src");

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(p) && !p.endsWith("types.ts") && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const CODE = files(SRC).map((p) => ({ p, s: readFileSync(p, "utf8") }));

describe("game room column whitelist", () => {
  it("password_hash is not part of the client column list", () => {
    expect(GAME_ROOM_COLUMNS).not.toContain("password_hash");
  });

  it("no client code selects game_rooms with '*'", () => {
    const hits = CODE.filter((f) =>
      /from\(\s*["'`]game_rooms["'`]\s*\)[\s\S]{0,200}?\.select\(\s*["'`]\*["'`]\s*\)/.test(f.s),
    );
    expect(hits.map((h) => h.p)).toEqual([]);
  });

  it("no client code requests password_hash", () => {
    const hits = CODE.filter((f) => /password_hash/.test(f.s) && !f.p.endsWith("roomColumns.ts"));
    expect(hits.map((h) => h.p)).toEqual([]);
  });

  it("no client code requests entry_balance_snapshot (seat balance)", () => {
    const hits = CODE.filter((f) => /entry_balance_snapshot/.test(f.s));
    expect(hits.map((h) => h.p)).toEqual([]);
  });

  it("no client code selects other members' finance columns from profiles", () => {
    const hits = CODE.filter((f) =>
      /from\(\s*["'`]profiles["'`]\s*\)[\s\S]{0,300}?\.select\(\s*["'`][^"'`]*(locked_points|total_charge_amount|game_points)/.test(
        f.s,
      ),
    );
    expect(hits.map((h) => h.p)).toEqual([]);
  });

  it("no client code selects weekly stats tables directly", () => {
    const hits = CODE.filter((f) => /from\(\s*["'`]weekly_(deposit|profit|gwang)_stats["'`]/.test(f.s));
    expect(hits.map((h) => h.p)).toEqual([]);
  });
});
