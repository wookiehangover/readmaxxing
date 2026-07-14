# E2E Tests

End-to-end tests using Playwright. The test suite includes both offline-capable tests (workspace, PDF, basic epub) and database-dependent tests (chat, sharing) that require Postgres and Redis.

## Running tests locally

### Prerequisites

1. **Start local services** (Postgres + Redis):
   ```bash
   docker-compose up -d
   ```

2. **Initialize the database**:
   ```bash
   export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?search_path=readmax"
   bash scripts/init-db.sh
   ```

3. **Set environment variables**:
   ```bash
   export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?search_path=readmax"
   export REDIS_URL="redis://localhost:6379"
   export WEBAUTHN_RP_ID="localhost"
   export WEBAUTHN_RP_ORIGIN="http://localhost:5173"
   ```

   Or create `.env.local`:
   ```bash
   cp .env.example .env.local
   # Edit .env.local with the above values
   ```

### Run all tests

```bash
pnpm e2e
```

### Run specific tests

```bash
# Run one test file
pnpm playwright test e2e/workspace.spec.ts

# Run one test by name
pnpm playwright test -g "uploads and opens epub"

# Run in UI mode for debugging
pnpm playwright test --ui

# Run in headed mode to see the browser
pnpm playwright test --headed
```

## Test organization

### Database-independent tests
These tests work without Postgres/Redis and test core offline functionality:

- `workspace.spec.ts` — workspace layout, epub uploads, reader navigation
- `pdf.spec.ts` — PDF upload and rendering
- `signed-out-first-open.spec.ts` — offline-first user experience

### Database-dependent tests
These tests require Postgres and use `skipIfAuthNotConfigured()` to skip gracefully when the database is unavailable:

- `chat.spec.ts` — AI chat with tool use (create highlights, append to notes, resumable streaming)
- `share.spec.ts` — Book sharing via blob storage and share links

## Performance optimizations

The test suite uses several optimizations for faster execution:

1. **Parallel execution**: Tests run in parallel with 2 workers in CI
2. **Shared dev server**: A single `react-router dev` server is reused across all tests
3. **Reduced retries**: Only 2 retries in CI (0 locally)
4. **Efficient media capture**: Videos/screenshots only on failure
5. **Collapsed sidebar**: Pre-collapsed to avoid layout shift races during epub initialization

## CI

GitHub Actions runs e2e tests with Docker services for Postgres and Redis. The workflow:

1. Starts Postgres and Redis as service containers
2. Installs dependencies
3. Initializes the database schema
4. Builds the production bundle
5. Runs tests with 2 parallel workers

See `.github/workflows/ci.yml` for the full configuration.
