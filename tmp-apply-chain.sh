#!/usr/bin/env bash
set -e
for f in /migrations/0001_baseline.sql /migrations/0002_department_visibility.sql /migrations/0003_department_ask_wren_prompt.sql /migrations/0004_department_visibility_grant_privileges.sql /migrations/0005_authorizer_app_user_update_privilege.sql /migrations/0006_seed_law_department.sql; do
  echo "=== APPLYING $f ==="
  psql -q -v ON_ERROR_STOP=1 -U postgres -d appdb -f "$f" >/dev/null
done
echo "=== CHAIN APPLIED ==="
