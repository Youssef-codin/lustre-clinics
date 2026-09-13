# Clinic server setup

Everything done to a clinic machine beyond the Debian installer lives here, so a
second clinic is a new inventory entry and one command, not a rebuild from
memory.

## Before the playbook

Done by hand, once per machine:

1. Debian 13 netinstall: no desktop, SSH server and standard utilities only.
2. Install Tailscale and log in to the **clinic's** tailnet (not the operator's).
3. In that tailnet's admin console: disable key expiry for the machine, and
   share it to the operator's personal tailnet.
4. From the operator's machine, `ssh-copy-id` a key and confirm a key login
   works over the Tailscale IP.

## Running it

Needs `ansible-core` 2.15+ on the operator's machine. No collections.

```sh
cd infra/ansible
ansible-playbook site.yml -K --tags tailscale,base,power     # safe, no lockout risk
ansible-playbook site.yml -K --tags ssh                      # passwords off
ansible-playbook site.yml -K --tags firewall                 # LAN locked down
ansible-playbook site.yml -K --tags docker
```

`-K` asks for the sudo password. The first run is split so each risky step can
be checked before the next; after that, `ansible-playbook site.yml -K` runs it
all and changes nothing on a machine that is already set up.

The SSH and firewall steps end by opening a fresh connection. If either fails,
the session that ran the play has already been closed; get back in over the LAN
(`ssh` to the LAN IP from `lan_cidr`) or at the keyboard.

## Deploying the app

Two stacks run on each clinic machine from the same `compose.yaml`, each in its
own directory with its own database, network and passwords:

| Stack | Directory | API | Database | GlitchTip | Migrations |
|---|---|---|---|---|---|
| prod | `/opt/lustre-prod` | `:3000` | `production`, `127.0.0.1:5432` | `:8000` | a deploy step, as `lustre_owner` |
| dev | `/opt/lustre-dev` | `:3001` | `development`, `127.0.0.1:5433` | none | on boot |

Both listen on the Tailscale address only. Build the binary, then run the `app`
tag. The Discord webhook and heartbeat URLs come from the environment so they are
never written into the repo; `read -rs` keeps them out of shell history.

```sh
bun run build:server
read -rs LUSTRE_DISCORD_WEBHOOK_URL && export LUSTRE_DISCORD_WEBHOOK_URL
read -rs LUSTRE_HEARTBEAT_URL && export LUSTRE_HEARTBEAT_URL
cd infra/ansible && ansible-playbook site.yml -K --tags app
```

Each stack's `.env` is generated on the server the first time and never
rewritten: its passwords are the ones the database volume was created with.
Leaving a URL variable unset on a later run keeps the value already there.

Operating a stack from its directory (`COMPOSE_PROJECT_NAME` in `.env` keeps
`docker compose` on the right one):

```sh
cd /opt/lustre-prod
docker compose ps
docker compose logs -f server
docker compose run --rm server backup
```

`lustre seed` refuses the production database, whatever its connection string.

## Off-site backups on the operator's machine

The server dumps, restore-verifies and prunes its own backups (SPEC §16). The
off-site copy is pulled to the operator's machine over Tailscale instead of
pushed to a cloud, so patient data stays with people who already have it.

```sh
sudo pacman -S age
infra/operator/install.sh smilemakers
```

`install.sh` asks for the backup public key, or creates a new key and prints the
private half once. That goes in a password manager and on paper; this machine
keeps only the public half, which can encrypt but not decrypt.

It then enables `lustre-backup-pull@<clinic>.timer`, which runs hourly (and at
login if a run was missed): copies new dumps, encrypting each as it arrives and
checking it against the server's checksum, keeps 14 daily and 12 monthly, and
alerts Discord if nothing newer than 72 hours has arrived. Logs:
`journalctl --user -u 'lustre-*'`.

No restore check runs here: the server restores every dump before it can be
pulled. To restore from a copy here:

```sh
age -d -i key.txt lustre-<stamp>.dump.age > lustre.dump
```

## Adding a clinic

Add a host under `clinics` in `ansible/inventory.yml` with its Tailscale IP and
the clinic's LAN range, then run the playbook with `--limit <host>`.

## What it sets up

| Tag | Result |
|---|---|
| `tailscale` | Asserts the node is logged in, prints tailnet, IPs, MagicDNS name and key expiry. Turns off Tailscale DNS so it stops fighting dhcpcd, and Tailscale SSH so tailnet logins go through sshd's key-only rules instead of bypassing them. |
| `base` | Timezone, unattended security upgrades, never suspends (lid shut, sleep targets masked), boots to text mode. |
| `power` | Survives power cuts unattended: boot-time fsck repairs without asking, upower starts on text-mode boots and powers the machine off cleanly at 35% on a long cut (the first laptop's worn battery reads 35% and then 3% a minute later), and Tailscale and SSH start on boot. |
| `ssh` | Key-only, no root, only the admin user. |
| `firewall` | nftables, own table only. Inbound: everything over `tailscale0`, SSH from the LAN, Tailscale's direct-connection port. Nothing else. The allow-list is enforced in prerouting as well as input, because Docker's published ports bypass input: a container published on `0.0.0.0` or the LAN IP is still unreachable from the LAN. |
| `docker` | Docker CE and the compose plugin from Docker's apt repo, log rotation, admin user in the `docker` group, and no port-bind race with Tailscale at boot. |
