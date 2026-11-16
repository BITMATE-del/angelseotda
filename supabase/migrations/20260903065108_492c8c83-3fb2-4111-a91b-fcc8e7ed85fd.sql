CREATE OR REPLACE FUNCTION public.affiliate_overview(_affiliate_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _aff public.affiliates;
  _is_admin boolean;
  _out jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  _is_admin := public.is_admin(_uid);

  IF _affiliate_id IS NULL THEN
    SELECT * INTO _aff FROM public.affiliates WHERE user_id = _uid;
  ELSE
    SELECT * INTO _aff FROM public.affiliates WHERE id = _affiliate_id;
    IF _aff.id IS NOT NULL AND NOT _is_admin AND _aff.user_id <> _uid THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
  END IF;

  IF _aff.id IS NULL THEN
    RETURN jsonb_build_object('affiliate', NULL);
  END IF;

  SELECT jsonb_build_object(
    'affiliate', jsonb_build_object(
      'id', _aff.id,
      'userId', _aff.user_id,
      'code', _aff.affiliate_code,
      'status', _aff.status,
      'memo', _aff.memo,
      'createdAt', _aff.created_at,
      'nickname', p.nickname,
      'username', p.username
    ),
    'totals', (
      SELECT jsonb_build_object(
        'members', (SELECT count(*) FROM public.affiliate_members m WHERE m.affiliate_id = _aff.id),
        'membersWeek', (SELECT count(*) FROM public.affiliate_members m
                        WHERE m.affiliate_id = _aff.id AND m.joined_at >= now() - interval '7 days'),
        'commissionTotal', COALESCE(SUM(c.commission_amount), 0),
        'commissionCount', count(*),
        'baseTotal', COALESCE(SUM(c.base_amount), 0),
        'pending', COALESCE(SUM(c.commission_amount) FILTER (WHERE c.status = 'pending'), 0),
        'settled', COALESCE(SUM(c.commission_amount) FILTER (WHERE c.status = 'settled'), 0),
        'day1', COALESCE(SUM(c.commission_amount) FILTER (WHERE c.created_at >= now() - interval '1 day'), 0),
        'day7', COALESCE(SUM(c.commission_amount) FILTER (WHERE c.created_at >= now() - interval '7 days'), 0),
        'day30', COALESCE(SUM(c.commission_amount) FILTER (WHERE c.created_at >= now() - interval '30 days'), 0)
      )
      FROM public.affiliate_commissions c WHERE c.affiliate_id = _aff.id
    ),
    'members', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'joinedAt') DESC) FROM (
        SELECT jsonb_build_object(
          'userId', m.member_user_id,
          'username', mp.username,
          'nickname', mp.nickname,
          'level', mp.level,
          'rank', mp.rank,
          'points', mp.game_points,
          'status', mp.status,
          'joinedAt', m.joined_at,
          'lastSeenAt', mp.last_seen_at,
          'chargeAmount', COALESCE(cs.base_sum, 0),
          'chargeCount', COALESCE(cs.cnt, 0),
          'commissionAmount', COALESCE(cs.commission_sum, 0),
          'commissionPending', COALESCE(cs.pending_sum, 0),
          'lastChargeAt', cs.last_at
        ) AS x
        FROM public.affiliate_members m
        LEFT JOIN public.profiles mp ON mp.id = m.member_user_id
        LEFT JOIN (
          SELECT c.member_user_id,
                 SUM(c.base_amount) AS base_sum,
                 SUM(c.commission_amount) AS commission_sum,
                 SUM(c.commission_amount) FILTER (WHERE c.status = 'pending') AS pending_sum,
                 count(*) AS cnt,
                 MAX(c.created_at) AS last_at
          FROM public.affiliate_commissions c
          WHERE c.affiliate_id = _aff.id
          GROUP BY c.member_user_id
        ) cs ON cs.member_user_id = m.member_user_id
        WHERE m.affiliate_id = _aff.id
      ) s
    ), '[]'::jsonb),
    'commissions', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'createdAt') DESC) FROM (
        SELECT jsonb_build_object(
          'id', c.id,
          'createdAt', c.created_at,
          'memberUserId', c.member_user_id,
          'username', mp.username,
          'nickname', mp.nickname,
          'baseAmount', c.base_amount,
          'rate', c.commission_rate,
          'amount', c.commission_amount,
          'status', c.status,
          'settledAt', c.settled_at
        ) AS x
        FROM public.affiliate_commissions c
        LEFT JOIN public.profiles mp ON mp.id = c.member_user_id
        WHERE c.affiliate_id = _aff.id
        ORDER BY c.created_at DESC
        LIMIT 200
      ) s
    ), '[]'::jsonb),
    'activity', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'at') DESC) FROM (
        (
          SELECT jsonb_build_object(
            'at', m.joined_at, 'type', 'JOIN',
            'nickname', COALESCE(mp.nickname, '-'),
            'username', mp.username,
            'amount', 0
          ) AS x
          FROM public.affiliate_members m
          LEFT JOIN public.profiles mp ON mp.id = m.member_user_id
          WHERE m.affiliate_id = _aff.id
          ORDER BY m.joined_at DESC LIMIT 30
        )
        UNION ALL
        (
          SELECT jsonb_build_object(
            'at', c.created_at, 'type', 'COMMISSION',
            'nickname', COALESCE(mp.nickname, '-'),
            'username', mp.username,
            'amount', c.commission_amount,
            'baseAmount', c.base_amount,
            'status', c.status
          ) AS x
          FROM public.affiliate_commissions c
          LEFT JOIN public.profiles mp ON mp.id = c.member_user_id
          WHERE c.affiliate_id = _aff.id
          ORDER BY c.created_at DESC LIMIT 30
        )
      ) s
    ), '[]'::jsonb)
  )
  INTO _out
  FROM public.profiles p WHERE p.id = _aff.user_id;

  RETURN _out;
