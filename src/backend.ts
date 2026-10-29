/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Talks to the system through cockpit.spawn and cockpit.file. Every call
 * that touches /etc/letsencrypt needs administrative access.
 */

import cockpit from 'cockpit';

import {
    COCKPIT_WS_CONF, CREDENTIALS_DIR, DEPLOY_HOOK, LE_DIR, PROFILES_FILE, RENEWAL_TIMERS, SETTINGS_FILE,
    WS_CERT, WS_KEY,
    cockpitWsConf, parseCertificates, parseCockpitWsConf, parseEnsureCheck, parsePlugins, parseRenewalConfs,
} from './certbot';
import type { CertificateInfo, CredentialsProfile, PluginInfo, RenewalConf } from './certbot';
import type { Provider } from './providers';

import deployHookScript from './deploy-hook.sh';
import installPluginScript from './install-plugin.sh';

const SU = { superuser: "require" as const, err: "message" as const };

/* Quick check that doesn't start certbot */
export async function certbotInstalled(): Promise<boolean> {
    const out = await cockpit.script("command -v certbot || true", [], SU);
    return out.trim() !== "";
}

export async function certbotVersion(): Promise<string | null> {
    try {
        const out = await cockpit.spawn(["certbot", "--version"], { ...SU, err: "out" });
        return out.trim().replace(/^certbot\s+/, "");
    } catch (ex) {
        if ((ex as cockpit.ProcessError).problem === "not-found")
            return null;
        throw ex;
    }
}

/* Read each lineage's certificate with openssl. This is much faster than
 * "certbot certificates", which also checks revocation over the network. */
export async function listCertificates(renewal: Record<string, RenewalConf>): Promise<CertificateInfo[]> {
    const out = await cockpit.script(
        `cd ${LE_DIR}/renewal 2>/dev/null || exit 0
         for f in *.conf; do
             [ -e "$f" ] || continue
             get() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$f" | head -n 1; }
             cert=$(get cert)
             echo "==> \${f%.conf}"
             echo "fullchain=$(get fullchain)"
             echo "privkey=$(get privkey)"
             [ -r "$cert" ] || continue
             openssl x509 -in "$cert" -noout -serial -enddate 2>/dev/null
             openssl x509 -in "$cert" -noout -text 2>/dev/null |
                 sed -n -e '/X509v3 Subject Alternative Name:/{n;p;}' \\
                        -e 's/^[[:space:]]*Public Key Algorithm:[[:space:]]*/keyalg=/p'
         done`, [], SU);
    return parseCertificates(out, renewal);
}

export async function listRenewalConfs(): Promise<Record<string, RenewalConf>> {
    const out = await cockpit.script(
        `set -e; cd ${LE_DIR}/renewal 2>/dev/null || exit 0
         for f in *.conf; do [ -e "$f" ] || continue; printf '==> %s <==\\n' "$f"; cat "$f"; echo; done`,
        [], SU);
    return parseRenewalConfs(out);
}

export async function listPlugins(): Promise<PluginInfo[]> {
    const out = await cockpit.spawn(["certbot", "plugins"], { ...SU, err: "ignore" });
    return parsePlugins(out);
}

export interface TimerState {
    unit: string;
    enabled: boolean;
    active: boolean;
    next: string;
}

/* Find the certbot renewal timer for this distribution, if any */
export async function renewalTimer(): Promise<TimerState | null> {
    const out = await cockpit.script(
        `for u in "$@"; do
             s=$(systemctl show --property=LoadState,UnitFileState,ActiveState,NextElapseUSecRealtime --timestamp=pretty "$u" 2>/dev/null) || continue
             case "$s" in *LoadState=loaded*) printf 'Unit=%s\\n%s\\n' "$u" "$s"; exit 0 ;; esac
         done`, RENEWAL_TIMERS, { err: "message" });
    const props: Record<string, string> = {};
    for (const line of out.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0)
            props[line.slice(0, eq)] = line.slice(eq + 1);
    }
    if (!props.Unit)
        return null;
    return {
        unit: props.Unit,
        enabled: props.UnitFileState === "enabled" || props.UnitFileState === "static",
        active: props.ActiveState === "active",
        next: props.NextElapseUSecRealtime ?? "",
    };
}

export function enableTimer(unit: string): Promise<string> {
    return cockpit.spawn(["systemctl", "enable", "--now", unit], SU);
}

/* Run a long command and stream its combined output */
export function runStreaming(args: string[], onOutput: (text: string) => void,
    environ: string[] = []): cockpit.Spawn<string> {
    const proc = cockpit.spawn(args, { superuser: "require", err: "out", environ: ["PYTHONUNBUFFERED=1", ...environ] });
    proc.stream(data => { onOutput(data) });
    return proc;
}

/* Installs a certbot plugin the same way certbot is installed: distro
 * package, pip into certbot's virtual environment, or snap */
export function installPluginArgs(provider: Provider): string[] {
    return ["sh", "-c", installPluginScript, "install-plugin",
        provider.plugin, provider.package ?? "", provider.pip ?? `certbot-${provider.plugin}`];
}

export function renewArgs(certName: string | null, force: boolean): string[] {
    const args = ["certbot", "renew", "--non-interactive"];
    if (certName)
        args.push("--cert-name", certName);
    if (force)
        args.push("--force-renewal");
    return args;
}

export function deleteArgs(certName: string): string[] {
    return ["certbot", "delete", "--non-interactive", "--cert-name", certName];
}

