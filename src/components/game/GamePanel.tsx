import { useState } from "react";
import { HandRankChart } from "./HandRankChart";
import { RoomChat } from "./RoomChat";
import { cn } from "@/lib/utils";

type TabKey = "chat" | "log" | "rank" | "guide";

const TABS: { key: TabKey; label: string }[] = [
  { key: "chat", label: "채팅" },
  { key: "log", label: "게임로그" },
  { key: "rank", label: "족보" },
  { key: "guide", label: "안내" },
];

/**
 * 게임 우측 통합 패널 — 채팅 / 게임 액션 로그 / 족보표 / 서비스 안내를 탭으로 분리한다.
 * 탭 헤더 높이는 고정이고, 본문만 내부 스크롤되어 채팅 입력창이 밀려나지 않는다.
 */
export function GamePanel({
  roomId,
  userId,
  nickname,
  log,
  onReaction,
  className,
}: {
  roomId: string;
  userId: string | null;
  nickname: string;
  log: readonly string[];
  onReaction?: (code: string) => void;
  className?: string;
}) {
  const [tab, setTab] = useState<TabKey>("chat");

  return (
    <section className={cn("panel-surface flex flex-col rounded-2xl p-2.5", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "whitespace-nowrap rounded-full px-2 py-0.5 font-display text-[11px] transition",
              tab === t.key
                ? "bg-gold/18 text-gold ring-1 ring-gold/50"
                : "text-muted-foreground hover:text-gold-soft",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        {tab === "chat" && (
          <RoomChat
            roomId={roomId}
            userId={userId}
            nickname={nickname}
            {...(onReaction ? { onReaction } : {})}
          />
        )}

        {tab === "log" && (
          <div className="h-full overflow-y-auto pr-1 text-xs">
            {(log.length ? log : ["판이 시작되면 진행 상황이 표시됩니다."]).map((line, i) => (
              <p key={i} className="py-0.5 text-foreground/75">
                {line}
              </p>
            ))}
          </div>
        )}

        {tab === "rank" && (
          <div className="h-full overflow-y-auto pr-1">
            <HandRankChart className="border-0 bg-transparent p-0 shadow-none" />
          </div>
        )}

        {tab === "guide" && (
          <div className="h-full space-y-2 overflow-y-auto pr-1 text-xs leading-relaxed text-foreground/80">
            <Guide title="준비 READY">
              첫 판은 착석한 플레이어 전원이 준비를 눌러야 시작됩니다. 준비 상태는 서버에 저장되어
              새로고침·재입장 후에도 유지되며, 판이 시작되면 초기화됩니다. 이후 판은 자동으로
              시작됩니다.
            </Guide>
            <Guide title="족보">
              광땡 &gt; 땡 &gt; 알리·독사·구삥·장삥·장사·세륙 &gt; 끗. 3장 섯다는 최종 승부패 2장으로
              판정하며, 같은 월 3장(삼땡)은 모든 광땡보다 강합니다.
            </Guide>
            <Guide title="구사 (4+9)">
              4월 + 9월 조합은 구사로 판정되어 판돈을 분배하지 않고 다음 판으로 이월한 뒤 2장 재경기를
              진행합니다.
            </Guide>
            <Guide title="무승부">
              동일한 최고 족보가 나오면 판돈을 분배하지 않고 이월하며, 동점자끼리 2장 재경기를 진행합니다.
            </Guide>
            <Guide title="올인 / 사이드팟">
              올인은 베팅이 2회 이상 진행된 뒤 사용할 수 있고, 투자액 기준 MAIN / SIDE POT을 서버가
              분리 정산합니다.
            </Guide>
            <Guide title="출금 조건">
              충전 후 최소 50분 이상 플레이해야 출금 신청이 가능합니다. 충전 시 7% 수수료가 차감되며
              (면제권 사용 시 100% 지급), 출금 수수료는 0%입니다.
            </Guide>
            <Guide title="점검 안내">
              점검 중에는 새 판이 시작되지 않으며, 진행 중인 판은 정상 정산 후 종료됩니다. 카드 셔플·배분·
              족보 판정·정산은 모두 서버가 처리합니다.
            </Guide>
          </div>
        )}
      </div>
    </section>
  );
}

function Guide({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-3 py-2">
      <p className="font-display text-[12px] text-gold">{title}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}
