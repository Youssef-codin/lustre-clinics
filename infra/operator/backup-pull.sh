#!/usr/bin/env bash
# Copies new dumps from a clinic server to this machine. Each one is encrypted
# as it streams in, so plaintext patient data never touches this disk, and its
# checksum is compared against the server's before it counts as pulled.
#
# Run hourly by lustre-backup-pull@<clinic>.timer:
#
#   infra/operator/backup-pull.sh smilemakers
set -Eeuo pipefail

here=$(dirname "$(readlink -f "$0")")
# shellcheck source=lib.sh
source "$here/lib.sh"
load_config "${1:?usage: backup-pull.sh <clinic>}"

trap 'fail backup_pull.failed "Pulling backups from the clinic failed. Check journalctl --user -u lustre-backup-pull@$CLINIC."' ERR

mkdir -p "$LOCAL_BACKUP_DIR"
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=15)

# The server or this machine being off, or this machine being on another
# tailnet, is normal. Only a backup going stale is worth an alert.
if remote_files=$(ssh "${ssh_opts[@]}" "$LUSTRE_HOST" \
    "cd '$REMOTE_BACKUP_DIR' && find . -maxdepth 1 -name 'lustre-*.dump' -printf '%f\n'"); then
    reachable=true
else
    reachable=false
    remote_files=""
    log "server unreachable, nothing pulled"
fi

oldest_kept=$(local_backups_newest_first | sed -n "${KEEP_DAILY}p")
pulled=0
for name in $remote_files; do
    dest="$LOCAL_BACKUP_DIR/$name.age"
    [[ -e $dest ]] && continue
    # Older than anything retention keeps: it would be pruned straight away.
    if [[ -n $oldest_kept ]] && (($(backup_epoch "$name") < $(backup_epoch "$oldest_kept"))); then
        continue
    fi

    part="$dest.part"
    fifo="$STATE_DIR/pull.fifo"
    rm -f "$fifo" && mkfifo "$fifo"
    sha256sum <"$fifo" | cut -d' ' -f1 >"$part.sha256" &
    hasher=$!
    ssh "${ssh_opts[@]}" "$LUSTRE_HOST" "cat '$REMOTE_BACKUP_DIR/$name'" |
        tee "$fifo" |
        age -r "$AGE_RECIPIENT" -o "$part"
    wait "$hasher"
    rm -f "$fifo"

    remote_sum=$(ssh "${ssh_opts[@]}" "$LUSTRE_HOST" "sha256sum '$REMOTE_BACKUP_DIR/$name'" | cut -d' ' -f1)
    if [[ $(<"$part.sha256") != "$remote_sum" ]]; then
        rm -f "$part" "$part.sha256"
        fail backup_pull.corrupt "A backup changed in transit and was discarded. It will be retried next hour."
    fi
    mv "$part" "$dest"
    rm -f "$part.sha256"
    pulled=$((pulled + 1))
    log "pulled $name"
done

# Newest KEEP_DAILY backups, plus the newest of each of the last KEEP_MONTHLY
# months.
declare -A seen_month=()
index=0
months_kept=0
while IFS= read -r name; do
    index=$((index + 1))
    month=${name:7:7}
    keep=false
    ((index <= KEEP_DAILY)) && keep=true
    if [[ -z ${seen_month[$month]:-} ]]; then
        seen_month[$month]=1
        if ((months_kept < KEEP_MONTHLY)); then
            months_kept=$((months_kept + 1))
            keep=true
        fi
    fi
    $keep || { rm -f -- "${LOCAL_BACKUP_DIR:?}/$name" && log "pruned $name"; }
done < <(local_backups_newest_first)

newest=$(local_backups_newest_first | head -n1)
if [[ -z $newest ]] || (($(date +%s) - $(backup_epoch "$newest") > STALE_AFTER_HOURS * 3600)); then
    if $reachable; then
        summary="No backup newer than $STALE_AFTER_HOURS hours exists on the server. The server's backup job is not running."
    else
        summary="No backup newer than $STALE_AFTER_HOURS hours has reached this machine, and the server is unreachable."
    fi
    alert_throttled backup_pull.stale "$summary" 24
else
    clear_alert backup_pull.stale
fi

log "done: $pulled pulled"
