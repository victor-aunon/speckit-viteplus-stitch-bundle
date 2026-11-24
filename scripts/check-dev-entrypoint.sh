#!/usr/bin/env bash
# ==============================================================================
# check-dev-entrypoint.sh
# ------------------------------------------------------------------------------
# Runtime Entrypoint Contract Gate.
#
# Answers the question no other gate can: does the feature's declared runtime
# actually start and serve what the spec promises?
#
# Why this exists: a non-UI feature (has_ui=false) inside a Vite+ project can
# pass EVERY deterministic gate while `npm run dev` keeps booting the Vite dev
# server on 5173 and the API only lives behind a manual `tsx src/main.ts`.
# Green gates over the wrong process is the "lying green" this bundle prevents.
#
# IMPORTANT MODEL: `has_ui` describes the FEATURE, not the PROJECT. A backend
# feature normally lives inside a React/Vite project, so this gate NEVER asks to
# remove React, Vite or the existing `dev` script. It only verifies the runtime
# the feature declares in `specs/<feature>/runtime.json`:
#
#   {"kind": "http", "command": "npm run dev:api", "port": 3000, "readiness": "/health"}
#   {"kind": "none", "reason": "domain-only feature, no runtime entrypoint"}
#
# Guarantees:
#   - The declaration lives with the feature, not the project (no guessing from
#     dependencies or file names).
#   - `kind: http` requires a real HTTP 2xx on the declared port and path, from a
#     process this gate started itself.
#   - A port already answering before the gate starts is an error, not a pass:
#     grading someone else's process proves nothing about the declared command.
#   - `kind: none` is allowed but recorded as `skipped` with its reason, so the
#     independent auditor can check the declaration against the spec.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

