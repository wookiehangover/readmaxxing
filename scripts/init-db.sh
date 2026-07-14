#!/usr/bin/env bash
set -euo pipefail

# Initialize the readmax database schema and run all migrations
# Requires DATABASE_URL environment variable

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL environment variable is not set"
  exit 1
fi

echo "Initializing database schema..."

# Extract connection string, removing only the search_path parameter for psql
# psql doesn't support search_path in the URL; preserve other params like sslmode
BASE_URL=$(echo "$DATABASE_URL" | sed 's/[?&]search_path=[^&]*//g' | sed 's/?&/?/g')
echo "Base URL (no params): ${BASE_URL}"

psql "$BASE_URL" -c "SELECT version();" || {
  echo "Error: Failed to connect to database"
  exit 1
}

echo "Initializing readmax schema..."

# Apply baseline schema files in order
echo "Applying core schema..."
psql "$BASE_URL" -v ON_ERROR_STOP=1 -f database/readmax/core.sql

echo "Applying annotations schema..."
psql "$BASE_URL" -v ON_ERROR_STOP=1 -f database/readmax/annotations.sql

echo "Applying chat schema..."
psql "$BASE_URL" -v ON_ERROR_STOP=1 -f database/readmax/chat.sql

echo "Applying settings schema..."
psql "$BASE_URL" -v ON_ERROR_STOP=1 -f database/readmax/settings.sql

echo "Applying share schema..."
psql "$BASE_URL" -v ON_ERROR_STOP=1 -f database/readmax/share.sql

# Apply all migrations in order
echo "Applying migrations..."
for migration in database/migrations/*.sql; do
  if [ "$migration" = "database/migrations/.gitkeep" ]; then
    continue
  fi
  if [ -f "$migration" ]; then
    echo "  Applying $(basename "$migration")..."
    psql "$BASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
  fi
done

echo "Database initialization complete!"
