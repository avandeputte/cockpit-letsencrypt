#!/bin/sh
# Installed by the Cockpit Let's Encrypt module (cockpit-letsencrypt).
#
# certbot runs this after every successful renewal. If the renewed lineage is
# the one selected for Cockpit, copy it to /etc/cockpit/ws-certs.d/ and
# restart cockpit.service so that the web console picks it up.
#
# Run by hand (without RENEWED_LINEAGE) to deploy the selected certificate now.
# Set COCKPIT_LE_NO_RESTART=1 to skip the restart.
set -eu

CONF=/etc/letsencrypt/cockpit/cockpit-ws.conf
DEST=/etc/cockpit/ws-certs.d
BASE=90-letsencrypt

[ -r "$CONF" ] || exit 0
NAME=$(sed -n 's/^COCKPIT_CERT_NAME=//p' "$CONF" | head -n 1)
case "$NAME" in
    ""|*/*|.*) exit 0 ;;
esac

LINEAGE="/etc/letsencrypt/live/$NAME"
if [ -n "${RENEWED_LINEAGE:-}" ] && [ "${RENEWED_LINEAGE%/}" != "$LINEAGE" ]; then
    exit 0
fi

if [ ! -r "$LINEAGE/fullchain.pem" ] || [ ! -r "$LINEAGE/privkey.pem" ]; then
    echo "cockpit-letsencrypt: $LINEAGE has no certificate" >&2
    exit 1
fi

mkdir -p "$DEST"
umask 077
cp -L "$LINEAGE/fullchain.pem" "$DEST/.$BASE.cert.tmp"
cp -L "$LINEAGE/privkey.pem" "$DEST/.$BASE.key.tmp"
chmod 644 "$DEST/.$BASE.cert.tmp"
chmod 600 "$DEST/.$BASE.key.tmp"
mv -f "$DEST/.$BASE.key.tmp" "$DEST/$BASE.key"
mv -f "$DEST/.$BASE.cert.tmp" "$DEST/$BASE.cert"
if command -v restorecon >/dev/null 2>&1; then
    restorecon "$DEST/$BASE.cert" "$DEST/$BASE.key" || true
fi

echo "cockpit-letsencrypt: deployed $NAME to $DEST/$BASE.cert"

if [ "${COCKPIT_LE_NO_RESTART:-}" != "1" ]; then
    systemctl try-restart cockpit.service || true
fi
