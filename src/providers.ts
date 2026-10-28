/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * DNS-01 providers backed by certbot DNS plugins.
 */

import cockpit from 'cockpit';

const _ = cockpit.gettext;

export interface ProviderField {
    key: string;
    label: string;
    secret?: boolean;
    default?: string;
    placeholder?: string;
    optional?: boolean;
}

export interface Provider {
    /* certbot authenticator name, e.g. "dns-cloudflare" */
    plugin: string;
    label: string;
    /* distro package name (same on Fedora/RHEL and Debian/Ubuntu); unset for community plugins */
    package?: string;
    /* pip package for plugins that distributions do not ship */
    pip?: string;
    /* "ini" (key = value lines), "json" (a single JSON document), or "none" (no credentials file) */
    format: "ini" | "json" | "none";
    fields: ProviderField[];
    /* whether the plugin accepts --<plugin>-propagation-seconds */
    propagation: boolean;
    note?: string;
}

export const PROVIDERS: Provider[] = [
    {
        plugin: "dns-cloudflare",
        label: "Cloudflare",
        package: "python3-certbot-dns-cloudflare",
        format: "ini",
        fields: [
            { key: "dns_cloudflare_api_token", label: _("API token"), secret: true },
        ],
        propagation: true,
        note: _("Create a token with the Zone:DNS:Edit permission for the zones you need."),
    },
    {
        plugin: "dns-digitalocean",
        label: "DigitalOcean",
        package: "python3-certbot-dns-digitalocean",
        format: "ini",
        fields: [{ key: "dns_digitalocean_token", label: _("API token"), secret: true }],
        propagation: true,
    },
    {
        plugin: "dns-dnsimple",
        label: "DNSimple",
        package: "python3-certbot-dns-dnsimple",
        format: "ini",
        fields: [{ key: "dns_dnsimple_token", label: _("API token"), secret: true }],
        propagation: true,
    },
    {
        plugin: "dns-dnsmadeeasy",
        label: "DNS Made Easy",
        package: "python3-certbot-dns-dnsmadeeasy",
        format: "ini",
        fields: [
            { key: "dns_dnsmadeeasy_api_key", label: _("API key") },
            { key: "dns_dnsmadeeasy_secret_key", label: _("Secret key"), secret: true },
        ],
        propagation: true,
    },
    {
        plugin: "dns-gehirn",
        label: "Gehirn Infrastructure Service",
        package: "python3-certbot-dns-gehirn",
        format: "ini",
        fields: [
            { key: "dns_gehirn_api_token", label: _("API token") },
            { key: "dns_gehirn_api_secret", label: _("API secret"), secret: true },
        ],
        propagation: true,
    },
    {
        plugin: "dns-google",
        label: "Google Cloud DNS",
        package: "python3-certbot-dns-google",
        format: "json",
        fields: [{ key: "json", label: _("Service account key (JSON)"), secret: true }],
        propagation: true,
    },
    {
        plugin: "dns-linode",
        label: "Linode",
        package: "python3-certbot-dns-linode",
        format: "ini",
        fields: [{ key: "dns_linode_key", label: _("API key"), secret: true }],
        propagation: true,
    },
    {
        plugin: "dns-luadns",
        label: "LuaDNS",
        package: "python3-certbot-dns-luadns",
        format: "ini",
        fields: [
            { key: "dns_luadns_email", label: _("Email") },
            { key: "dns_luadns_token", label: _("API token"), secret: true },
        ],
        propagation: true,
    },
    {
        plugin: "dns-nsone",
        label: "NS1",
        package: "python3-certbot-dns-nsone",
        format: "ini",
        fields: [{ key: "dns_nsone_api_key", label: _("API key"), secret: true }],
        propagation: true,
    },
    {
        plugin: "dns-ovh",
        label: "OVH",
        package: "python3-certbot-dns-ovh",
        format: "ini",
        fields: [
            { key: "dns_ovh_endpoint", label: _("Endpoint"), default: "ovh-eu" },
            { key: "dns_ovh_application_key", label: _("Application key") },
            { key: "dns_ovh_application_secret", label: _("Application secret"), secret: true },
            { key: "dns_ovh_consumer_key", label: _("Consumer key"), secret: true },
        ],
        propagation: true,
    },
    {
        plugin: "dns-rfc2136",
        label: _("RFC 2136 (BIND, PowerDNS, Knot, ...)"),
        package: "python3-certbot-dns-rfc2136",
        format: "ini",
        fields: [
            { key: "dns_rfc2136_server", label: _("DNS server address"), placeholder: "192.0.2.1" },
            { key: "dns_rfc2136_port", label: _("Port"), default: "53" },
            { key: "dns_rfc2136_name", label: _("TSIG key name"), placeholder: "keyname." },
            { key: "dns_rfc2136_secret", label: _("TSIG key secret"), secret: true },
            { key: "dns_rfc2136_algorithm", label: _("TSIG algorithm"), default: "HMAC-SHA512" },
        ],
        propagation: true,
    },
    {
        plugin: "dns-route53",
        label: "Amazon Route 53",
        package: "python3-certbot-dns-route53",
        format: "none",
        fields: [],
        propagation: false,
        note: _("Route 53 uses the standard AWS credential chain: /root/.aws/config, or an instance role."),
    },
    {
        plugin: "dns-sakuracloud",
        label: "Sakura Cloud",
        package: "python3-certbot-dns-sakuracloud",
        format: "ini",
        fields: [
            { key: "dns_sakuracloud_api_token", label: _("API token") },
            { key: "dns_sakuracloud_api_secret", label: _("API secret"), secret: true },
        ],
        propagation: true,
    },
    /* Community plugins, not packaged by most distributions */
    {
        plugin: "dns-duckdns",
        label: "Duck DNS",
        pip: "certbot-dns-duckdns",
        format: "ini",
        fields: [{ key: "dns_duckdns_token", label: _("Token"), secret: true }],
        propagation: true,
    },
    {
        plugin: "dns-gandi",
        label: "Gandi",
        pip: "certbot-plugin-gandi",
        format: "ini",
        fields: [{ key: "dns_gandi_token", label: _("Personal access token"), secret: true }],
        propagation: true,
    },
    {
        plugin: "dns-hetzner",
        label: "Hetzner DNS",
        pip: "certbot-dns-hetzner",
        format: "ini",
        fields: [{ key: "dns_hetzner_api_token", label: _("API token"), secret: true }],
        propagation: true,
    },
    {
        plugin: "dns-porkbun",
        label: "Porkbun",
        pip: "certbot-dns-porkbun",
        format: "ini",
        fields: [
            { key: "dns_porkbun_key", label: _("API key") },
            { key: "dns_porkbun_secret", label: _("Secret API key"), secret: true },
        ],
        propagation: true,
    },
];

/* Any other installed dns-* plugin: credentials are edited as raw INI text */
export function genericProvider(plugin: string, description?: string): Provider {
    return {
        plugin,
        label: description ? `${plugin} (${description})` : plugin,
        format: "ini",
        fields: [{ key: "ini", label: _("Credentials file (INI)"), secret: true }],
        propagation: true,
    };
}

export function findProvider(plugin: string): Provider {
    return PROVIDERS.find(p => p.plugin === plugin) ?? genericProvider(plugin);
}

export function isGeneric(provider: Provider): boolean {
    return !PROVIDERS.includes(provider);
}
