-- 채팅 조회 정책 성능 최적화 (권한 범위 변경 없음).
-- 기존: is_admin(auth.uid()) / auth.uid() 가 행마다 재평가되어 조회 지연(평균 33ms, 최대 3.7s).
-- 변경: (select auth.uid()) 로 감싸 쿼리 1회 평가(initplan)로 바꾼다. 허용 대상은 동일하다.
DROP POLICY IF EXISTS chat_read ON public.chat_messages;
CREATE POLICY chat_read ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    (user_id = (select auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.game_room_players p
      WHERE p.room_id = chat_messages.room_id
        AND p.user_id = (select auth.uid())
    )
    OR is_admin((select auth.uid()))
  );