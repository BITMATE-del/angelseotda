-- Staging-only final hand choices: written by authenticated participant after
-- verifying the private DB hand. Selections never imply real settlement.
CREATE TABLE IF NOT EXISTS public.angel_round_final_selections (
  round_id uuid NOT NULL,
  account_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('SUTDA3','DORI')),
  selected_card_ids jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id,account_id),
  FOREIGN KEY (round_id,account_id)
    REFERENCES public.angel_round_private_hands(round_id,account_id)
    ON DELETE RESTRICT,
  CONSTRAINT angel_selection_card_array CHECK (jsonb_typeof(selected_card_ids)='array'),
  CONSTRAINT angel_selection_card_count CHECK (
    (mode='SUTDA3' AND jsonb_array_length(selected_card_ids)=2) OR
    (mode='DORI' AND jsonb_array_length(selected_card_ids)=3)
  )
);
INSERT INTO public.angel_schema_migrations(version)
VALUES ('0005_final_hand_selections')
ON CONFLICT(version) DO NOTHING;
