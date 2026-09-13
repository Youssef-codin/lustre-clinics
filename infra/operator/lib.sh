# Shared by the operator scripts. Sourced, not run.

load_config() {
    CLINIC=$1
    local file="${XDG_CONFIG_HOME:-$HOME/.config}/lustre/$CLINIC.env"
    if [[ ! -r $file ]]; then
        echo "missing $file: run infra/operator/install.sh $CLINIC first" >&2
        exit 1
    fi
    # shellcheck source=/dev/null
    source "$file"
    : "${LUSTRE_HOST:?set in $file}" "${REMOTE_BACKUP_DIR:?set in $file}" "${AGE_RECIPIENT:?set in $file}"
    LOCAL_BACKUP_DIR=${LOCAL_BACKUP_DIR:-$HOME/lustre-backups/$CLINIC}
    KEEP_DAILY=${KEEP_DAILY:-14}
    KEEP_MONTHLY=${KEEP_MONTHLY:-12}
    STALE_AFTER_HOURS=${STALE_AFTER_HOURS:-72}
    STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/lustre/$CLINIC"
    mkdir -p "$STATE_DIR"
}

log() {
    printf '%s\n' "$*" >&2
}

# Discord gets the clinic, a code and a fixed sentence. Never anything read out
# of a dump: no names, no counts, no amounts.
alert() {
    local code=$1 summary=$2
    log "ALERT $code: $summary"
    [[ -n ${DISCORD_WEBHOOK_URL:-} ]] || return 0
    curl -fsS --max-time 10 -H 'content-type: application/json' \
        -d "{\"content\":\"**$CLINIC** \`$code\`\\n$summary\"}" \
        "$DISCORD_WEBHOOK_URL" >/dev/null ||
        log "discord webhook failed"
}

# The same alert at most once per `hours`, so an hourly timer does not repeat
# itself until the problem is fixed.
alert_throttled() {
    local code=$1 summary=$2 hours=$3 stamp="$STATE_DIR/alerted-$1"
    if [[ -e $stamp ]] && (($(date +%s) - $(stat -c %Y "$stamp") < hours * 3600)); then
        return 0
    fi
    alert "$code" "$summary"
    touch "$stamp"
}

clear_alert() {
    rm -f "$STATE_DIR/alerted-$1"
}

fail() {
    trap - ERR
    alert "$1" "$2"
    exit 1
}

local_backups_newest_first() {
    find "$LOCAL_BACKUP_DIR" -maxdepth 1 -name 'lustre-*.dump.age' -printf '%f\n' 2>/dev/null | sort -r
}

# lustre-2026-09-12T02-00-00Z.dump.age -> seconds since the epoch.
backup_epoch() {
    local stamp=${1#lustre-}
    stamp=${stamp%%.dump*}
    date -d "${stamp:0:13}:${stamp:14:2}:${stamp:17:2}Z" +%s
}
