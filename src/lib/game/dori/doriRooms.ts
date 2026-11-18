/**
 * 도리짓고땡 전용 방 등급 프리셋 (표시용 미러).
 *
 * 실제 강제는 서버 `dori_grade_preset` / `dori_create_room` 에서만 수행한다.
 * 기존 섯다 room_types 는 절대 수정하지 않는다.
 */
export type DoriRoomGrade = "beginner" | "normal" | "expert";

export interface DoriGradePreset {
  id: DoriRoomGrade;
  name: string;
  /** 입장 최소 보유 포인트 */
  minPoints: number;
  /** 기본 참가금(Ante) = 기본 베팅액 */
  ante: number;
}

export const DORI_GRADES: DoriGradePreset[] = [
  { id: "beginner", name: "초보방", minPoints: 100_000, ante: 1_000 },
  { id: "normal", name: "일반방", minPoints: 300_000, ante: 2_000 },
  { id: "expert", name: "고수방", minPoints: 800_000, ante: 3_500 },
];

export function doriGrade(id: string | null | undefined): DoriGradePreset | null {
  return DORI_GRADES.find((g) => g.id === id) ?? null;
}

export function doriGradeName(id: string | null | undefined): string {
  return doriGrade(id)?.name ?? "일반방";
}
