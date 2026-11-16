-- ============================================================
-- DORI_JITGO_DDAENG (도리짓고땡) V1 전용 스키마
-- 기존 SUTDA 테이블(game_rooms/game_rounds/game_cards 등)은 변경하지 않는다.
-- ============================================================

CREATE TABLE public.dori_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number integer NOT NULL,
  game_type text NOT NULL DEFAULT 'DORI_JITGO_DDAENG',
  room_type text NOT NULL DEFAULT 'normal',
  title text NOT NULL DEFAULT '도리짓고땡',
  max_players integer NOT NULL DEFAULT 4,
  min_points bigint NOT NULL DEFAULT 0,
  ante bigint NOT NULL DEFAULT 1000,
  status text NOT NULL DEFAULT 'WAITING',
  owner_id uuid NOT NULL,
  current_round_id uuid,
  carry_pot bigint NOT NULL DEFAULT 0,
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dori_rooms_room_number_key UNIQUE (room_number),
  CONSTRAINT dori_rooms_max_players_chk CHECK (max_players = 4),
  CONSTRAINT dori_rooms_game_type_chk CHECK (game_type = 'DORI_JITGO_DDAENG'),
  CONSTRAINT dori_rooms_status_chk CHECK (status IN ('WAITING', 'PLAYING', 'CLOSED')),
  CONSTRAINT dori_rooms_ante_chk CHECK (ante > 0)
);

GRANT SELECT ON public.dori_rooms TO authenticated;
GRANT ALL ON public.dori_rooms TO service_role;
ALTER TABLE public.dori_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dori_rooms_read" ON public.dori_rooms
  FOR SELECT TO authenticated USING (true);

CREATE TABLE public.dori_room_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.dori_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  seat integer NOT NULL,
  is_ready boolean NOT NULL DEFAULT false,
  ready_at timestamptz,
  leave_pending boolean NOT NULL DEFAULT false,
  leave_requested_at timestamptz,
  connection_status text NOT NULL DEFAULT 'CONNECTED',
  missed_turn_count integer NOT NULL DEFAULT 0,
  entry_balance_snapshot bigint,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dori_room_players_seat_chk CHECK (seat BETWEEN 1 AND 4),
  CONSTRAINT dori_room_players_conn_chk CHECK (connection_status IN ('CONNECTED', 'DISCONNECTED', 'LONG_ABSENCE')),
  CONSTRAINT dori_room_players_seat_uniq UNIQUE (room_id, seat),
  CONSTRAINT dori_room_players_user_uniq UNIQUE (room_id, user_id)
);

GRANT SELECT ON public.dori_room_players TO authenticated;
GRANT ALL ON public.dori_room_players TO service_role;
ALTER TABLE public.dori_room_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dori_room_players_read" ON public.dori_room_players
  FOR SELECT TO authenticated USING (true);

CREATE TABLE public.dori_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.dori_rooms(id) ON DELETE CASCADE,
  round_number integer NOT NULL DEFAULT 1,
  game_type text NOT NULL DEFAULT 'DORI_JITGO_DDAENG',
  status text NOT NULL DEFAULT 'PLAYING',
  phase text NOT NULL DEFAULT 'DEALING',
  dealer_seat integer NOT NULL,
  current_turn_user_id uuid,
  turn_deadline_at timestamptz,
  ante bigint NOT NULL DEFAULT 1000,
  pot bigint NOT NULL DEFAULT 0,
  carry_pot bigint NOT NULL DEFAULT 0,
  current_bet bigint NOT NULL DEFAULT 0,
  raise_count integer NOT NULL DEFAULT 0,
  deck text[] NOT NULL DEFAULT '{}',
  deck_pos integer NOT NULL DEFAULT 0,
  winner_id uuid,
  settlement_status text NOT NULL DEFAULT 'PENDING',
  settled_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT dori_rounds_dealer_chk CHECK (dealer_seat BETWEEN 1 AND 4),
  CONSTRAINT dori_rounds_raise_chk CHECK (raise_count BETWEEN 0 AND 3),
  CONSTRAINT dori_rounds_phase_chk CHECK (phase IN ('DEALING', 'FIRST_BETTING', 'MAKE_SELECTION', 'FINAL_BETTING', 'SHOWDOWN', 'SETTLING', 'ROUND_RESULT', 'FINISHED')),
  CONSTRAINT dori_rounds_status_chk CHECK (status IN ('PLAYING', 'FINISHED', 'CANCELLED')),
  CONSTRAINT dori_rounds_settlement_chk CHECK (settlement_status IN ('PENDING', 'DONE', 'FAILED'))
);

GRANT ALL ON public.dori_rounds TO service_role;
ALTER TABLE public.dori_rounds ENABLE ROW LEVEL SECURITY;
-- 라운드 진행 정보(deck 포함)는 클라이언트 직접 조회 금지. 서버 RPC만 접근한다.
CREATE POLICY "dori_rounds_no_client" ON public.dori_rounds
  FOR SELECT TO authenticated USING (false);

