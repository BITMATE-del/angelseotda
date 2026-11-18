INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('game_security_version', '"GAME_SECURITY_1"'::jsonb, now()),
  ('game_security_baseline', jsonb_build_object(
      'version', 'GAME_SECURITY_1',
      'frozen_at', now(),
      'game_core_version', 'STABLE_1',
      'docs', jsonb_build_array('docs/GAME_SECURITY.md', 'docs/GAME_SECURITY_BASELINE.md'),
      'required_regression', jsonb_build_object(
        'vitest_tests', 68,
        'card_security_tests', 13,
        'attack_audit_sutda2', 33,
        'attack_audit_sutda3', 33,
        'play_regression', 'sutda2 3 / sutda3 3 BAD 0',
        'realtime_audit', 'game_rounds frame contains no deck/deck_pos or card fields',
        'browser_audit', 'no opponent card codes in DOM/storage/network/ws',
        'typecheck', 'tsgo --noEmit 0 errors'
      ),
      'verified', jsonb_build_object(
        'attack_audit', 'PASS 33/33 x2',
        'realtime', 'PASS (26 safe columns, deck excluded)',
        'browser', 'PASS (0 leaks)',
        'play', 'PASS (BAD 0)',
        'vitest', 'PASS 68',
        'typecheck', 'PASS'
      ),
      'policy', '카드 보안 코드는 실제 재현된 취약점 없이는 수정 금지. 수정 시 재현→원인→최소수정→회귀 순서 준수.'
    ), now()),
  ('test_driver_enabled', 'false'::jsonb, now())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = now();