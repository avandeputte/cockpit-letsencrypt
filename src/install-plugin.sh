#!/bin/sh
# Install a certbot plugin the way certbot itself was installed.
#
# usage: install-plugin.sh <plugin> <distro-package> <pip-package>
#   plugin          certbot plugin name, e.g. dns-cloudflare
#   distro-package  e.g. python3-certbot-dns-cloudflare; empty if distributions don't ship it
#   pip-package     e.g. certbot-dns-cloudflare
set -eu

plugin="$1"
pkg="$2"
pip="$3"

certbot=$(command -v certbot) || { echo "certbot is not installed" >&2; exit 1; }
real=$(readlink -f "$certbot")

# snap: plugins are separate snaps that need to be trusted once
case "$real" in
    /snap/*)
        echo "certbot is a snap; installing the certbot-$plugin snap"
        snap set certbot trust-plugin-with-root=ok
        snap install "certbot-$plugin"
        exit 0
        ;;
esac

# pip in a virtual environment (e.g. /opt/certbot): install into the same environment
python=$(head -n 1 "$real" | sed -n 's/^#![[:space:]]*\([^[:space:]]*\).*/\1/p')
if [ -n "$python" ] && [ -x "$python" ] && [ -f "$(dirname "$(dirname "$python")")/pyvenv.cfg" ]; then
    echo "certbot runs from the virtual environment $(dirname "$(dirname "$python")"); installing $pip with pip"
    "$python" -m pip install --disable-pip-version-check "$pip"
    exit 0
fi

# distribution package
if [ -n "$pkg" ]; then
    if command -v dnf >/dev/null 2>&1; then
        dnf install -y "$pkg"
        exit 0
    elif command -v apt-get >/dev/null 2>&1; then
        export DEBIAN_FRONTEND=noninteractive
        apt-get install -y "$pkg" || { apt-get update && apt-get install -y "$pkg"; }
        exit 0
    elif command -v zypper >/dev/null 2>&1; then
        zypper --non-interactive install "$pkg"
        exit 0
    elif command -v pacman >/dev/null 2>&1; then
        pacman -S --noconfirm --needed "certbot-$plugin"
        exit 0
    fi
fi

echo "Cannot install $pip automatically: your distribution does not package it, and certbot" >&2
echo "is not installed with pip in a virtual environment or as a snap." >&2
echo "Install certbot with pip in a virtual environment (https://certbot.eff.org/instructions)" >&2
echo "or as a snap to use this provider." >&2
exit 1
