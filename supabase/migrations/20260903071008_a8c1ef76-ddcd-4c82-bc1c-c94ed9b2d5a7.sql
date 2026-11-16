CREATE OR REPLACE FUNCTION public.admin_member_contact(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT jsonb_build_object(
    'id', p.id,
    'nickname', p.nickname,
    'username', p.username,
    'email', p.email,
    'telegramId', p.telegram_id,
    'walletAddress', p.wallet_address,
    'signupCodeUsed', p.signup_code_used,
    'riskLevel', p.risk_level,
    'riskNote', p.risk_note,
    'sanctionReason', p.sanction_reason
  ) INTO v
  FROM public.profiles p WHERE p.id = _user_id;
  RETURN COALESCE(v, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_member_contact(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_member_contact(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_member_contact(uuid) TO authenticated;