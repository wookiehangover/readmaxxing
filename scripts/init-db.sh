#!/usr/bin/env bash
set -euo pipefail

# Initialize the readmax database schema and run all migrations
# Requires DATABASE_URL environment variable

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL environment variable is not set"
  exit 1
fi

echo "DATABASE_URL: ${DATABASE_URL}"
echo "Testing database connection..."
psql "$DATABASE_URL" -c "SELECT version();" || {
  echo "Error: Failed to connect to database"
  exit 1
}

echo "Initializing readmax schema..."

# Apply baseline schema files in order
echo "Applying core schema..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/readmax/core.sql

echo "Applying annotations schema..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/readmax/annotations.sql

echo "Applying chat schema..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/readmax/chat.sql

echo "Applying settings schema..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/readmax/settings.sql

echo "Applying share schema..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/readmax/share.sql

# Apply all migrations in order
echo "Applying migrations..."
for migration in database/migrations/*.sql; do
  if [ "$migration" = "database/migrations/.gitkeep" ]; then
    continue
  fi
  if [ -f "$migration" ]; then
    echo "  Applying $(basename "$migration")..."
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
  fi
done

echo "Database initialization complete!"
