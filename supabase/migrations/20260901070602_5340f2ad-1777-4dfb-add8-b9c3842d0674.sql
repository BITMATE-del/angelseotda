ALTER TABLE public.game_rounds ADD COLUMN IF NOT EXISTS settled boolean NOT NULL DEFAULT false;
ALTER TABLE public.game_rounds ADD COLUMN IF NOT EXISTS winner_id uuid;

CREATE OR REPLACE FUNCTION public.settle_round(_round_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _round game_rounds;
  _rec record;
  _pot bigint := 0;
  _winner uuid;
  _p profiles;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _round FROM game_rounds WHERE id = _round_id FOR UPDATE;
  IF _round.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;
  IF _round.settled THEN RAISE EXCEPTION '이미 정산된 라운드입니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM game_round_players WHERE round_id = _round_id AND user_id = _uid) THEN
    RAISE EXCEPTION '해당 라운드의 참가자가 아닙니다.';
  END IF;

  SELECT user_id INTO _winner FROM game_round_players
   WHERE round_id = _round_id AND result = 'win' LIMIT 1;
  IF _winner IS NULL THEN RAISE EXCEPTION '승자가 확정되지 않았습니다.'; END IF;

  -- 각 참가자의 베팅 합계를 서버에서 직접 계산해 차감한다.
  FOR _rec IN
    SELECT a.user_id, SUM(a.amount)::bigint AS bet
      FROM game_actions a
     WHERE a.round_id = _round_id
     GROUP BY a.user_id
  LOOP
    SELECT * INTO _p FROM profiles WHERE id = _rec.user_id FOR UPDATE;
    IF _p.id IS NULL THEN CONTINUE; END IF;
    IF _rec.bet <= 0 THEN CONTINUE; END IF;
    IF _p.game_points < _rec.bet THEN
      RAISE EXCEPTION '참가자의 보유 포인트가 부족합니다.';
    END IF;
    _pot := _pot + _rec.bet;
    UPDATE profiles SET game_points = game_points - _rec.bet WHERE id = _rec.user_id;
    INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id)
    VALUES (_rec.user_id, 'game_loss', -_rec.bet, _p.game_points, _p.game_points - _rec.bet,
            _p.locked_points, _p.locked_points, 'game_round', _round_id);
  END LOOP;

  IF _pot > 0 THEN
    SELECT * INTO _p FROM profiles WHERE id = _winner FOR UPDATE;
    UPDATE profiles SET game_points = game_points + _pot WHERE id = _winner;
    INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id)
    VALUES (_winner, 'game_win', _pot, _p.game_points, _p.game_points + _pot,
            _p.locked_points, _p.locked_points, 'game_round', _round_id);
  END IF;

  -- 전적 / 랭킹 포인트
  UPDATE profiles p SET
    wins = p.wins + 1,
    current_streak = p.current_streak + 1,
    max_streak = GREATEST(p.max_streak, p.current_streak + 1),
    rank_points = p.rank_points + 25,
    exp = p.exp + 40,
    level = GREATEST(1, ((p.exp + 40) / 500)::int + 1)
  WHERE p.id = _winner;

  UPDATE profiles p SET
    losses = p.losses + 1,
    current_streak = 0,
    rank_points = GREATEST(0, p.rank_points - 10),
    exp = p.exp + 12,
    level = GREATEST(1, ((p.exp + 12) / 500)::int + 1)
  WHERE p.id IN (SELECT user_id FROM game_round_players WHERE round_id = _round_id AND user_id <> _winner);

  UPDATE profiles SET gwangttaeng_count = gwangttaeng_count + 1
   WHERE id = _winner
     AND EXISTS (SELECT 1 FROM game_round_players
                  WHERE round_id = _round_id AND user_id = _winner AND hand_rank LIKE '%광땡%');

  INSERT INTO season_rankings (season_id, user_id, rank_points, wins, losses)
  SELECT s.id, _winner, 25, 1, 0 FROM seasons s WHERE s.status = 'active'
  ON CONFLICT (season_id, user_id)
  DO UPDATE SET rank_points = season_rankings.rank_points + 25, wins = season_rankings.wins + 1;

  UPDATE game_rounds SET settled = true, status = 'finished', pot = _pot,
         winner_id = _winner, finished_at = now()
   WHERE id = _round_id;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_round(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.settle_round(uuid) TO authenticated;