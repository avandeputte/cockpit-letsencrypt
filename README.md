# cockpit-letsencrypt

A [Cockpit](https://cockpit-project.org/) module to request and manage
[Let's Encrypt](https://letsencrypt.org/) certificates with
[certbot](https://certbot.eff.org/), including DNS validation for wildcard and
internal names, and to use them as Cockpit's own TLS certificate.

It appears in Cockpit under **Tools → Let's Encrypt**.

![The Let's Encrypt page in Cockpit](doc/screenshots/overview.png)

## Features

* **Certificate overview.** Every certbot certificate on the machine, with its
  domains, validation method, expiry date and status (valid, expiring soon,
  expired, test certificate). It also shows whether certbot's renewal timer is
  on, and can turn it on.
* **Request certificates** with
  * **DNS-01** validation through certbot DNS plugins. This works for wildcard
    names (`*.example.com`) and for hosts that are not reachable from the
    internet. 17 DNS providers are built in, and any other certbot DNS plugin
    works too.
  * **HTTP-01** validation, with certbot's built-in web server
    (`--standalone`) or the document root of a web server that is already
    running (`--webroot`).
* **DNS provider credentials.** Stored readable by root only, and editable
  later. Each one shows which certificates use it.
* **Automatic plugin installation.** A missing certbot DNS plugin is installed
  when you need it, the same way certbot itself was installed: distribution
  package, pip, or snap.
* **Renew, delete and revoke**, with certbot's output shown live.
* **Secure Cockpit itself.** One click copies a certificate to
  `/etc/cockpit/ws-certs.d/`, and a certbot deploy hook copies it again and
  restarts the web console after every renewal.

## Installing

Download the package for your distribution from the
[latest release](https://github.com/avandeputte/cockpit-letsencrypt/releases/latest):

```sh
# Fedora, RHEL, CentOS Stream, AlmaLinux, Rocky Linux
sudo dnf install ./cockpit-letsencrypt-*.noarch.rpm

# Debian, Ubuntu
sudo apt install ./cockpit-letsencrypt_*_all.deb
```

Both packages pull in certbot. On RHEL and its rebuilds, certbot comes from
[EPEL](https://docs.fedoraproject.org/en-US/epel/), so enable EPEL first
(`sudo dnf install epel-release` on CentOS Stream, AlmaLinux and Rocky Linux).

Then open Cockpit (`https://<host>:9090`), log in, turn on administrative
access, and choose **Let's Encrypt** in the menu.

**Requirements:** Cockpit 137 or later and certbot 1.x or later. The page
needs administrative access, because certbot and its files belong to root.

To install from source instead, see [Development](doc/development.md).

## Quick start

1. **Add DNS credentials** (skip this for HTTP validation). Under *DNS provider
   credentials*, click **Add credentials**, pick your provider, and paste an API
   token. If the certbot plugin for that provider is missing, it is installed
   when you save.
2. **Request a certificate.** Click **Request certificate**, enter the domain
   names, choose the validation method and click **Request**. certbot's
   output is shown while it runs.
3. **Use it for Cockpit** (optional). In the certificate's menu, choose **Use
   for Cockpit**, then restart the web console when asked.

Renewal is automatic as long as certbot's timer is on. The page tells you if
it isn't.

## Documentation

* [User guide](doc/user-guide.md): every screen and dialog, step by step,
  with screenshots.
* [DNS providers](doc/dns-providers.md): supported providers, the credentials
  each one needs, and how plugins are installed.
* [Development](doc/development.md): building, testing, packaging and
  releasing.

## Files

| Path | Purpose |
| --- | --- |
| `/etc/letsencrypt/cockpit/credentials/*.ini` | DNS credentials, mode 0600 |
| `/etc/letsencrypt/cockpit/credentials.json` | names and providers of the stored credentials (no secrets) |
| `/etc/letsencrypt/cockpit/settings.json` | default account email |
| `/etc/letsencrypt/cockpit/cockpit-ws.conf` | which certificate is used for Cockpit |
| `/etc/letsencrypt/renewal-hooks/deploy/50-cockpit-ws.sh` | copies that certificate after each renewal |
| `/etc/cockpit/ws-certs.d/90-letsencrypt.{cert,key}` | the copy Cockpit serves |

Everything else, such as certificates, keys, renewal configuration and the
ACME account, is certbot's own data under `/etc/letsencrypt`. The module adds
no daemon and no database. It drives certbot through `cockpit.spawn`, as the
[Cockpit developer guide](https://docs.cockpit-project.org/cockpit-guide/latest/guide/development.html)
recommends, so anything you do on the page you could also do with certbot on
the command line, and the other way round.

## License

LGPL-2.1-or-later, like Cockpit.
