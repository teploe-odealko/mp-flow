#!/bin/bash
set -e

echo "=== OpenMPFlow Database Initialization ==="

# Create migration tracking table
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT now()
);
SQL

apply_migration() {
  local filepath="$1"
  local fname
  fname=$(basename "$filepath")

  local already
  already=$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
    "SELECT 1 FROM schema_migrations WHERE filename='$fname'")

  if [ "$already" != "1" ]; then
    echo "Applying $fname..."
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$filepath"
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
      "INSERT INTO schema_migrations(filename) VALUES('$fname')"
  else
    echo "Skipping $fname (already applied)"
  fi
}

# Apply init.sql first
if [ -f /migrations/init.sql ]; then
  apply_migration /migrations/init.sql
fi

# Apply numbered migrations in sorted order
for f in $(ls /migrations/0*.sql 2>/dev/null | sort); do
  apply_migration "$f"
done

echo "=== Database initialization complete ==="
