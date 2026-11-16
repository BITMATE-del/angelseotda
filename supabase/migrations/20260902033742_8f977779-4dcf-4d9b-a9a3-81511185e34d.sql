REVOKE EXECUTE ON FUNCTION public.select_open_card(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_fold_win_reveal(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.deal_next_card(uuid) FROM anon, authenticated;