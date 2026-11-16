DROP POLICY IF EXISTS dori_chat_read ON public.dori_chat_messages;
DROP POLICY IF EXISTS dori_chat_insert ON public.dori_chat_messages;

CREATE POLICY dori_chat_read ON public.dori_chat_messages
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.dori_room_players p
    WHERE p.room_id = dori_chat_messages.room_id AND p.user_id = auth.uid()
  )
);

CREATE POLICY dori_chat_insert ON public.dori_chat_messages
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.dori_room_players p
    WHERE p.room_id = dori_chat_messages.room_id AND p.user_id = auth.uid()
  )
);