show_help() {
  cat << 'EOF'
Usage: check-dev-entrypoint.sh [options]

Verifies the feature's declared runtime contract (specs/<feature>/runtime.json).

Options:
  --help                  Show this help message
  --runtime=<path>        Runtime contract file (default: <feature-dir>/runtime.json)
  --feature-dir=<path>    Feature directory (default: newest specs/* directory)
  --require-contract      Fail when the feature has no runtime.json (non-UI features)
  --cmd=<command>         Override runtime.command
  --port=<N>              Port the runtime must answer on (overrides runtime.port)
  --path=<path>           Readiness path (overrides runtime.readiness; default: /health)
  --url=<base-url>        Base URL without port (default: http://127.0.0.1)
  --timeout=<seconds>     Readiness timeout before failing (default: 30)
  --evidence-dir=<path>   Directory to write machine evidence JSON (default: <feature-dir>/evidence)
  --dry-run               Print the resolved contract without starting anything

Environment variables:
  DEV_ENTRYPOINT_PORT     Port override (lower precedence than --port)
  DEV_ENTRYPOINT_CMD      Command override (lower precedence than --cmd)

Runtime contract (specs/<feature>/runtime.json):
  {
    "kind": "http",
    "command": "npm run dev:api",
    "port": 3000,
    "readiness": "/health"
  }
  { "kind": "none", "reason": "domain-only feature" }

Exit Codes:
  0                       Runtime contract satisfied (or skipped with a reason)
  1                       Contract violation (missing contract, no HTTP, wrong status)
  2                       Environment problem (missing node/curl, port already in use)
EOF
}

RUNTIME_FILE=""
FEATURE_DIR=""
REQUIRE_CONTRACT=false
DEV_CMD="${DEV_ENTRYPOINT_CMD:-}"
PORT=""
READY_PATH=""
BASE_URL="http://127.0.0.1"
TIMEOUT=30
EVIDENCE_DIR=""
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --runtime=*)
      RUNTIME_FILE="${arg#*=}"
      ;;
    --feature-dir=*)
      FEATURE_DIR="${arg#*=}"
      ;;
    --require-contract)
      REQUIRE_CONTRACT=true
      ;;
    --cmd=*)
      DEV_CMD="${arg#*=}"
      ;;
    --port=*)
      PORT="${arg#*=}"
      ;;
    --path=*)
      READY_PATH="${arg#*=}"
      ;;
    --url=*)
      BASE_URL="${arg#*=}"
      ;;
    --timeout=*)
      TIMEOUT="${arg#*=}"
      ;;
    --evidence-dir=*)
      EVIDENCE_DIR="${arg#*=}"
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    *)
      ;;
  esac
done

if [ -z "$PORT" ] && [ -n "${DEV_ENTRYPOINT_PORT:-}" ]; then
  PORT="$DEV_ENTRYPOINT_PORT"
fi

# Resolve feature directory: flag > SPECIFY_FEATURE_DIR > newest specs/* directory
if [ -z "$FEATURE_DIR" ] && [ -n "${SPECIFY_FEATURE_DIR:-}" ]; then
  FEATURE_DIR="$SPECIFY_FEATURE_DIR"
fi
if [ -z "$FEATURE_DIR" ] && [ -d "specs" ]; then
  FEATURE_DIR=$(find specs -mindepth 1 -maxdepth 1 -type d | sort -r | head -n 1 || true)
fi
if [ -z "$RUNTIME_FILE" ] && [ -n "$FEATURE_DIR" ]; then
  RUNTIME_FILE="$FEATURE_DIR/runtime.json"
fi
if [ -z "$EVIDENCE_DIR" ] && [ -n "$FEATURE_DIR" ] && [ -d "$FEATURE_DIR" ]; then
  EVIDENCE_DIR="$FEATURE_DIR/evidence"
fi

START_TIME=$(date +%s 2>/dev/null || echo 0)

emit_gate_telemetry() {
  local status="$1"
  local code="$2"
  local end_time=$(date +%s 2>/dev/null || echo 0)
  local dur=$(( (end_time - START_TIME) * 1000 ))
  if [ -f "$SCRIPT_DIR/emit-telemetry.sh" ]; then
    bash "$SCRIPT_DIR/emit-telemetry.sh" \
      --gate="check-dev-entrypoint" \
      --status="$status" \
      --duration-ms="$dur" \
      --exit-code="$code" \
      ${FEATURE_DIR:+--feature-dir="$FEATURE_DIR"} \
      ${EVIDENCE_DIR:+--evidence-file="$EVIDENCE_DIR/runtime-entrypoint.json"} 2>/dev/null || true
  fi
}

# Evidence is machine-generated and append-only: <gate>.history.jsonl grows only
# on state changes, never on identical repeats (see check-bundle-budget.sh).
write_evidence() {
  local status="$1"
  local reason="$2"
  local http_status="$3"
  local kind="$4"
  if [ -n "$EVIDENCE_DIR" ]; then
    mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
    if command -v node >/dev/null 2>&1; then
      node -e '
        const fs = require("fs");
        const [outPath, status, reason, httpStatus, kind, port, url, cmd, contract] = process.argv.slice(1);
        let previousStatus;
        try {
          const previous = JSON.parse(fs.readFileSync(outPath, "utf8"));
          if (previous && previous.status) previousStatus = previous.status;
        } catch {}
        const data = {
          timestamp: new Date().toISOString(),
          gate: "check-dev-entrypoint",
          status,
          previous_status: previousStatus,
          metrics: {
            kind: kind || undefined,
            contract: contract || undefined,
            command: cmd || undefined,
            port: Number(port) || 0,
            url: url || undefined,
            http_status: httpStatus ? Number(httpStatus) || undefined : undefined,
            reason: reason || undefined
          },
          evidence_type: "runtime_entrypoint_contract"
        };
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
        const historyPath = outPath.replace(/\.json$/, ".history.jsonl");
        const comparable = (entry) => {
          const { timestamp, previous_status, ...rest } = entry;
          return JSON.stringify(rest);
        };
        let lastHistory = "";
        try {
          const lines = fs.readFileSync(historyPath, "utf8").split("\n").filter(Boolean);
          if (lines.length > 0) lastHistory = lines[lines.length - 1];
        } catch {}
        let changed = true;
        if (lastHistory) {
          try {
            changed = comparable(JSON.parse(lastHistory)) !== comparable(data);
          } catch {
            changed = true;
          }
        }
        if (changed) fs.appendFileSync(historyPath, JSON.stringify(data) + "\n", "utf8");
      ' "$EVIDENCE_DIR/runtime-entrypoint.json" "$status" "$reason" "$http_status" "$kind" "$PORT" "${TARGET_URL:-}" "$DEV_CMD" "${RUNTIME_FILE:-}" 2>/dev/null || true
    fi
  fi
}

fail() {
  local message="$1"
  shift
  echo ""
  echo "❌ [RUNTIME ENTRYPOINT GATE FAILED]: $message"
  for line in "$@"; do
    echo "   $line"
  done
  write_evidence "failed" "$message" "" "$KIND"
  emit_gate_telemetry "failed" 1
  exit 1
}

read_contract() {
  local field="$1"
  node -e '
    const fs = require("fs");
    const [file, field] = process.argv.slice(1);
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const value = data[field];
      if (value === undefined || value === null) process.exit(0);
      process.stdout.write(String(value));
    } catch {
      process.stdout.write("");
    }
  ' "$RUNTIME_FILE" "$field" 2>/dev/null || true
}

echo "======================================================================"
echo "[RUNTIME ENTRYPOINT GATE] Verifying the feature's declared runtime"
echo "======================================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ [RUNTIME ENTRYPOINT GATE ERROR]: 'node' is required to read the runtime contract."
  emit_gate_telemetry "failed" 2
  exit 2
fi

KIND=""
if [ -f "$RUNTIME_FILE" ]; then
  echo "✓ Runtime contract: $RUNTIME_FILE"
  KIND="$(read_contract kind)"
  if [ -z "$KIND" ]; then
    fail "the runtime contract declares no 'kind' ($RUNTIME_FILE)." \
      "Use \"kind\": \"http\" with command/port/readiness, or \"kind\": \"none\" with a reason."
  fi
else
  echo "ℹ️  No runtime contract found at ${RUNTIME_FILE:-<no specs directory>}."
  if [ "$REQUIRE_CONTRACT" = true ]; then
    fail "this feature must declare its runtime contract and none was found." \
      "Create ${RUNTIME_FILE:-specs/<feature>/runtime.json} from .specify/templates/runtime.json.tmpl:" \
      '  {"kind":"http","command":"npm run dev:api","port":3000,"readiness":"/health"}' \
      '  {"kind":"none","reason":"domain-only feature, no runtime entrypoint"}' \
      "Declaring the entrypoint in package.json as 'dev:api' keeps the project's" \
      "'dev' script (Vite/React) untouched."
  fi
  echo "✓ Nothing declared, nothing to verify (status: skipped)."
  write_evidence "skipped" "no_runtime_contract" "" ""
  emit_gate_telemetry "skipped" 0
  exit 0
fi

echo "✓ Declared kind: $KIND"

if [ "$KIND" = "none" ]; then
  REASON="$(read_contract reason)"
  if [ -z "$REASON" ]; then
    fail "\"kind\": \"none\" requires a \"reason\" ($RUNTIME_FILE)." \
      "State why the feature has no runtime entrypoint so the auditor can check it."
  fi
  echo "✓ No runtime entrypoint declared: $REASON"
  write_evidence "skipped" "kind_none: $REASON" "" "$KIND"
  emit_gate_telemetry "skipped" 0
  exit 0
fi

if [ "$KIND" != "http" ]; then
  fail "unsupported runtime kind '$KIND' ($RUNTIME_FILE)." \
    "Supported kinds: 'http' (HTTP server) and 'none' (no runtime entrypoint)."
fi

[ -z "$DEV_CMD" ] && DEV_CMD="$(read_contract command)"
[ -z "$READY_PATH" ] && READY_PATH="$(read_contract readiness)"

if [ -z "$DEV_CMD" ]; then
  fail "\"kind\": \"http\" requires a \"command\" ($RUNTIME_FILE)." \
    "Point it at the API entrypoint, not the UI dev server." \
    'Example: {"kind":"http","command":"npm run dev:api","port":3000,"readiness":"/health"}'
fi

# Port resolution: --port override > contract. The gate never guesses the port
# from source code: a regex over the typed env module would happily match the
# "between 1 and 65535" of a validation message. Declaring it keeps the check
# honest, and drift between runtime.json and src/config/env.ts shows up as a
# failed probe instead of a silent success.
PORT_SOURCE="contract"
if [ -n "$PORT" ]; then
  PORT_SOURCE="flag"
else
  PORT="$(read_contract port)"
fi

if [ -z "$PORT" ]; then
  fail "\"kind\": \"http\" requires a \"port\" ($RUNTIME_FILE)." \
    "Declare the same port your typed env config exports (src/config/env.ts)," \
    "or pass --port=<N> for an ad-hoc verification." \
    'Example: {"kind":"http","command":"npm run dev:api","port":3000,"readiness":"/health"}'
fi

if ! printf '%s' "$PORT" | grep -Eq '^[0-9]+$' || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  fail "invalid port '$PORT' in the runtime contract ($RUNTIME_FILE)." \
    "Expected an integer between 1 and 65535."
fi

if [ -z "$READY_PATH" ]; then
  READY_PATH="/health"
fi
case "$READY_PATH" in
  /*) ;;
  *) READY_PATH="/$READY_PATH" ;;
esac

TARGET_URL="$BASE_URL:$PORT$READY_PATH"

echo "✓ Runtime command: $DEV_CMD"
echo "✓ Resolved port: $PORT (source: $PORT_SOURCE)"
echo "✓ Readiness URL: $TARGET_URL (timeout: ${TIMEOUT}s)"

if [ "$DRY_RUN" = true ]; then
  echo "✓ [RUNTIME ENTRYPOINT GATE]: Dry run completed successfully. Nothing was started."
  emit_gate_telemetry "passed" 0
  exit 0
fi

# The declared command must not be the frontend dev server: it claims to be the
# API. This is a contract error, not a project-type restriction.
if printf '%s' "$DEV_CMD" | grep -Eq '(^|[^[:alnum:]_-])(vp|vite|vite-plus)[[:space:]]+(dev|serve|preview)|(^|[^[:alnum:]_-])(vite|vp|vite-plus)[[:space:]]*$|(^|[^[:alnum:]_-])(next|nuxt|astro)[[:space:]]+(dev|start)'; then
  fail "the runtime contract points at a frontend dev server: \"$DEV_CMD\"." \
    "Declare the API entrypoint instead (for example \"npm run dev:api\" with" \
    '"dev:api": "tsx watch src/main.ts" in package.json).' \
    "The project keeps its own 'dev' script for Vite; the API is a second process."
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "❌ [RUNTIME ENTRYPOINT GATE ERROR]: 'curl' is required to probe $TARGET_URL."
  emit_gate_telemetry "failed" 2
  exit 2
fi

# Integrity: refuse to grade a server that was already running. Probing someone
# else's process proves nothing about the declared command.
if curl -s -o /dev/null --max-time 2 --connect-timeout 1 "$TARGET_URL" >/dev/null 2>&1; then
  echo "❌ [RUNTIME ENTRYPOINT GATE ERROR]: something already answers on $TARGET_URL."
  echo "   The gate will not certify a process it did not start. Stop it and re-run:"
  echo "     lsof -ti tcp:$PORT | xargs kill"
  emit_gate_telemetry "failed" 2
  exit 2
fi

LOG_FILE="$(mktemp "${TMPDIR:-/tmp}/speckit-runtime-entrypoint-XXXXXX" 2>/dev/null || printf '%s/speckit-runtime-entrypoint-%s.log' "${TMPDIR:-/tmp}" "$$")"
SERVER_PID=""
USE_SETSID=false

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    if [ "$USE_SETSID" = true ]; then
      kill -TERM "-$SERVER_PID" 2>/dev/null || true
    else
      pkill -TERM -P "$SERVER_PID" 2>/dev/null || true
      kill -TERM "$SERVER_PID" 2>/dev/null || true
    fi
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL "$SERVER_PID" 2>/dev/null || true
    if [ "$USE_SETSID" = true ]; then
      kill -KILL "-$SERVER_PID" 2>/dev/null || true
    else
      pkill -KILL -P "$SERVER_PID" 2>/dev/null || true
    fi
  fi
  rm -f "$LOG_FILE" 2>/dev/null || true
  exit $code
}
trap cleanup EXIT INT TERM

echo ""
echo "Starting declared runtime: $DEV_CMD"
if command -v setsid >/dev/null 2>&1; then
  USE_SETSID=true
  setsid sh -c "$DEV_CMD" > "$LOG_FILE" 2>&1 &
else
  sh -c "$DEV_CMD" > "$LOG_FILE" 2>&1 &
fi
SERVER_PID=$!
# Detach from the job table: cleanup kills the process group explicitly, and
# without disown the shell would print "Terminated: 15" on every teardown.
disown "$SERVER_PID" 2>/dev/null || true

HTTP_STATUS=""
DEADLINE=$(( $(date +%s 2>/dev/null || echo 0) + TIMEOUT ))
while :; do
  HTTP_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 --connect-timeout 1 "$TARGET_URL" 2>/dev/null || true)"
  HTTP_STATUS="${HTTP_STATUS:-000}"
  if [ "$HTTP_STATUS" != "000" ]; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  if [ "$(date +%s 2>/dev/null || echo 0)" -ge "$DEADLINE" ]; then
    break
  fi
  sleep 0.5
done

dump_log() {
  echo ""
  echo "--- runtime output (tail) ---"
  tail -n 25 "$LOG_FILE" 2>/dev/null || true
  echo "-----------------------------"
}

if ! kill -0 "$SERVER_PID" 2>/dev/null && [ "$HTTP_STATUS" = "000" ]; then
  dump_log
  if grep -qE 'EADDRINUSE|address already in use' "$LOG_FILE" 2>/dev/null; then
    echo "❌ [RUNTIME ENTRYPOINT GATE ERROR]: port $PORT is already in use by another process."
    echo "   Release it and re-run: lsof -ti tcp:$PORT | xargs kill"
    emit_gate_telemetry "failed" 2
    exit 2
  fi
  fail "\"$DEV_CMD\" exited before serving $TARGET_URL." \
    "The declared runtime must stay in the foreground and serve HTTP." \
    "Install dependencies first (npm install) and check the log above."
fi

case "$HTTP_STATUS" in
  2??)
    echo ""
    echo "✅ [RUNTIME ENTRYPOINT GATE PASSED]: $DEV_CMD serves HTTP $HTTP_STATUS on $TARGET_URL"
    echo "   Reproduce with: curl -i $TARGET_URL"
    write_evidence "passed" "served" "$HTTP_STATUS" "$KIND"
    emit_gate_telemetry "passed" 0
    exit 0
    ;;
  000)
    dump_log
    fail "$DEV_CMD did not answer on $TARGET_URL within ${TIMEOUT}s." \
      "The process is running but nothing listens on port $PORT." \
      "Bind the server to the port declared in $RUNTIME_FILE (same value as src/config/env.ts)." \
      "Startup hint: $DEV_CMD"
    ;;
  *)
    dump_log
    fail "$DEV_CMD answered HTTP $HTTP_STATUS on $TARGET_URL (expected 2xx)." \
      "The readiness path declared in the contract must exist and succeed."
    ;;
esac