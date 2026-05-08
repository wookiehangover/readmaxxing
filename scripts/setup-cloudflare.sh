#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
WRANGLER_CONFIG="wrangler.jsonc"
PLACEHOLDER_ID="00000000-0000-0000-0000-000000000000"
HYPERDRIVE_NAME="readmaxxing-pg"
PG_URL="${SETUP_PG_URL:-}"
DRY_RUN=0
ASSUME_YES=0
CHECK_SECRETS=0

usage() {
  cat <<'USAGE'
bash scripts/setup-cloudflare.sh [flags]

  --pg-url <connection-string>   Postgres URL to seed Hyperdrive with (or env SETUP_PG_URL).
  --hyperdrive-name <name>       Override Hyperdrive config name (default: readmaxxing-pg).
  --check-secrets                Read-only: report which Worker secrets are missing, exit.
  --yes                          Skip confirmation prompts (also honored when CI=1).
  --dry-run                      Print every wrangler command instead of running it.
  --help                         Print usage.
USAGE
}

die() {
  echo "[setup] $*" >&2
  exit 1
}

mask_pg_url() {
  local url="$1"
  if [[ "$url" =~ ^([^:]+://)([^/@]+)@([^/?#]+)(.*)$ ]]; then
    printf '%s...@%s%s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}"
  else
    printf '[masked-postgres-url]'
  fi
}

mask_text() {
  local text="$1"
  local masked_pg
  if [ -n "${PG_URL:-}" ]; then
    masked_pg="$(mask_pg_url "$PG_URL")"
    text="${text//$PG_URL/$masked_pg}"
  fi
  printf '%s' "$text"
}

format_command() {
  local out=""
  local arg
  local masked
  local quoted
  for arg in "$@"; do
    masked="$(mask_text "$arg")"
    quoted="$(printf '%q' "$masked")"
    out="$out $quoted"
  done
  printf '%s' "${out# }"
}

run() {
  echo "[exec] $(format_command "$@")"
  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi
  "$@"
}

run_quiet() {
  echo "[exec] $(format_command "$@")"
  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi
  "$@" >/dev/null 2>&1
}

run_capture() {
  local stdout_file
  local stderr_file
  local status
  stdout_file="$(mktemp)"
  stderr_file="$(mktemp)"
  echo "[exec] $(format_command "$@")" >&2
  if [ "$DRY_RUN" -eq 1 ]; then
    rm -f "$stdout_file" "$stderr_file"
    return 0
  fi
  if "$@" >"$stdout_file" 2>"$stderr_file"; then
    cat "$stdout_file"
    rm -f "$stdout_file" "$stderr_file"
    return 0
  fi
  status=$?
  echo "[setup] Command failed: $(format_command "$@")" >&2
  mask_text "$(cat "$stderr_file")" >&2
  echo >&2
  rm -f "$stdout_file" "$stderr_file"
  return "$status"
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [ -z "$value" ]; then
    die "$flag requires a value."
  fi
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --pg-url)
        require_value "$1" "${2:-}"
        PG_URL="$2"
        shift 2
        ;;
      --hyperdrive-name)
        require_value "$1" "${2:-}"
        HYPERDRIVE_NAME="$2"
        shift 2
        ;;
      --check-secrets)
        CHECK_SECRETS=1
        shift
        ;;
      --yes)
        ASSUME_YES=1
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        usage >&2
        die "Unknown argument: $1"
        ;;
    esac
  done
}

require_tools() {
  command -v pnpm >/dev/null 2>&1 || die "Missing pnpm on PATH. Install pnpm and retry."
  if ! command -v jq >/dev/null 2>&1; then
    die "Missing jq on PATH. Install it first, e.g. 'brew install jq' or your OS package manager equivalent."
  fi
}

jsonc_for_jq() {
  sed -E '/^[[:space:]]*\/\//d' "$WRANGLER_CONFIG" | awk '
    { lines[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        line = lines[i]
        j = i + 1
        while (j <= NR && lines[j] ~ /^[[:space:]]*$/) j++
        if (j <= NR && lines[j] ~ /^[[:space:]]*[}\]]/) sub(/,[[:space:]]*$/, "", line)
        print line
      }
    }
  '
}

