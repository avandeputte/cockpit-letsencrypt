/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Pure helpers around certbot: output parsers and command line builders.
 * Nothing in here talks to the system, so it can be unit tested.
 */

import type { Provider } from './providers';

export const LE_DIR = "/etc/letsencrypt";
export const MODULE_DIR = LE_DIR + "/cockpit";
export const CREDENTIALS_DIR = MODULE_DIR + "/credentials";
export const PROFILES_FILE = MODULE_DIR + "/credentials.json";
export const SETTINGS_FILE = MODULE_DIR + "/settings.json";
export const COCKPIT_WS_CONF = MODULE_DIR + "/cockpit-ws.conf";
export const DEPLOY_HOOK = LE_DIR + "/renewal-hooks/deploy/50-cockpit-ws.sh";
export const WS_CERTS_DIR = "/etc/cockpit/ws-certs.d";
export const WS_CERT_BASENAME = "90-letsencrypt";
export const WS_CERT = `${WS_CERTS_DIR}/${WS_CERT_BASENAME}.cert`;
export const WS_KEY = `${WS_CERTS_DIR}/${WS_CERT_BASENAME}.key`;

export const STAGING_SERVER = "https://acme-staging-v02.api.letsencrypt.org/directory";

/* certificates that expire within this many days are flagged */
export const EXPIRY_WARNING_DAYS = 21;

export type RenewalConf = Record<string, string>;

export interface CertificateInfo {
    name: string;
    serial: string;
    keyType: string;
    domains: string[];
    expiry: Date | null;
    /* "INVALID: TEST_CERT" for certificates from the staging server, else empty */
    validity: string;
    certPath: string;
    keyPath: string;
}

export type CertificateStatus = "valid" | "expiring" | "expired" | "test" | "invalid";

/* Parse the per-lineage certificate details that backend.listCertificates()
 * reads with openssl, instead of running "certbot certificates": that checks
 * every certificate's revocation over OCSP, which can take many seconds per
 * certificate (Let's Encrypt has shut down its OCSP service). Each lineage
 * starts with "==> name", followed by "fullchain=" and "privkey=" from its
 * renewal configuration, and openssl's -serial, -enddate, subjectAltName and
 * public key algorithm output. Test certificates are marked from the renewal
 * configuration's ACME server. */
export function parseCertificates(output: string, renewal: Record<string, RenewalConf> = {}): CertificateInfo[] {
    const certs: CertificateInfo[] = [];
    let cur: CertificateInfo | null = null;

    for (const raw of output.split("\n")) {
        const line = raw.trim();
        const header = line.match(/^==> (.+)$/);
        if (header) {
            cur = {
                name: header[1],
                serial: "",
                keyType: "",
                domains: [],
                expiry: null,
                validity: renewal[header[1]]?.server === STAGING_SERVER ? "INVALID: TEST_CERT" : "",
                certPath: "",
                keyPath: "",
            };
            certs.push(cur);
            continue;
        }
        if (!cur)
            continue;

        if (/(^|,\s*)(DNS|IP Address):/.test(line)) {
            cur.domains.push(...line.split(/,\s*/)
                    .map(e => e.replace(/^(DNS|IP Address):/, "").trim())
                    .filter(Boolean));
            continue;
        }

        const eq = line.indexOf("=");
        if (eq < 0)
            continue;
        const key = line.slice(0, eq);
        const value = line.slice(eq + 1).trim();
        switch (key) {
        case "fullchain":
            cur.certPath = value;
            break;
        case "privkey":
            cur.keyPath = value;
            break;
        case "serial":
            cur.serial = value.toLowerCase();
            break;
        case "notAfter":
            cur.expiry = parseOpensslDate(value);
            break;
        case "keyalg":
            cur.keyType = value === "id-ecPublicKey" ? "ECDSA" : value === "rsaEncryption" ? "RSA" : value;
            break;
        }
    }

    return certs;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* openssl's date format, e.g. "Dec 28 20:57:00 2026 GMT" */
export function parseOpensslDate(value: string): Date | null {
    const m = value.match(/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})/);
    const month = m ? MONTHS.indexOf(m[1]) : -1;
    if (!m || month < 0)
        return null;
    return new Date(Date.UTC(Number(m[6]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])));
}