export function revokeArgs(certName: string): string[] {
    return ["certbot", "revoke", "--non-interactive", "--cert-name", certName, "--delete-after-revoke"];
}

/* Write a root-only file atomically */
export function writeSecretFile(path: string, content: string): Promise<string> {
    return cockpit.script(
        `set -eu
         umask 077
         mkdir -p "$(dirname "$1")"
         cat > "$1.tmp"
         chmod 600 "$1.tmp"
         mv -f "$1.tmp" "$1"`, [path], SU).input(content);
}

export function readFile(path: string): Promise<string | null> {
    return cockpit.file(path, { superuser: "require" }).read();
}

export function removeFiles(paths: string[]): Promise<string> {
    return cockpit.spawn(["rm", "-f", "--", ...paths], SU);
}

/* Credential profiles (non-secret index of credential files) */

export function profilesFile() {
    return cockpit.file(PROFILES_FILE, { syntax: JSON, superuser: "require" });
}

export async function saveProfile(profile: CredentialsProfile): Promise<void> {
    await cockpit.spawn(["mkdir", "-p", "-m", "700", CREDENTIALS_DIR], SU);
    await profilesFile().modify((old: CredentialsProfile[] | null) => {
        const list = (old ?? []).filter(p => p.id !== profile.id);
        list.push(profile);
        list.sort((a, b) => a.label.localeCompare(b.label));
        return list;
    });
}

export async function removeProfile(profile: CredentialsProfile): Promise<void> {
    await removeFiles([profile.path]);
    await profilesFile().modify((old: CredentialsProfile[] | null) => (old ?? []).filter(p => p.id !== profile.id));
}

/* Module settings (default account email) */

export interface Settings {
    email?: string;
    keyType?: "ecdsa" | "rsa";
}

export function settingsFile() {
    return cockpit.file(SETTINGS_FILE, { syntax: JSON, superuser: "require" });
}

export async function saveSettings(update: Settings): Promise<void> {
    await cockpit.spawn(["mkdir", "-p", "-m", "700", CREDENTIALS_DIR], SU);
    await settingsFile().modify((old: Settings | null) => ({ ...(old ?? {}), ...update }));
}

/* Cockpit web server certificate */

export interface CockpitCertState {
    /* certificate file cockpit-ws would use, or null for "would create a self-signed one" */
    inUse: string | null;
    /* lineage configured for deployment, if any */
    selected: string | null;
    /* whether our deploy hook is installed */
    hookInstalled: boolean;
    /* subject/expiry of the certificate in use, from openssl if available */
    subject: string;
    issuer: string;
    notAfter: Date | null;
}

export async function cockpitCertState(): Promise<CockpitCertState> {
    const check = await cockpit.script(
        `for p in /usr/libexec/cockpit-certificate-ensure /usr/lib/cockpit/cockpit-certificate-ensure; do
             [ -x "$p" ] && exec "$p" --check
         done
         echo "cockpit-certificate-ensure not found"`, [], { ...SU, err: "out" }).catch(ex => String(ex.message ?? ex));
    const inUse = parseEnsureCheck(check);

    const [conf, hook] = await Promise.all([
        readFile(COCKPIT_WS_CONF).catch(() => null),
        cockpit.spawn(["test", "-x", DEPLOY_HOOK], SU).then(() => true, () => false),
    ]);

    const state: CockpitCertState = {
        inUse, selected: parseCockpitWsConf(conf), hookInstalled: hook, subject: "", issuer: "", notAfter: null
    };

    if (inUse) {
        try {
            const out = await cockpit.spawn(["openssl", "x509", "-noout", "-subject", "-issuer", "-enddate", "-in", inUse], SU);
            for (const line of out.split("\n")) {
                const eq = line.indexOf("=");
                if (eq < 0)
                    continue;
                const key = line.slice(0, eq).trim();
                const value = line.slice(eq + 1).trim();
                if (key === "subject")
                    state.subject = value;
                else if (key === "issuer")
                    state.issuer = value;
                else if (key === "notAfter") {
                    const d = new Date(value);
                    state.notAfter = isNaN(d.getTime()) ? null : d;
                }
            }
        } catch (ex) {
            console.warn("Could not inspect certificate", inUse, ex);
        }
    }

    return state;
}

/* Select a lineage for Cockpit, install the renewal hook, and deploy it now
 * (without restarting cockpit, which would cut this session) */
export async function useForCockpit(certName: string): Promise<string> {
    await writeSecretFile(COCKPIT_WS_CONF, cockpitWsConf(certName));
    await cockpit.script(
        `set -eu
         mkdir -p "$(dirname "$1")"
         cat > "$1.tmp"
         chmod 755 "$1.tmp"
         mv -f "$1.tmp" "$1"`, [DEPLOY_HOOK], SU).input(deployHookScript);
    return cockpit.spawn([DEPLOY_HOOK], { ...SU, environ: ["COCKPIT_LE_NO_RESTART=1"] });
}

/* Go back to Cockpit's own (self-signed or other) certificate */
export function stopUsingForCockpit(): Promise<string> {
    return removeFiles([WS_CERT, WS_KEY, COCKPIT_WS_CONF, DEPLOY_HOOK]);
}

export function restartCockpit(): Promise<string> {
    return cockpit.spawn(["systemctl", "--no-block", "try-restart", "cockpit.service"], SU);
}
