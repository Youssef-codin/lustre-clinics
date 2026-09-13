#!/usr/bin/env bash
# Sets up this machine to hold a clinic's off-site backups: the clinic's config
# file and the hourly pull timer. Safe to re-run.
#
#   infra/operator/install.sh smilemakers
set -euo pipefail

clinic=${1:?usage: install.sh <clinic>}
here=$(dirname "$(readlink -f "$0")")
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/lustre"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

for cmd in age age-keygen ssh curl; do
    command -v "$cmd" >/dev/null || {
        echo "missing: $cmd" >&2
        exit 1
    }
done
mkdir -p "$config_dir" "$unit_dir"

config="$config_dir/$clinic.env"
if [[ ! -e $config ]]; then
    # Only the public half is kept on this machine. It can encrypt backups but
    # not open them, so a stolen laptop gives away nothing.
    read -rp "Existing backup public key (age1..., empty to create a new key): " recipient
    if [[ -z $recipient ]]; then
        identity=$(age-keygen 2>/dev/null)
        recipient=$(printf '%s\n' "$identity" | age-keygen -y)
        cat <<EOF

New backup key. Save the line below in your password manager and on paper. It is
not stored anywhere else, and without it no backup can ever be opened:

    $(printf '%s\n' "$identity" | grep '^AGE-SECRET-KEY-')

EOF
        unset identity
    fi
    sed "s|^AGE_RECIPIENT=.*|AGE_RECIPIENT=$recipient|" "$here/clinic.env.example" >"$config"
    chmod 600 "$config"
    echo "Wrote $config. Check LUSTRE_HOST and REMOTE_BACKUP_DIR and set DISCORD_WEBHOOK_URL."
fi

for unit in "$here"/systemd/*; do
    sed "s|@OPERATOR_DIR@|$here|g" "$unit" >"$unit_dir/$(basename "$unit")"
done
systemctl --user daemon-reload
systemctl --user enable --now "lustre-backup-pull@$clinic.timer"
systemctl --user list-timers "lustre-backup-pull@$clinic.timer"
