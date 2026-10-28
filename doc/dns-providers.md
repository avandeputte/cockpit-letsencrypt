# DNS providers

DNS validation (DNS-01) uses a certbot DNS plugin to create the temporary
`_acme-challenge` TXT record through your DNS provider's API. This page lists
the providers the credentials dialog knows, the fields each one asks for, and
how the plugins are installed.

## Built-in providers

### Packaged by distributions

These plugins are part of the certbot project. Fedora, RHEL (EPEL), Debian
and Ubuntu package them as `python3-certbot-dns-<name>`, pip has them as
`certbot-dns-<name>`, and snap as `certbot-dns-<name>`.

| Provider | Plugin | Fields | Notes |
| --- | --- | --- | --- |
| Cloudflare | `dns-cloudflare` | API token | Create a token with the *Zone → DNS → Edit* permission for the zones you need. Global API keys are not supported by the dialog. |
| DigitalOcean | `dns-digitalocean` | API token | A personal access token with write scope. |
| DNSimple | `dns-dnsimple` | API token | An account access token. |
| DNS Made Easy | `dns-dnsmadeeasy` | API key, secret key | |
| Gehirn Infrastructure Service | `dns-gehirn` | API token, API secret | |
| Google Cloud DNS | `dns-google` | Service account key (JSON) | Paste the whole JSON key file of a service account with the *DNS Administrator* role. It is stored as a `.json` file. |
| Linode | `dns-linode` | API key | A personal access token with *Domains: Read/Write*. |
| LuaDNS | `dns-luadns` | Email, API token | |
| NS1 | `dns-nsone` | API key | |
| OVH | `dns-ovh` | Endpoint, application key, application secret, consumer key | The endpoint defaults to `ovh-eu`. Create the keys at your OVH region's `createToken` page with GET/PUT/POST/DELETE rights on `/domain/zone/*`. |
| RFC 2136 | `dns-rfc2136` | DNS server address, port, TSIG key name, TSIG key secret, TSIG algorithm | For your own name server: BIND, PowerDNS, Knot, Windows DNS and others. The server must allow dynamic updates signed with the TSIG key. The port defaults to 53, the algorithm to HMAC-SHA512. |
| Amazon Route 53 | `dns-route53` | *(none)* | Route 53 uses the standard AWS credential chain: `/root/.aws/credentials` or `/root/.aws/config`, environment variables, or an EC2 instance role. The dialog only stores a name, so you can pick it when you request a certificate. Route 53 does not take a propagation wait. |
| Sakura Cloud | `dns-sakuracloud` | API token, API secret | |

### Community plugins

These plugins are maintained outside the certbot project. Distributions don't
package them, so they are installed with pip, which requires certbot in a pip
virtual environment, or as a snap where one exists.

| Provider | Plugin | pip package | Fields |
| --- | --- | --- | --- |
| Duck DNS | `dns-duckdns` | [`certbot-dns-duckdns`](https://pypi.org/project/certbot-dns-duckdns/) | Token |
| Gandi | `dns-gandi` | [`certbot-plugin-gandi`](https://pypi.org/project/certbot-plugin-gandi/) | Personal access token |
| Hetzner DNS | `dns-hetzner` | [`certbot-dns-hetzner`](https://pypi.org/project/certbot-dns-hetzner/) | API token |
| Porkbun | `dns-porkbun` | [`certbot-dns-porkbun`](https://pypi.org/project/certbot-dns-porkbun/) | API key, secret API key |

## Other certbot DNS plugins

Any other certbot plugin whose name starts with `dns-` shows up in the provider
list under *Other installed plugins* once it is installed. Its credentials are
entered as the raw contents of the plugin's INI credentials file, as described
in the plugin's documentation. For example:

```ini
dns_example_api_key = 0123456789abcdef
dns_example_api_secret = fedcba9876543210
```

Install such a plugin into certbot's environment yourself, for example
`/opt/certbot/bin/pip install certbot-dns-example`, then reload the page.

## How plugins are installed

When a plugin is missing, the page installs it:

* when you save credentials for that provider,
* when you request a certificate with credentials whose plugin is missing,
* when you choose **Install plugin** in a credentials row's menu.

The page installs it the same way certbot was installed. It follows the
`certbot` command to its real location:

1. **snap** (`/snap/...`): runs `snap set certbot trust-plugin-with-root=ok`,
   then `snap install certbot-dns-<name>`.
2. **pip virtual environment** (certbot's Python interpreter has a
   `pyvenv.cfg` next to it, as with `/opt/certbot` or pipx): runs
   `<venv>/bin/python -m pip install <pip package>`.
3. **distribution package**: installs `python3-certbot-dns-<name>` with dnf,
   apt-get, zypper or pacman (`certbot-dns-<name>` on Arch).

If none of these fit, for example a community plugin with distribution-packaged
certbot, nothing is installed and the dialog explains why. The page never runs
pip against the system Python.

The installation needs network access to the package repositories or to PyPI.
Without it, install the plugin by hand and reload the page.

## Where credentials are stored

Each set of credentials is one file in `/etc/letsencrypt/cockpit/credentials/`,
named `<provider>-<name>.ini` (`.json` for Google Cloud DNS), with mode 0600.
certbot refuses credential files that other users can read, so don't loosen
the mode.

`/etc/letsencrypt/cockpit/credentials.json` lists the name, plugin and path of
each credentials file, and contains no secrets.

certbot records the credentials path in each certificate's renewal
configuration (`/etc/letsencrypt/renewal/<name>.conf`), so renewals use it
too. If you edit credentials, for example to rotate a token, the next renewal
uses the new values.
