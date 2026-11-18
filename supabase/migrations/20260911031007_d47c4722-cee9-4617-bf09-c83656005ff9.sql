CREATE OR REPLACE FUNCTION public.set_fold_win_reveal(_round_id uuid, _reveal boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _r public.game_rounds;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;
  IF _r.fold_win_reveal_choice IS DISTINCT FROM 'PENDING' THEN
    RETURN jsonb_build_object('choice', _r.fold_win_reveal_choice);
  END IF;
  IF _r.winner_id IS DISTINCT FROM _uid THEN RAISE EXCEPTION '승자만 선택할 수 있습니다.'; END IF;
  -- 선택 시간이 지난 경우 서버에서 비공개로 확정한다 (PENDING 으로 남기지 않는다)
  IF _r.fold_win_reveal_deadline IS NOT NULL AND now() > _r.fold_win_reveal_deadline THEN
    UPDATE public.game_rounds SET fold_win_reveal_choice='HIDDEN' WHERE id=_round_id;
    RETURN jsonb_build_object('choice','HIDDEN');
  END IF;
  UPDATE public.game_rounds
     SET fold_win_reveal_choice = CASE WHEN _reveal THEN 'REVEALED' ELSE 'HIDDEN' END
   WHERE id=_round_id;
  RETURN jsonb_build_object('choice', CASE WHEN _reveal THEN 'REVEALED' ELSE 'HIDDEN' END);
END; $function$;

-- 선택 시간이 지난 공개 선택을 서버 기준으로 마감한다 (참가자 누구나 호출 가능 · 값은 항상 비공개)
CREATE OR REPLACE FUNCTION public.resolve_fold_win_reveal(_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _r public.game_rounds;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL THEN RETURN jsonb_build_object('choice', NULL); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_round_players p
                  WHERE p.round_id=_round_id AND p.user_id=_uid)
     AND NOT EXISTS (SELECT 1 FROM public.game_room_players rp
                      WHERE rp.room_id=_r.room_id AND rp.user_id=_uid) THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF _r.fold_win_reveal_choice IS DISTINCT FROM 'PENDING' THEN
    RETURN jsonb_build_object('choice', _r.fold_win_reveal_choice);
  END IF;
  IF _r.fold_win_reveal_deadline IS NULL OR now() <= _r.fold_win_reveal_deadline THEN
    RETURN jsonb_build_object('choice', 'PENDING');
  END IF;
  UPDATE public.game_rounds SET fold_win_reveal_choice='HIDDEN' WHERE id=_round_id;
  RETURN jsonb_build_object('choice','HIDDEN');
END; $function$;

REVOKE ALL ON FUNCTION public.resolve_fold_win_reveal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_fold_win_reveal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_fold_win_reveal(uuid) TO service_role;