jsonc_query() {
  jsonc_for_jq | jq -r "$1"
}

confirm_account() {
  local email="$1"
  local account_id="$2"
  local reply
  if [ "$ASSUME_YES" -eq 1 ] || [ "${CI:-}" = "1" ]; then
    return 0
  fi
  printf '[setup] Continue provisioning Cloudflare account %s (%s)? [y/N] ' "$email" "$account_id"
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) die "Aborted before creating or updating Cloudflare resources." ;;
  esac
}

preflight() {
  local whoami_output
  local email
  local account_id
  require_tools
  cd "$REPO_ROOT"
  [ -f "$WRANGLER_CONFIG" ] || die "Missing $WRANGLER_CONFIG at repo root."

  if [ "$DRY_RUN" -eq 1 ]; then
    run pnpm exec wrangler whoami --format json
    echo "[setup] Dry run: skipping wrangler authentication check."
    return 0
  fi

  if ! whoami_output="$(run_capture pnpm exec wrangler whoami --format json)"; then
    die "Wrangler is not authenticated. Run 'pnpm exec wrangler login' and retry."
  fi
  email="$(printf '%s' "$whoami_output" | jq -r '.user.email // .email // "unknown-email"')"
  account_id="$(printf '%s' "$whoami_output" | jq -r '.account.id // .accounts[0].id // .accountId // "unknown-account"')"
  echo "[setup] Cloudflare account: $email ($account_id)"
  if [ "$CHECK_SECRETS" -eq 0 ]; then
    confirm_account "$email" "$account_id"
  fi
}

create_r2_buckets() {
  local bucket_names
  local bucket_name
  bucket_names="$(jsonc_query '.r2_buckets[]?.bucket_name // empty')"
  if [ -z "$bucket_names" ]; then
    echo "[skip] No R2 buckets declared in $WRANGLER_CONFIG."
    return 0
  fi

  for bucket_name in $bucket_names; do
    if [ "$DRY_RUN" -eq 1 ]; then
      run pnpm exec wrangler r2 bucket info "$bucket_name"
      echo "[setup] Dry run: would create bucket if missing: $bucket_name"
      run pnpm exec wrangler r2 bucket create "$bucket_name"
    elif run_quiet pnpm exec wrangler r2 bucket info "$bucket_name"; then
      echo "[skip] R2 bucket '$bucket_name' exists, skipping."
    else
      echo "[setup] Creating R2 bucket '$bucket_name'."
      run pnpm exec wrangler r2 bucket create "$bucket_name"
    fi
  done
}

get_pg_url() {
  if [ -n "$PG_URL" ]; then
    return 0
  fi
  if [ "${CI:-}" = "1" ]; then
    die "A Postgres URL is required. Pass --pg-url or set SETUP_PG_URL."
  fi
  printf '[setup] Postgres connection string for Hyperdrive: '
  read -r -s PG_URL
  echo
  [ -n "$PG_URL" ] || die "A Postgres URL is required to create Hyperdrive."
}

extract_id() {
  local input="$1"
  local id
  id="$(printf '%s' "$input" | jq -r '.. | objects | .id? // empty' 2>/dev/null | head -n 1 || true)"
  if [ -z "$id" ]; then
    id="$(printf '%s' "$input" | grep -Eo '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -n 1 || true)"
  fi
  printf '%s' "$id"
}

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[\/&]/\\&/g'
}

write_hyperdrive_id() {
  local new_id="$1"
  local escaped_id
  escaped_id="$(escape_sed_replacement "$new_id")"
  echo "[setup] Writing Hyperdrive id to $WRANGLER_CONFIG."
  echo "[exec] sed -i.bak '/\"binding\": \"HYPERDRIVE\"/,/}/ s/\"id\": \"[^\"]*\"/\"id\": \"$new_id\"/' $WRANGLER_CONFIG"
  if [ "$DRY_RUN" -eq 0 ]; then
    sed -i.bak "/\"binding\": \"HYPERDRIVE\"/,/}/ s/\"id\": \"[^\"]*\"/\"id\": \"$escaped_id\"/" "$WRANGLER_CONFIG"
    rm -f "$WRANGLER_CONFIG.bak"
  fi
  run pnpm oxfmt "$WRANGLER_CONFIG"
}

