# cockpit-letsencrypt

A [Cockpit](https://cockpit-project.org/) module to request and manage
[Let's Encrypt](https://letsencrypt.org/) certificates with
[certbot](https://certbot.eff.org/), and to use them as Cockpit's own TLS
certificate.

It appears in Cockpit under **Tools → Let's Encrypt**.

## Features

* List all certbot certificates with their domains, validation method,
  expiry date and status (valid, expiring soon, expired, test certificate).
* Request certificates with
  * **DNS-01** validation through certbot DNS plugins, which works for
    wildcard names (`*.example.com`) and for hosts that are not reachable from
    the internet,
  * **HTTP-01** validation with certbot's built-in web server (`--standalone`)
    or an existing web server's document root (`--webroot`).
* Store DNS provider API credentials, readable by root only, and edit them later.
* Renew a single certificate, or everything that is due, and watch certbot's
  output live. Shows whether certbot's renewal timer is on and can turn it on.
* Delete or revoke certificates.
* **Use a certificate for Cockpit itself**: the certificate is copied to
  `/etc/cockpit/ws-certs.d/90-letsencrypt.{cert,key}` and a certbot deploy hook
  copies it again and restarts `cockpit.service` after every renewal.

Everything runs through `cockpit.spawn` and `cockpit.file` as described in the
[Cockpit developer guide](https://docs.cockpit-project.org/cockpit-guide/latest/guide/development.html);
there is no extra daemon. The page needs administrative access.

## DNS providers

The credentials dialog knows the fields for the certbot plugins that
distributions package (`python3-certbot-dns-<name>` on both Fedora/RHEL and
Debian/Ubuntu):

Cloudflare, DigitalOcean, DNSimple, DNS Made Easy, Gehirn, Google Cloud DNS,
Linode, LuaDNS, NS1, OVH, RFC 2136 (BIND, PowerDNS, Knot, ...), Amazon Route 53
and Sakura Cloud.

It also knows some community plugins from PyPI: Duck DNS
(`certbot-dns-duckdns`), Gandi (`certbot-plugin-gandi`), Hetzner
(`certbot-dns-hetzner`) and Porkbun (`certbot-dns-porkbun`). Any other
installed `dns-*` plugin shows up as well; its credentials are entered as a raw
INI file.

A missing plugin is installed automatically when you save credentials for it
or request a certificate that needs it, the same way certbot itself is
installed:

* certbot from a **distribution package**: the plugin's distribution package,
  with dnf, apt, zypper or pacman,
* certbot in a **pip virtual environment** (for example `/opt/certbot`, as in
  certbot's own instructions): the plugin's pip package, into that environment,
* certbot as a **snap**: the `certbot-dns-<name>` snap.

Distributions don't package the community plugins, so these need certbot from
pip or snap.

## Installing

Download the `.rpm` or `.deb` from the
[releases page](https://github.com/avandeputte/cockpit-letsencrypt/releases)
and install it with `dnf install ./cockpit-letsencrypt-*.rpm` or
`apt install ./cockpit-letsencrypt_*_all.deb`. It pulls in certbot (from EPEL on
RHEL and CentOS Stream).

## Files

| Path | Purpose |
| --- | --- |
| `/etc/letsencrypt/cockpit/credentials/*.ini` | DNS credentials, mode 0600 |
| `/etc/letsencrypt/cockpit/credentials.json` | names and providers of the stored credentials (no secrets) |
| `/etc/letsencrypt/cockpit/settings.json` | default account email |
| `/etc/letsencrypt/cockpit/cockpit-ws.conf` | which certificate is used for Cockpit |
| `/etc/letsencrypt/renewal-hooks/deploy/50-cockpit-ws.sh` | copies that certificate after each renewal |
| `/etc/cockpit/ws-certs.d/90-letsencrypt.{cert,key}` | the copy Cockpit serves |

Cockpit uses the certificate file that sorts last in `/etc/cockpit/ws-certs.d/`.
If another file sorts after `90-letsencrypt.cert`, the page says so.

## Development

This project is based on the Cockpit
[starter-kit](https://github.com/cockpit-project/starter-kit).

```sh
make                 # fetch pkg/lib from cockpit, npm install, build into dist/
make devel-install   # symlink dist/ to ~/.local/share/cockpit/letsencrypt
make watch           # rebuild on changes
npm run eslint && npm run stylelint && npm run typecheck
npm test             # unit tests for the certbot output parsers and command lines
make rpm             # RPM package (Fedora/RHEL)
make deb             # DEB package (Debian/Ubuntu), needs debhelper
```

`test/check-application` is a Cockpit integration test for the
[cockpit test VMs](https://github.com/cockpit-project/bots) (`make check`).

The `packages` GitHub workflow lints, runs the unit tests and builds the RPM
and DEB on every push. Pushing a tag such as `0.1.0` creates a GitHub release
with both packages and the source tarball attached.

## License

LGPL-2.1-or-later, like Cockpit.
