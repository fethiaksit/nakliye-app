#!/usr/bin/env bash
# Roll back an existing Compose backend without replacing its network/env/ports.
# DEPLOY_CONTAINER_NAME=nakliye-beta-backend-1 ./rollback.sh --record-current
# DEPLOY_CONTAINER_NAME=nakliye-beta-backend-1 ./rollback.sh <local-image-or-previous>
set -euo pipefail
umask 077
STATE_DIR="${ROLLBACK_STATE_DIR:-/tmp/nakliyego-deploy-state}"
CONTAINER_NAME="${DEPLOY_CONTAINER_NAME:-nakliye-app-backend-1}"
MODE="${1:-}"
if [[ "$MODE" == --record-current ]]; then CONTAINER_NAME="${2:-$CONTAINER_NAME}"; fi
[[ "$CONTAINER_NAME" =~ ^[a-zA-Z0-9_.-]+$ ]] || { echo 'Invalid container name' >&2; exit 2; }
if [[ "$CONTAINER_NAME" == nakliye-beta-backend-1 ]]; then DEFAULT_PORT=8081; else DEFAULT_PORT=8080; fi
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:$DEFAULT_PORT/health/ready}"
mkdir -p "$STATE_DIR"
LAST_GOOD_FILE="$STATE_DIR/$CONTAINER_NAME.last_good_image"
log() { echo "[NakliyeGo Rollback] $*"; }

if [[ "$MODE" == --record-current ]]; then
    record_tmp=$(mktemp "$STATE_DIR/.image.XXXXXX")
    if ! docker inspect --format '{{.Image}}' "$CONTAINER_NAME" > "$record_tmp"; then rm -f "$record_tmp"; exit 1; fi
    mv "$record_tmp" "$LAST_GOOD_FILE"
    log "Immutable current image recorded for $CONTAINER_NAME"
    exit 0
fi
if [[ "$MODE" == --dry-run ]]; then
    log "DRY-RUN only: backend=$CONTAINER_NAME target=${2:-previous} readiness=$HEALTH_URL"
    log 'No container or data was changed; this is not an executed rollback test.'
    exit 0
fi
TARGET_IMAGE="${1:-previous}"
if [[ "$TARGET_IMAGE" == previous ]]; then TARGET_IMAGE=$(cat "$LAST_GOOD_FILE"); fi
[[ "$TARGET_IMAGE" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$ ]] || { echo 'Invalid image' >&2; exit 2; }
# Validate image and Compose configuration before stopping/recreating anything.
docker image inspect "$TARGET_IMAGE" >/dev/null
CURRENT_IMAGE=$(docker inspect --format '{{.Image}}' "$CONTAINER_NAME")
PROJECT=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$CONTAINER_NAME")
FILES=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$CONTAINER_NAME")
WORKDIR=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CONTAINER_NAME")
SERVICE=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$CONTAINER_NAME")
[[ "$SERVICE" == backend && -n "$PROJECT" && -d "$WORKDIR" ]] || { echo 'Refusing non-Compose/non-backend container' >&2; exit 2; }
OVERRIDE="$STATE_DIR/$CONTAINER_NAME.rollback.yml"
COMPOSE=(docker compose -p "$PROJECT")
IFS=',' read -ra CONFIG_FILES <<< "$FILES"
for config_file in "${CONFIG_FILES[@]}"; do
    [[ "$config_file" == "$OVERRIDE" ]] && continue
    [[ -f "$config_file" ]] || { echo 'Compose configuration file missing' >&2; exit 2; }
    COMPOSE+=(-f "$config_file")
done
COMPOSE+=(-f "$OVERRIDE")
write_override() { printf 'services:\n  backend:\n    image: %s\n' "$1" > "$OVERRIDE"; }
apply_image() {
    write_override "$1"
    (cd "$WORKDIR" && "${COMPOSE[@]}" config --quiet && "${COMPOSE[@]}" up -d --no-deps --no-build --pull never backend)
}
ready() {
    local attempt
    for attempt in {1..30}; do
        if [[ $(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER_NAME") == healthy ]] && curl --max-time 3 -fsS "$HEALTH_URL" >/dev/null; then return 0; fi
        sleep 1
    done
    return 1
}
log "Rolling back only $PROJECT/backend to $TARGET_IMAGE"
if apply_image "$TARGET_IMAGE" && ready; then
    log "Rollback executed and healthy: $TARGET_IMAGE"
else
    log 'Target failed readiness; restoring the image that was running before this attempt.' >&2
    apply_image "$CURRENT_IMAGE" && ready || log 'CRITICAL: fallback requires operator attention' >&2
    exit 1
fi