create_or_reuse_hyperdrive() {
  local current_id
  local create_output
  local resolved_id
  current_id="$(jsonc_query '.hyperdrive[0].id // ""')"

  if [ -n "$current_id" ] && [ "$current_id" != "$PLACEHOLDER_ID" ]; then
    echo "[setup] Reusing existing Hyperdrive id '$current_id'."
    run pnpm exec wrangler hyperdrive get "$current_id"
    echo "[skip] $WRANGLER_CONFIG already contains a real Hyperdrive id."
    return 0
  fi

  get_pg_url
  echo "[setup] Creating Hyperdrive config '$HYPERDRIVE_NAME' for $(mask_pg_url "$PG_URL")."

  if [ "$DRY_RUN" -eq 1 ]; then
    run pnpm exec wrangler hyperdrive create "$HYPERDRIVE_NAME" --connection-string "$PG_URL" --format json
    echo "[setup] Dry run: would write the returned Hyperdrive id to $WRANGLER_CONFIG."
    return 0
  fi

  if ! create_output="$(run_capture pnpm exec wrangler hyperdrive create "$HYPERDRIVE_NAME" --connection-string "$PG_URL" --format json)"; then
    echo "[setup] Retrying Hyperdrive create without --format json."
    create_output="$(run_capture pnpm exec wrangler hyperdrive create "$HYPERDRIVE_NAME" --connection-string "$PG_URL")"
  fi
  resolved_id="$(extract_id "$create_output")"
  [ -n "$resolved_id" ] || die "Unable to find a Hyperdrive id in wrangler output."
  write_hyperdrive_id "$resolved_id"
}

print_secret_commands() {
  cat <<'SECRETS'
[setup] Required Worker secret commands:
pnpm exec wrangler secret put WEBAUTHN_RP_ID
pnpm exec wrangler secret put WEBAUTHN_RP_ORIGIN
pnpm exec wrangler secret put AI_GATEWAY_API_KEY
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm exec wrangler secret put ANTHROPIC_BASE_URL   # optional
SECRETS
}

check_secrets() {
  local secret_output
  local names
  local secret
  print_secret_commands
  if [ "$DRY_RUN" -eq 1 ]; then
    run pnpm exec wrangler secret list --format json
    echo "[setup] Dry run: skipping secret list parsing."
    return 0
  fi
  secret_output="$(run_capture pnpm exec wrangler secret list --format json)"
  names="$(printf '%s' "$secret_output" | jq -r 'if type == "array" then .[]?.name else .secrets[]?.name end')"
  for secret in WEBAUTHN_RP_ID WEBAUTHN_RP_ORIGIN AI_GATEWAY_API_KEY ANTHROPIC_API_KEY; do
    if printf '%s\n' "$names" | grep -Fxq "$secret"; then
      echo "[skip] Secret '$secret' exists."
    else
      echo "[setup] Missing required secret: $secret"
    fi
  done
  if printf '%s\n' "$names" | grep -Fxq ANTHROPIC_BASE_URL; then
    echo "[skip] Optional secret 'ANTHROPIC_BASE_URL' exists."
  else
    echo "[setup] Optional secret not set: ANTHROPIC_BASE_URL"
  fi
}

print_next_steps() {
  cat <<'NEXT'
[next] Next steps:
[next] 1. Update PUBLIC_SITE_URL in wrangler.jsonc to the deployed origin.
[next] 2. Apply the Postgres schema once:
[next]    psql "$PG_URL" -f database/readmax/core.sql
[next]    for f in database/migrations/*.sql; do psql "$PG_URL" -f "$f"; done
[next] 3. Validate and deploy:
[next]    pnpm exec wrangler deploy --dry-run
[next]    pnpm exec wrangler deploy
[next] Reminder: this script does not migrate Vercel Blob data. Use scripts/backfill-blob-to-r2.ts separately when you're ready to migrate.
NEXT
}

main() {
  parse_args "$@"
  preflight
  if [ "$CHECK_SECRETS" -eq 1 ]; then
    check_secrets
    return 0
  fi
  create_r2_buckets
  create_or_reuse_hyperdrive
  print_secret_commands
  print_next_steps
}

main "$@"