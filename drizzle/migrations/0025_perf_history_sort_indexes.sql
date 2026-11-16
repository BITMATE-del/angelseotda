-- 성능 개선: 측정된 느린 조회 2건에 대한 정렬 인덱스만 추가한다.
-- (거래내역 created_at DESC 전체 스캔: 평균 353ms / 최대 2.6s)
-- 게임 코어 / 정산 / POT / RLS / 스키마 구조는 변경하지 않는다.
CREATE INDEX IF NOT EXISTS point_transactions_created_at_idx
  ON public.point_transactions (created_at DESC);

CREATE INDEX IF NOT EXISTS game_rounds_room_started_idx
  ON public.game_rounds (room_id, started_at DESC);
