-- 비로그인(anon/PUBLIC) 이 실행할 필요가 없는 SECURITY DEFINER 함수의 PUBLIC EXECUTE 회수.
-- 로그인 전 필요한 함수(username_available, custom_title_available, validate_custom_title,
-- official_channel_link, support_center_link)는 유지한다.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname IN (
        'cancel_rare_offer','create_rare_offer','respond_rare_offer','my_rare_offers',
        'received_rare_offers','rare_item_owners','expire_rare_item_offers',
        'equip_custom_title','purchase_custom_title','my_custom_titles','my_equipped_title',
        'dori_action_options','dori_reveal_choice','dori_reveal_mode','dori_round_history'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;