export function certificateStatus(cert: CertificateInfo, now: Date = new Date()): CertificateStatus {
    if (cert.validity.includes("TEST_CERT"))
        return "test";
    if (!cert.expiry)
        return "invalid";
    if (cert.expiry.getTime() <= now.getTime())
        return "expired";
    if (cert.validity.startsWith("INVALID"))
        return "invalid";
    if (daysUntil(cert.expiry, now) <= EXPIRY_WARNING_DAYS)
        return "expiring";
    return "valid";
}

export function daysUntil(date: Date, now: Date = new Date()): number {
    return Math.floor((date.getTime() - now.getTime()) / 86400000);
}

/* Parse renewal configuration files. The input is the concatenation of
 * several files, each introduced by a "==> /path/to/name.conf <==" line
 * (the format of "tail -n +1 file..."). Returns lineage name → flat key/value
 * map of all sections. */
export function parseRenewalConfs(output: string): Record<string, RenewalConf> {
    const result: Record<string, RenewalConf> = {};
    let cur: RenewalConf | null = null;

    for (const raw of output.split("\n")) {
        const header = raw.match(/^==> (?:.*\/)?([^/]+)\.conf <==$/);
        if (header) {
            cur = {};
            result[header[1]] = cur;
            continue;
        }
        if (!cur)
            continue;
        const line = raw.trim();
        if (line === "" || line.startsWith("#") || line.startsWith("["))
            continue;
        const eq = line.indexOf("=");
        if (eq > 0)
            cur[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }

    return result;
}

export interface PluginInfo {
    name: string;
    description: string;
    interfaces: string[];
}

/* Parse the output of "certbot plugins" */
export function parsePlugins(output: string): PluginInfo[] {
    const plugins: PluginInfo[] = [];
    let cur: PluginInfo | null = null;
    let field: "description" | "interfaces" | "other" | null = null;

    for (const raw of output.split("\n")) {
        const line = raw.trimEnd();
        const start = line.match(/^\* (\S+)$/);
        if (start) {
            cur = { name: start[1], description: "", interfaces: [] };
            plugins.push(cur);
            field = null;
            continue;
        }
        if (!cur)
            continue;
        if (line === "" || line.startsWith("- - -")) {
            cur = null;
            continue;
        }

        const m = line.match(/^(Description|Interfaces|Entry point):\s*(.*)$/);
        if (m) {
            field = m[1] === "Description" ? "description" : m[1] === "Interfaces" ? "interfaces" : "other";
            if (field === "description")
                cur.description = m[2];
            else if (field === "interfaces")
                cur.interfaces = m[2].split(",").map(s => s.trim())
                        .filter(Boolean);
        } else if (field === "description") {
            /* certbot wraps long descriptions */
            cur.description += " " + line.trim();
        }
    }

    return plugins;
}

export function dnsPlugins(plugins: PluginInfo[]): PluginInfo[] {
    return plugins.filter(p => p.name.startsWith("dns-") && p.interfaces.includes("Authenticator"));
}

export function parseIni(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#") || line.startsWith(";") || line.startsWith("["))
            continue;
        const eq = line.indexOf("=");
        if (eq > 0)
            result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return result;
}

export function formatIni(values: Record<string, string>): string {
    return Object.entries(values)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => `${k} = ${v.replace(/[\r\n]+/g, " ")}`)
            .join("\n") + "\n";
}

/* Render the credentials file contents for a provider from form values */
export function credentialsFileContent(provider: Provider, values: Record<string, string>): string {
    if (provider.format === "json")
        return (values.json ?? "").trim() + "\n";
    if (provider.fields.length === 1 && provider.fields[0].key === "ini")
        return (values.ini ?? "").trim() + "\n";
    const out: Record<string, string> = {};
    for (const f of provider.fields)
        out[f.key] = (values[f.key] ?? "").trim();
    return formatIni(out);
}

