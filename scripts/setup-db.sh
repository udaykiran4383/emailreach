#!/usr/bin/env bash
# Apply the full EmailReach schema to a NEW Supabase project.
#
#   DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
#     bash scripts/setup-db.sh
#
# Use the "Session pooler" connection string from Supabase → Connect (works over IPv4).
# Safe to re-run: every script uses IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.
# Skips 02_personal_schema.sql on purpose (it DROPs all tables).
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set (Supabase → Connect → Session pooler URI)" >&2
  exit 1
fi

PSQL="${PSQL:-psql}"
cd "$(dirname "$0")"

for f in $(ls [0-9][0-9]_*.sql | sort); do
  if [ "$f" = "02_personal_schema.sql" ]; then
    continue
  fi
  echo "→ $f"
  "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "→ storage bucket 'resumes' (private)"
"$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "insert into storage.buckets (id, name, public) values ('resumes', 'resumes', false) on conflict (id) do nothing;"

echo "→ reload API schema cache"
"$PSQL" "$DATABASE_URL" -q -c "notify pgrst, 'reload schema';"

echo "Done."