END;
$$;

REVOKE ALL ON FUNCTION public.affiliate_overview(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.affiliate_overview(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.affiliate_overview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_affiliates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'createdAt') DESC) FROM (
      SELECT jsonb_build_object(
        'id', a.id,
        'userId', a.user_id,
        'code', a.affiliate_code,
        'status', a.status,
        'memo', a.memo,
        'createdAt', a.created_at,
        'username', p.username,
        'nickname', p.nickname,
        'members', (SELECT count(*) FROM public.affiliate_members m WHERE m.affiliate_id = a.id),
        'membersWeek', (SELECT count(*) FROM public.affiliate_members m
                        WHERE m.affiliate_id = a.id AND m.joined_at >= now() - interval '7 days'),
        'baseTotal', COALESCE(cs.base_sum, 0),
        'commissionTotal', COALESCE(cs.commission_sum, 0),
        'pending', COALESCE(cs.pending_sum, 0),
        'settled', COALESCE(cs.settled_sum, 0),
        'day7', COALESCE(cs.day7_sum, 0),
        'lastCommissionAt', cs.last_at
      ) AS x
      FROM public.affiliates a
      LEFT JOIN public.profiles p ON p.id = a.user_id
      LEFT JOIN (
        SELECT c.affiliate_id,
               SUM(c.base_amount) AS base_sum,
               SUM(c.commission_amount) AS commission_sum,
               SUM(c.commission_amount) FILTER (WHERE c.status = 'pending') AS pending_sum,
               SUM(c.commission_amount) FILTER (WHERE c.status = 'settled') AS settled_sum,
               SUM(c.commission_amount) FILTER (WHERE c.created_at >= now() - interval '7 days') AS day7_sum,
               MAX(c.created_at) AS last_at
        FROM public.affiliate_commissions c
        GROUP BY c.affiliate_id
      ) cs ON cs.affiliate_id = a.id
    ) s
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_affiliates() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_affiliates() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_affiliates() TO authenticated;