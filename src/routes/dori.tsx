import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { DoriRoomBoard } from "@/components/game/dori/DoriRoomBoard";
import { SUTDA_CARDS } from "@/data/sutdaCards";
import {
  DORI_MAX_PLAYERS,
  DORI_MIN_PLAYERS,
} from "@/lib/game/dori/doriRules";

export const Route = createFileRoute("/dori")({
  head: () => ({
    meta: [
      { title: "도리짓고땡 입장 · 엔젤섯다 ANGEL SUTDA" },
      {
        name: "description",
        content:
          "화투 20장으로 즐기는 도리짓고땡. 5장 중 3장의 합을 10·20·30으로 짓고 남은 2장의 족보로 승부합니다.",
      },
      { property: "og:title", content: "도리짓고땡 입장 · 엔젤섯다" },
      {
        property: "og:description",
        content: "짓기 성공 후 남은 두 장의 땡·끗으로 겨루는 정통 도리짓고땡.",
      },
    ],
    links: [{ rel: "canonical", href: "https://angel-sd.com/dori" }],
  }),
  component: DoriLanding,
});

const HAND_RANKS = [
  "장땡(10땡)",
  "9땡",
  "8땡",
  "7땡",
  "6땡",
  "5땡",
  "4땡",
  "3땡",
  "2땡",
  "1땡",
  "갑오(9끗)",
  "8끗",
  "7끗",
  "6끗",
  "5끗",
  "4끗",
  "3끗",
  "2끗",
  "1끗",
  "망통(0끗)",
  "황",
];

const BETTING = [
  ["Ante", "게임 시작 기본 참가금"],
  ["체크", "추가 베팅 없이 넘김 (아직 아무도 베팅하지 않았을 때만)"],
  ["삥", "콜 금액 + 기본 베팅"],
  ["콜", "현재 최고 베팅액에 맞춤 (추가 차감액만 계산)"],
  ["삥 / 따당 / 쿼터 / 하프", "기존 섯다와 동일한 베팅 액션 — 횟수 제한 없음"],
  ["다이", "판 포기 (이미 넣은 금액은 반환되지 않음)"],
  ["올인", "콜 금액이 부족하면 보유 잔액 전부로 승부 지속"],
];

function exampleCard(month: number, index = 0) {
  return SUTDA_CARDS.filter((c) => c.month === month)[index]!;
}

const EXAMPLE = [5, 1, 3, 8, 7];

function DoriLanding() {
  return (
    <AppShell>
      <section className="panel-surface rounded-2xl p-6">
        <p className="text-xs font-semibold tracking-[0.3em] text-gold-soft/70">
          DORI JITGO DDAENG
        </p>
        <h1 className="mt-2 font-display text-3xl text-gold">도리짓고땡</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/75">
          5장의 화투패 중 3장의 합을 10·20·30 중 하나로 만들고, 남은 2장의 족보로 승부합니다.
          {DORI_MIN_PLAYERS}~{DORI_MAX_PLAYERS}인 전용 테이블이며 좌석은 1~{DORI_MAX_PLAYERS}번까지
          존재합니다.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-xl border border-gold/25 bg-black/40 px-4 py-3 text-sm text-gold-soft">
          방을 만들거나 열린 방에 입장해 바로 대국을 시작할 수 있습니다.
        </div>
      </section>

      <DoriRoomBoard />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel-surface rounded-2xl p-6">
          <h2 className="font-display text-xl text-gold">게임방법</h2>
          <ol className="mt-3 space-y-1.5 text-sm text-foreground/75">
            <li>1. 방 입장 후 빈 좌석 선택</li>
            <li>2. 준비(READY) — {DORI_MIN_PLAYERS}명 이상 준비되면 라운드 시작</li>
            <li>3. Ante 부과 후 각자 3장 비공개 지급</li>
            <li>4. 1차 베팅</li>
            <li>5. 4번째 카드 지급 → 2차 베팅</li>
            <li>6. 5번째 카드 지급 → 짓기 3장 선택</li>
            <li>7. 최종 베팅</li>
            <li>8. 쇼다운 · 정산 · 다음 판</li>
          </ol>
        </section>

        <section className="panel-surface rounded-2xl p-6">
          <h2 className="font-display text-xl text-gold">짓기</h2>
          <p className="mt-3 text-sm text-foreground/75">
            5장 중 정확히 3장을 골라 월 숫자 합이 <span className="text-gold">10 · 20 · 30</span>{" "}
            중 하나가 되면 짓기 성공입니다. 10·20·30 사이에는 강약이 없고, 남은 2장의 족보로만
            승부합니다. 어떤 3장으로도 만들 수 없으면 <span className="text-crimson">황</span>이며
            모든 정상 족보보다 낮습니다.
          </p>
          <div className="mt-4 rounded-xl border border-gold/20 bg-black/40 p-4">
            <div className="flex flex-wrap gap-2">
              {EXAMPLE.map((m, i) => {
                const card = exampleCard(m, EXAMPLE.slice(0, i).filter((x) => x === m).length);
                const isMake = [5, 8, 7].includes(m);
                return (
                  <img
                    key={card.id}
                    src={card.assetUrl}
                    alt={`${m}월 화투패`}
                    loading="lazy"
                    className={
                      isMake
                        ? "h-24 w-auto rounded-md ring-2 ring-gold"
                        : "h-24 w-auto rounded-md opacity-70"
                    }
                  />
                );
              })}
            </div>
            <p className="mt-3 text-sm text-foreground/80">
              5 + 7 + 8 = <span className="text-gold">20</span> → 짓기 성공 · 남은 1 + 3 →{" "}
              <span className="text-gold">4끗</span>
            </p>
          </div>
        </section>

        <section className="panel-surface rounded-2xl p-6">
          <h2 className="font-display text-xl text-gold">족보</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            남은 2장의 월 숫자가 같으면 땡, 다르면 합의 1의 자리로 끗을 계산합니다. 광·특수족보(광땡,
            알리, 암행어사 등)는 도리짓고땡에 적용되지 않습니다.
          </p>
          <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-foreground/75 sm:grid-cols-3">
            {HAND_RANKS.map((label, i) => (
              <li key={label} className="flex gap-2">
                <span className="w-6 text-right text-xs text-muted-foreground">{i + 1}</span>
                <span className={i === HAND_RANKS.length - 1 ? "text-crimson" : undefined}>
                  {label}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel-surface rounded-2xl p-6">
          <h2 className="font-display text-xl text-gold">베팅</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {BETTING.map(([term, desc]) => (
              <div key={term} className="flex gap-3">
                <dt className="w-16 shrink-0 font-semibold text-gold-soft">{term}</dt>
                <dd className="text-foreground/75">{desc}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </AppShell>
  );
}
