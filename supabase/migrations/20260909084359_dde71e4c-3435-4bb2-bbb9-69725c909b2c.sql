ALTER TABLE public.dori_rooms REPLICA IDENTITY FULL;
ALTER TABLE public.dori_room_players REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dori_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dori_room_players;