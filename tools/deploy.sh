#!/usr/bin/env bash
# Uploads the website (pagebite.eu) to Hostinger over FTP with TLS. A copy of readbyte's scripts/deploy-start.sh.
# Run by .github/workflows/deploy.yml after a push to main; also runs on a Mac.
#
# Needs: SITE_FTP_HOST, SITE_FTP_USER, SITE_FTP_PASSWORD.
# Optional: SITE_FTP_DIR, the folder below the FTP account's home (empty when the account starts in the site's folder).
# Hostinger gives the FTP host as an IP address, but its TLS certificate is for *.hstgr.io. With an IP, the script
# connects to that IP under the name SITE_FTP_TLS_NAME (default pagebite-ftp.hstgr.io), so the certificate is still
# checked.
# Uploads only the files Git tracks, without the tests, the tools, the README and the GitHub Pages files (CNAME,
# .nojekyll). Never anything below start/: that folder belongs to start.pagebite.eu (readbyte/web/start).
# DRY_RUN=1 only lists the files and does not connect. PRINT_TARGET=1 prints the TLS name and the server, then stops.
# Only adds and replaces files; a file deleted here stays on the server until it is removed in Hostinger's File Manager.
set -euo pipefail

SITE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SITE"
FILES="$(git ls-files | grep -Ev '^(tests/|tools/|\.github/|start/)|^(README\.md|CNAME|\.nojekyll|\.gitignore)$' | LC_ALL=C sort)"

if [ "${DRY_RUN:-}" = "1" ]; then
  printf '%s\n' "$FILES"
  exit 0
fi

: "${SITE_FTP_HOST:?SITE_FTP_HOST is missing}"
: "${SITE_FTP_USER:?SITE_FTP_USER is missing}"
: "${SITE_FTP_PASSWORD:?SITE_FTP_PASSWORD is missing}"
DIR="${SITE_FTP_DIR:-}"
DIR="${DIR#/}"
DIR="${DIR%/}"
# Accept the host as Hostinger shows it or as people paste it: "ftp://1.2.3.4:21/", " ftp.example.com ".
SERVER="$(printf '%s' "$SITE_FTP_HOST" | tr -d '[:space:]')"
SERVER="${SERVER#*://}"
SERVER="${SERVER%%/*}"
SERVER="${SERVER%:21}"
: "${SERVER:?SITE_FTP_HOST holds no host}"
HOST="$SERVER"
RESOLVE=()
if [[ ! "$SERVER" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ && "$SERVER" != *.hstgr.io ]]; then
  # A name of our own domain (ftp.pagebite.eu) does not match the *.hstgr.io certificate either: use its address.
  IP="$( (getent ahostsv4 "$SERVER" 2>/dev/null || dig +short A "$SERVER" 2>/dev/null) | awk '/^[0-9.]+( |$)/ { print $1; exit }')"
  : "${IP:?cannot resolve $SERVER}"
  SERVER="$IP"
fi
if [[ "$SERVER" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  HOST="${SITE_FTP_TLS_NAME:-pagebite-ftp.hstgr.io}"
  RESOLVE=(--resolve "${HOST}:21:${SERVER}")
fi
BASE="ftp://${HOST}/${DIR:+$DIR/}"
if [ "${PRINT_TARGET:-}" = "1" ]; then
  echo "$HOST $SERVER $BASE"
  exit 0
fi

# The password goes into a private netrc file, never onto the command line, where other processes could read it.
NETRC="$(mktemp)"
trap 'rm -f "$NETRC"' EXIT
chmod 600 "$NETRC"
printf 'machine %s login %s password %s\n' "$HOST" "$SITE_FTP_USER" "$SITE_FTP_PASSWORD" > "$NETRC"

while IFS= read -r file; do
  echo "upload $file"
  # --ssl-reqd: never send the password without TLS.
  curl --silent --show-error --fail --ssl-reqd --ftp-create-dirs --netrc-file "$NETRC" ${RESOLVE[@]+"${RESOLVE[@]}"} \
    --retry 2 --connect-timeout 20 -T "$file" "${BASE}${file}"
done <<< "$FILES"

echo "done: $(printf '%s\n' "$FILES" | wc -l | tr -d ' ') files to ${SERVER}/${DIR}"
