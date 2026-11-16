/**
 * 좌석번호(1~max) · 선(先) 순환 규칙 — 표시/검증용 순수 함수.
 *
 * 실제 좌석 배정과 선 결정은 서버(select_seat / join_room / start_game_round)가 단독 권한으로
 * 수행한다. 이 모듈은 서버와 동일한 규칙을 클라이언트 표시와 회귀 테스트에서 재확인하기 위한
 * 참조 구현이며, 게임 코어(카드/베팅/정산)에는 관여하지 않는다.
 */

/** 방 좌석번호는 1부터 시작한다 (0번 좌석은 존재하지 않는다) */
export const FIRST_SEAT_NUMBER = 1;

/** 좌석번호 유효성 — 1..maxPlayers */
export function isValidSeatNumber(seat: number, maxPlayers: number) {
  return Number.isInteger(seat) && seat >= FIRST_SEAT_NUMBER && seat <= maxPlayers;
}

/** 빈 좌석번호 목록 (착석자가 나가도 다른 좌석번호는 당겨지지 않는다) */
export function emptySeatNumbers(occupied: readonly number[], maxPlayers: number) {
  const used = new Set(occupied);
  const out: number[] = [];
  for (let n = FIRST_SEAT_NUMBER; n <= maxPlayers; n += 1) if (!used.has(n)) out.push(n);
  return out;
}

/**
 * 다음 판의 선(先) 좌석.
 *
 * · 첫 정규판(prev === null): 착석자 중 가장 낮은 좌석번호
 * · 이후 정규판: 좌석번호 순환(1 → 2 → … → max → 1), 빈 좌석은 skip
 * · 이전 선이 퇴장했으면 그 다음 occupied seat 로 이동
 */
export function nextDealerSeat(prev: number | null, occupied: readonly number[]) {
  const seats = [...new Set(occupied)].sort((a, b) => a - b);
  if (seats.length === 0) return null;
  if (prev == null) return seats[0]!;
  return seats.find((s) => s > prev) ?? seats[0]!;
}

/** REMATCH 체인 중에는 선이 이동하지 않는다 */
export function dealerSeatForNextRound(
  prev: number | null,
  occupied: readonly number[],
  isRematch: boolean,
) {
  if (isRematch && prev != null && occupied.length > 0) return prev;
  return nextDealerSeat(prev, occupied);
}

/** 카드 지급 · 첫 action 순서 — 선 좌석부터 좌석번호 순환 */
export function seatOrderFrom(dealerSeat: number, occupied: readonly number[]) {
  return [...new Set(occupied)].sort(
    (a, b) => ((a - dealerSeat + 100) % 100) - ((b - dealerSeat + 100) % 100),
  );
}