export function credentialsPath(provider: Provider, id: string): string {
    return `${CREDENTIALS_DIR}/${id}.${provider.format === "json" ? "json" : "ini"}`;
}

export function slugify(label: string): string {
    return label.toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "credentials";
}

export interface CredentialsProfile {
    id: string;
    label: string;
    plugin: string;
    path: string;
}

/* Hostnames as accepted by Let's Encrypt: optional leading "*." wildcard,
 * at least two labels, no IP addresses */
export function isValidDomain(domain: string): boolean {
    if (domain.length > 253)
        return false;
    const name = domain.startsWith("*.") ? domain.slice(2) : domain;
    const labels = name.split(".");
    if (labels.length < 2)
        return false;
    if (/^\d+$/.test(labels[labels.length - 1]))
        return false;
    return labels.every(l => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(l));
}

export function splitDomains(text: string): string[] {
    return text.split(/[\s,]+/).map(d => d.trim().toLowerCase())
            .filter(Boolean)
            .filter((d, i, all) => all.indexOf(d) === i);
}

/* certbot's default lineage name is the first domain, without wildcard */
export function defaultCertName(domains: string[]): string {
    const first = domains[0] ?? "";
    return first.replace(/^\*\./, "");
}

export function isValidCertName(name: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes("..");
}

export type Challenge =
    | { type: "standalone", port?: number }
    | { type: "webroot", path: string }
    | { type: "dns", provider: Provider, credentials?: string, propagationSeconds?: number };

export interface CertificateRequest {
    certName: string;
    domains: string[];
    email: string;
    challenge: Challenge;
    keyType: "ecdsa" | "rsa";
    staging: boolean;
}

export function certonlyArgs(req: CertificateRequest): string[] {
    const args = ["certbot", "certonly", "--non-interactive", "--agree-tos"];

    if (req.email)
        args.push("--email", req.email, "--no-eff-email");
    else
        args.push("--register-unsafely-without-email");

    args.push("--cert-name", req.certName, "--key-type", req.keyType);
    for (const d of req.domains)
        args.push("--domain", d);

    const c = req.challenge;
    if (c.type === "standalone") {
        args.push("--standalone");
        if (c.port)
            args.push("--http-01-port", String(c.port));
    } else if (c.type === "webroot") {
        args.push("--webroot", "--webroot-path", c.path);
    } else {
        const p = c.provider.plugin;
        args.push("--authenticator", p);
        if (c.provider.format !== "none" && c.credentials)
            args.push(`--${p}-credentials`, c.credentials);
        if (c.provider.propagation && c.propagationSeconds)
            args.push(`--${p}-propagation-seconds`, String(c.propagationSeconds));
    }

    if (req.staging)
        args.push("--test-cert");

    return args;
}

/* Which domains of a request need DNS-01 validation */
export function needsDns(domains: string[]): boolean {
    return domains.some(d => d.startsWith("*."));
}

/* "cockpit-certificate-ensure --check" output → certificate file in use */
export function parseEnsureCheck(output: string): string | null {
    const m = output.match(/Would use certificate (\S+)/);
    return m ? m[1] : null;
}

/* Contents of the file that tells the deploy hook which lineage belongs to Cockpit */
export function cockpitWsConf(certName: string): string {
    return `# Managed by the Cockpit Let's Encrypt module\nCOCKPIT_CERT_NAME=${certName}\n`;
}

export function parseCockpitWsConf(text: string | null): string | null {
    const m = text?.match(/^COCKPIT_CERT_NAME=(.+)$/m);
    return m ? m[1].trim() : null;
}

/* The renewal timer differs per distribution and install method */
export const RENEWAL_TIMERS = ["certbot-renew.timer", "certbot.timer", "snap.certbot.renew.timer"];

/* Whether a certificate for these names is valid for a host name */
export function coversHost(domains: string[], host: string): boolean {
    const h = host.toLowerCase().replace(/\.$/, "");
    return domains.some(d => {
        const name = d.toLowerCase();
        if (name.startsWith("*.")) {
            const base = name.slice(2);
            const dot = h.indexOf(".");
            return dot > 0 && h.slice(dot + 1) === base;
        }
        return name === h;
    });
}
