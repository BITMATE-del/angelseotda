CREATE OR REPLACE FUNCTION public.room_loadouts(_room_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'userId', x.user_id,
        'cardBack', x.card_back,
        'cardBackName', x.card_back_name,
        'frame', x.frame,
        'frameName', x.frame_name,
        'nameEffect', x.name_effect,
        'nameEffectName', x.name_effect_name,
        'tableSkin', x.table_skin,
        'tableSkinName', x.table_skin_name
      )
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT
      rp.user_id,
      MAX(i.asset_url) FILTER (WHERE i.category IN ('card_back', 'card_skin')) AS card_back,
      MAX(i.name)      FILTER (WHERE i.category IN ('card_back', 'card_skin')) AS card_back_name,
      MAX(i.asset_url) FILTER (WHERE i.category = 'profile_frame')             AS frame,
      MAX(i.name)      FILTER (WHERE i.category = 'profile_frame')             AS frame_name,
      MAX(i.asset_url) FILTER (WHERE i.category = 'name_effect')               AS name_effect,
      MAX(i.name)      FILTER (WHERE i.category = 'name_effect')               AS name_effect_name,
      MAX(i.asset_url) FILTER (WHERE i.category = 'table_skin')                AS table_skin,
      MAX(i.name)      FILTER (WHERE i.category = 'table_skin')                AS table_skin_name
    FROM public.game_room_players rp
    JOIN public.user_items ui ON ui.user_id = rp.user_id AND ui.equipped = true
    JOIN public.items i ON i.id = ui.item_id
    WHERE rp.room_id = _room_id
      AND i.category IN ('card_back', 'card_skin', 'profile_frame', 'name_effect', 'table_skin')
    GROUP BY rp.user_id
  ) x
$$;

REVOKE ALL ON FUNCTION public.room_loadouts(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.room_loadouts(uuid) TO authenticated;