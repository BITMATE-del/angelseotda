CREATE OR REPLACE FUNCTION public.trg_round_finished_balance_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'finished' AND COALESCE(OLD.status,'') <> 'finished' THEN
    -- 재경기(REMATCH)로 끝난 라운드는 최종 승부가 확정되지 않았으므로 잔액 자격 검사를 하지 않는다.
    IF COALESCE(NEW.settlement_status,'') = 'REMATCH' THEN
      RETURN NEW;
    END IF;
    BEGIN
      PERFORM public.enforce_room_balance_eligibility(NEW.room_id);
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
  RETURN NEW;
END; $function$;