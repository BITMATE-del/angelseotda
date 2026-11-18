-- 1) chat_messages: 같은 방 참가자(또는 관리자)만 읽기
DROP POLICY IF EXISTS chat_read ON public.chat_messages;
CREATE POLICY chat_read ON public.chat_messages
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.game_room_players p
    WHERE p.room_id = chat_messages.room_id AND p.user_id = auth.uid()
  )
);

-- 2) game_actions: 해당 라운드 참가자(또는 관리자)만 읽기
DROP POLICY IF EXISTS "actions readable" ON public.game_actions;
CREATE POLICY "actions readable" ON public.game_actions
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.game_round_players rp
    WHERE rp.round_id = game_actions.round_id AND rp.user_id = auth.uid()
  )
);

-- 3) 관리자 전용 RPC의 anon EXECUTE 회수 (최소 권한)
REVOKE EXECUTE ON FUNCTION public.admin_abandoned_rounds(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_abandoned_round(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_release_closed_room_seats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_affiliate_rebate_rate(uuid, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_disable_custom_title(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_custom_titles(text) FROM anon;