CREATE TABLE public.dori_round_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.dori_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  seat integer NOT NULL,
  initial_points bigint NOT NULL DEFAULT 0,
  final_points bigint,
  contribution bigint NOT NULL DEFAULT 0,
  round_bet bigint NOT NULL DEFAULT 0,
  acted boolean NOT NULL DEFAULT false,
  folded boolean NOT NULL DEFAULT false,
  is_all_in boolean NOT NULL DEFAULT false,
  all_in_at timestamptz,
  make_status text NOT NULL DEFAULT 'PENDING',
  make_total integer,
  hand_type text,
  hand_rank integer,
  hand_label text,
  result_type text,
  connection_status text NOT NULL DEFAULT 'CONNECTED',
  CONSTRAINT dori_round_players_seat_chk CHECK (seat BETWEEN 1 AND 4),
  CONSTRAINT dori_round_players_make_chk CHECK (make_status IN ('PENDING', 'MADE', 'HWANG')),
  CONSTRAINT dori_round_players_result_chk CHECK (result_type IS NULL OR result_type IN ('WIN', 'LOSE', 'DRAW', 'FOLD')),
  CONSTRAINT dori_round_players_uniq UNIQUE (round_id, user_id),
  CONSTRAINT dori_round_players_seat_uniq UNIQUE (round_id, seat)
);

GRANT ALL ON public.dori_round_players TO service_role;
ALTER TABLE public.dori_round_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dori_round_players_no_client" ON public.dori_round_players
  FOR SELECT TO authenticated USING (false);

CREATE TABLE public.dori_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.dori_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  card_code text NOT NULL,
  month_value integer NOT NULL,
  deal_order integer NOT NULL,
  CONSTRAINT dori_cards_month_chk CHECK (month_value BETWEEN 1 AND 10),
  CONSTRAINT dori_cards_order_chk CHECK (deal_order BETWEEN 1 AND 5),
  CONSTRAINT dori_cards_round_card_uniq UNIQUE (round_id, card_code),
  CONSTRAINT dori_cards_user_order_uniq UNIQUE (round_id, user_id, deal_order)
);

GRANT ALL ON public.dori_cards TO service_role;
ALTER TABLE public.dori_cards ENABLE ROW LEVEL SECURITY;
-- hidden card 보호: 본인 카드도 테이블 직접 조회 금지, 전용 RPC만 허용.
CREATE POLICY "dori_cards_no_client" ON public.dori_cards
  FOR SELECT TO authenticated USING (false);

CREATE TABLE public.dori_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.dori_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action_id uuid NOT NULL DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  amount bigint NOT NULL DEFAULT 0,
  betting_round integer NOT NULL DEFAULT 1,
  raise_index integer,
  turn_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dori_actions_type_chk CHECK (action_type IN ('ANTE', 'CHECK', 'BET', 'CALL', 'RAISE', 'FOLD', 'ALL_IN')),
  CONSTRAINT dori_actions_amount_chk CHECK (amount >= 0),
  CONSTRAINT dori_actions_action_id_uniq UNIQUE (action_id)
);

GRANT ALL ON public.dori_actions TO service_role;
ALTER TABLE public.dori_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dori_actions_no_client" ON public.dori_actions
  FOR SELECT TO authenticated USING (false);

CREATE TABLE public.dori_hand_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.dori_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  selected_card_ids text[] NOT NULL,
  remaining_card_ids text[] NOT NULL,
  make_total integer NOT NULL,
  hand_type text NOT NULL,
  hand_rank integer NOT NULL,
  hand_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dori_hand_selected_chk CHECK (array_length(selected_card_ids, 1) = 3),
  CONSTRAINT dori_hand_remaining_chk CHECK (array_length(remaining_card_ids, 1) = 2),
  CONSTRAINT dori_hand_total_chk CHECK (make_total IN (10, 20, 30)),
  CONSTRAINT dori_hand_type_chk CHECK (hand_type IN ('DDAENG', 'GGUT')),
  CONSTRAINT dori_hand_uniq UNIQUE (round_id, user_id)
);

GRANT ALL ON public.dori_hand_submissions TO service_role;
ALTER TABLE public.dori_hand_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dori_hand_submissions_no_client" ON public.dori_hand_submissions
  FOR SELECT TO authenticated USING (false);

CREATE INDEX dori_room_players_room_idx ON public.dori_room_players (room_id);
CREATE INDEX dori_room_players_user_idx ON public.dori_room_players (user_id);
CREATE INDEX dori_rounds_room_idx ON public.dori_rounds (room_id, round_number DESC);
CREATE INDEX dori_round_players_round_idx ON public.dori_round_players (round_id);
CREATE INDEX dori_cards_round_user_idx ON public.dori_cards (round_id, user_id);
CREATE INDEX dori_actions_round_idx ON public.dori_actions (round_id, created_at);

CREATE TRIGGER dori_rooms_updated_at
  BEFORE UPDATE ON public.dori_rooms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 도리 전용 방 번호 시퀀스 (기존 섯다 방 번호와 분리)
CREATE SEQUENCE public.dori_room_number_seq START 200001;
ALTER TABLE public.dori_rooms ALTER COLUMN room_number SET DEFAULT nextval('public.dori_room_number_seq');

-- 도리 전용 기본 설정 (Ante 등) — 기존 섯다 room_types는 변경하지 않는다.
INSERT INTO public.app_settings (key, value)
VALUES ('dori_room_defaults', '{"beginner":{"ante":1000,"min_points":10000},"normal":{"ante":5000,"min_points":100000},"expert":{"ante":20000,"min_points":500000}}'::jsonb)
ON CONFLICT (key) DO NOTHING;