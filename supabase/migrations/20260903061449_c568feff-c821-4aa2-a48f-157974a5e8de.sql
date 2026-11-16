INSERT INTO public.items (category, name, description, price, enabled, for_sale, source_type, rarity, status, effect_key, sort_order)
VALUES
  ('title', '주간 입금랭커', '주간 입금랭커 1위에게 지급되는 랭킹 전용 칭호', 0, true, false, 'RANKING_REWARD', 'RARE', 'ACTIVE', 'title_weekly_deposit', 900),
  ('title', '주간 광땡랭커', '주간 광땡랭커 1위에게 지급되는 랭킹 전용 칭호', 0, true, false, 'RANKING_REWARD', 'RARE', 'ACTIVE', 'title_weekly_gwang', 901),
  ('title', '주간 수익왕', '주간 수익왕 1위에게 지급되는 랭킹 전용 칭호', 0, true, false, 'RANKING_REWARD', 'RARE', 'ACTIVE', 'title_weekly_profit', 902)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.grant_ranking_title_internal(_user_id uuid, _effect_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _item_id uuid; _ins int;
BEGIN
  SELECT id INTO _item_id FROM items
   WHERE category = 'title' AND effect_key = _effect_key AND enabled = true
   LIMIT 1;
  IF _item_id IS NULL THEN RETURN false; END IF;

  INSERT INTO user_items (user_id, item_id, source_type)
  VALUES (_user_id, _item_id, 'RANKING_REWARD')
  ON CONFLICT (user_id, item_id) DO NOTHING;
  GET DIAGNOSTICS _ins = ROW_COUNT;
  RETURN _ins > 0;
END; $$;

REVOKE ALL ON FUNCTION public.grant_ranking_title_internal(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_ranking_title_internal(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_pay_weekly_rewards(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _s weekly_ranking_seasons; _rate numeric; _min int := 20;
  _row record; _base numeric; _points bigint; _paid jsonb := '[]'::jsonb; _i int; _inserted uuid;
  _titles jsonb := '[]'::jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT * INTO _s FROM weekly_ranking_seasons WHERE id = _season_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION '시즌을 찾을 수 없습니다.'; END IF;
  IF _s.status NOT IN ('FINALIZED','REWARDED') THEN RAISE EXCEPTION '시즌 확정 후에만 상금을 지급할 수 있습니다.'; END IF;
  SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
  _rate := COALESCE(_rate, 1);

  IF _s.deposit_participants >= _min THEN
    SELECT * INTO _row FROM weekly_deposit_stats
     WHERE season_id = _season_id AND rank_position = 1 AND net_deposit > 0;
    IF _row.user_id IS NOT NULL THEN
      _base := round(_s.total_charge_amount * _s.reward_rate);
      _points := floor(_base * _rate)::bigint;
      INSERT INTO ranking_rewards (season_id, ranking_type, user_id, rank_position, reward_type, reward_amount, reward_meta)
      VALUES (_season_id, 'DEPOSIT', _row.user_id, 1, 'POINTS', _points,
              jsonb_build_object('weekly_total_charge', _s.total_charge_amount, 'reward_rate', _s.reward_rate,
                                 'reward_base_amount', _base, 'conversion_rate', _rate, 'reward_points', _points))
      ON CONFLICT (season_id, ranking_type, rank_position) DO NOTHING
      RETURNING id INTO _inserted;
      IF _inserted IS NOT NULL THEN
        PERFORM grant_points_internal(_row.user_id, _points, 'ranking_reward',
          format('입금랭커 1위 상금 (%s 주간 총 충전 %s원의 %s%%)', _s.week_key, _s.total_charge_amount, _s.reward_rate*100),
          'weekly_season', _season_id, _uid);
        _paid := _paid || jsonb_build_object('type','DEPOSIT','position',1,'points',_points);
        IF grant_ranking_title_internal(_row.user_id, 'title_weekly_deposit') THEN
          _titles := _titles || jsonb_build_object('type','DEPOSIT','user_id',_row.user_id,'title','주간 입금랭커');
        END IF;
      END IF;
    END IF;
  END IF;

  IF _s.gwang_participants >= _min THEN
    FOR _i IN 1..3 LOOP
      _inserted := NULL;
      SELECT * INTO _row FROM weekly_gwang_stats
       WHERE season_id = _season_id AND rank_position = _i AND total_gwang_wins > 0;
      IF _row.user_id IS NOT NULL THEN
        _points := (ARRAY[50000,30000,10000])[_i];
        INSERT INTO ranking_rewards (season_id, ranking_type, user_id, rank_position, reward_type, reward_amount, reward_meta)
        VALUES (_season_id, 'GWANG', _row.user_id, _i, 'POINTS', _points,
                jsonb_build_object('total_gwang_wins', _row.total_gwang_wins,
                  'gwang38', _row.gwang38_wins, 'gwang18', _row.gwang18_wins, 'gwang13', _row.gwang13_wins))
        ON CONFLICT (season_id, ranking_type, rank_position) DO NOTHING
        RETURNING id INTO _inserted;
        IF _inserted IS NOT NULL THEN
          PERFORM grant_points_internal(_row.user_id, _points, 'ranking_reward',
            format('광땡랭커 %s위 상금 (%s)', _i, _s.week_key), 'weekly_season', _season_id, _uid);
          _paid := _paid || jsonb_build_object('type','GWANG','position',_i,'points',_points);
          IF _i = 1 AND grant_ranking_title_internal(_row.user_id, 'title_weekly_gwang') THEN
            _titles := _titles || jsonb_build_object('type','GWANG','user_id',_row.user_id,'title','주간 광땡랭커');
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF _s.profit_participants >= _min THEN
    _inserted := NULL;
    SELECT * INTO _row FROM weekly_profit_stats
     WHERE season_id = _season_id AND rank_position = 1 AND win_points > 0;
    IF _row.user_id IS NOT NULL THEN
      INSERT INTO ranking_rewards (season_id, ranking_type, user_id, rank_position, reward_type, reward_amount, reward_meta)
      VALUES (_season_id, 'PROFIT', _row.user_id, 1, 'CHARGE_RAKE_FREE_TICKET', 2,
              jsonb_build_object('win_points', _row.win_points, 'win_count', _row.win_count))
      ON CONFLICT (season_id, ranking_type, rank_position) DO NOTHING
      RETURNING id INTO _inserted;
      IF _inserted IS NOT NULL THEN
        INSERT INTO rake_free_tickets (user_id, source_type, source_ref)
        SELECT _row.user_id, 'RANKING_REWARD', _season_id FROM generate_series(1,2);
        _paid := _paid || jsonb_build_object('type','PROFIT','position',1,'tickets',2);
        IF grant_ranking_title_internal(_row.user_id, 'title_weekly_profit') THEN
          _titles := _titles || jsonb_build_object('type','PROFIT','user_id',_row.user_id,'title','주간 수익왕');
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE weekly_ranking_seasons SET status = 'REWARDED', rewarded_at = now() WHERE id = _season_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'pay_weekly_rewards', 'weekly_season', _season_id, jsonb_build_object('paid', _paid, 'titles', _titles));
  RETURN jsonb_build_object('paid', _paid, 'titles', _titles, 'min_participants', _min);
END; $function$;