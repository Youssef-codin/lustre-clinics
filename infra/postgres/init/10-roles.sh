#!/bin/sh
# Runs once, when a Postgres volume is created (/docker-entrypoint-initdb.d).
# Changing it does nothing to a database that already exists.
#
# Three roles on the clinic machine:
#   POSTGRES_USER  superuser, created by the image. Used by nothing day to day.
#   lustre_owner   owns the database and the schema, runs migrations.
#   lustre_app     what the server connects as: reads and writes rows, cannot
#                  DROP, TRUNCATE or ALTER. CREATEDB is for the backup's restore
#                  check, which builds and drops its own scratch database; it
#                  cannot drop this one, which it does not own.
#
# Without LUSTRE_APP_PASSWORD (a developer's laptop) nothing is created and the
# superuser stays the only role, as before.
set -eu

if [ -z "${LUSTRE_APP_PASSWORD:-}" ]; then
    echo "10-roles: LUSTRE_APP_PASSWORD is unset, keeping the single superuser"
    exit 0
fi
: "${LUSTRE_OWNER_PASSWORD:?set LUSTRE_OWNER_PASSWORD}"
: "${LUSTRE_ENVIRONMENT:?set LUSTRE_ENVIRONMENT to production or development}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v db="$POSTGRES_DB" \
    -v owner_pw="$LUSTRE_OWNER_PASSWORD" \
    -v app_pw="$LUSTRE_APP_PASSWORD" \
    -v environment="$LUSTRE_ENVIRONMENT" <<'SQL'
CREATE ROLE lustre_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE lustre_app LOGIN CREATEDB PASSWORD :'app_pw';

ALTER DATABASE :"db" OWNER TO lustre_owner;
-- Read back by src/db/environment.ts. The seed and the test suite refuse a
-- database marked production.
ALTER DATABASE :"db" SET lustre.environment = :'environment';

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO lustre_app;
GRANT USAGE ON SCHEMA public TO lustre_app;

-- Tables, sequences and schemas the migrations create later belong to
-- lustre_owner; these make them usable by the app as they appear, including the
-- drizzle schema that health.check reads.
ALTER DEFAULT PRIVILEGES FOR ROLE lustre_owner GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lustre_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lustre_owner GRANT USAGE, SELECT ON SEQUENCES TO lustre_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lustre_owner GRANT USAGE ON SCHEMAS TO lustre_app;

-- A runaway query or a transaction left open by a bug gives its connection back
-- instead of holding locks the desk is waiting on. pg_dump and pg_restore turn
-- statement_timeout off for themselves.
ALTER ROLE lustre_app SET statement_timeout = '30s';
ALTER ROLE lustre_app SET idle_in_transaction_session_timeout = '60s';
SQL

echo "10-roles: created lustre_owner and lustre_app, marked $POSTGRES_DB as $LUSTRE_ENVIRONMENT"
