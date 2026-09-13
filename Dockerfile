# syntax=docker/dockerfile:1

# The clinic server image: the binary from `bun run build:server`, the migration
# SQL it reads at runtime (a compiled binary carries no files beside its code),
# and the Postgres client tools the backup shells out to. No Bun, no source, no
# node_modules.
#
# pg_dump and pg_restore must be the same major version as the database (17, per
# §2 and compose.yaml). The binary is Bun's musl build, which needs the C++
# runtime that Alpine does not ship by default.
FROM alpine:3.22

RUN apk add --no-cache postgresql17-client libstdc++ libgcc ca-certificates

WORKDIR /app
COPY dist/lustre /usr/local/bin/lustre
COPY dist/migrations /app/migrations
ENV MIGRATIONS_DIR=/app/migrations
# The logger's development transport (pino-pretty) is not in the binary, and
# config defaults NODE_ENV to development: without this, any `docker run` that
# forgets it dies before the first log line.
ENV NODE_ENV=production

# ENTRYPOINT rather than CMD so `docker compose run --rm server backup` runs a
# subcommand (packages/server/src/cli.ts) instead of replacing the binary.
ENTRYPOINT ["lustre"]
CMD ["serve"]
