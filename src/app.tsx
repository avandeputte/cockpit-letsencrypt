/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AlertActionLink } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import {
    DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm
} from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { DropdownItem } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { ExclamationCircleIcon, LockIcon } from "@patternfly/react-icons";

import cockpit from 'cockpit';
import { EmptyStatePanel } from 'cockpit-components-empty-state';
import { KebabDropdown } from 'cockpit-components-dropdown';
import { ListingTable } from 'cockpit-components-table';
import { install_dialog } from 'cockpit-components-install-dialog.jsx';
import { getPackageManager } from 'packagemanager';
import { WithDialogs, useDialogs } from 'dialogs';
import { useEvent, useInit } from 'hooks';
import { superuser } from 'superuser';
import * as timeformat from 'timeformat';

import * as backend from './backend';
import type { CockpitCertState, Settings, TimerState } from './backend';
import {
    STAGING_SERVER, WS_CERT, certificateStatus, certonlyArgs, coversHost, daysUntil, dnsPlugins,
} from './certbot';
import type { CertificateInfo, CertificateStatus, CredentialsProfile, PluginInfo, RenewalConf } from './certbot';
import { CommandDialog } from './CommandDialog';
import { CredentialsDialog } from './CredentialsDialog';
import { ConfirmDialog, DeleteCertificateDialog } from './ConfirmDialog';
import { RequestDialog } from './RequestDialog';
import { findProvider } from './providers';
import type { Provider } from './providers';

const _ = cockpit.gettext;

type DialogsType = ReturnType<typeof useDialogs>;

interface State {
    certificates: CertificateInfo[];
    renewal: Record<string, RenewalConf>;
    plugins: PluginInfo[];
    timer: TimerState | null;
    cockpitCert: CockpitCertState | null;
}

export const Application = () => {
    useEvent(superuser, "changed");

    let content;
    if (superuser.allowed === null)
        content = <EmptyStatePanel loading />;
    else if (!superuser.allowed)
        content = (
            <EmptyStatePanel icon={LockIcon} title={_("Administrative access required")}
                             paragraph={_("Managing certificates requires administrative access. Use the \"Limited access\" button in the top bar to turn it on.")} />
        );
    else
        content = <WithDialogs><Certificates /></WithDialogs>;

    return (
        <Page className='pf-m-no-sidebar' id="letsencrypt">
            {content}
        </Page>
    );
};

const Certificates = () => {
    const [version, setVersion] = useState<string | null | undefined>(undefined);
    const [state, setState] = useState<State | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [profiles, setProfiles] = useState<CredentialsProfile[]>([]);
    const [settings, setSettings] = useState<Settings>({});

    const reload = useCallback(async () => {
        try {
            const v = await backend.certbotVersion();
            setVersion(v);
            if (v === null)
                return;
            const [certificates, renewal, plugins, timer, cockpitCert] = await Promise.all([
                backend.listCertificates(),
                backend.listRenewalConfs(),
                backend.listPlugins(),
                backend.renewalTimer().catch(() => null),
                backend.cockpitCertState().catch(() => null),
            ]);
            setState({ certificates, renewal, plugins, timer, cockpitCert });
            setError(null);
        } catch (ex) {
            setError((ex as Error).message);
        }
    }, []);

    useEffect(() => { reload() }, [reload]);

    const profilesFile = useInit(() => backend.profilesFile(), [], undefined, f => f.close());
    useEffect(() => {
        const w = profilesFile.watch(data => setProfiles(Array.isArray(data) ? data : []));
        return () => w.remove();
    }, [profilesFile]);

    const settingsFile = useInit(() => backend.settingsFile(), [], undefined, f => f.close());
    useEffect(() => {
        const w = settingsFile.watch(data => setSettings(data ?? {}));
        return () => w.remove();
    }, [settingsFile]);

    if (version === undefined || (version && !state && !error))
        return <EmptyStatePanel loading title={_("Loading certificates")} />;

    if (version === null)
        return <CertbotMissing onInstalled={reload} />;

    if (!state)
        return <EmptyStatePanel icon={ExclamationCircleIcon} title={_("Could not read certificates")} paragraph={error} />;

    return (
        <PageSection>
            <Stack hasGutter>
                {error && <Alert variant="danger" isInline title={error} />}
                <CockpitCertCard state={state} reload={reload} />
                <CertificatesCard state={state} profiles={profiles} settings={settings} version={version} reload={reload} />
                <CredentialsCard state={state} profiles={profiles} reload={reload} />
            </Stack>
        </PageSection>
    );
};

const CertbotMissing = ({ onInstalled }: { onInstalled: () => void }) => {
    const [canInstall, setCanInstall] = useState(false);

    useEffect(() => {
        getPackageManager().then(() => setCanInstall(true), () => setCanInstall(false));
    }, []);

    return (
        <EmptyStatePanel
            icon={ExclamationCircleIcon}
            title={_("certbot is not installed")}
            paragraph={canInstall
                ? _("This page uses certbot to obtain and renew Let's Encrypt certificates.")
                : _("This page uses certbot to obtain and renew Let's Encrypt certificates. Install the \"certbot\" package (on RHEL and CentOS it is in EPEL) and reload this page.")}
            {...canInstall && {
                action: _("Install certbot"),
                onAction: () => { install_dialog("certbot").then(onInstalled, () => {}) },
            }} />
    );
};

/* Is this lineage issued by the staging server? */
function isStaging(cert: CertificateInfo, renewal: Record<string, RenewalConf>) {
    return renewal[cert.name]?.server === STAGING_SERVER || cert.validity.includes("TEST_CERT");
}

function validationLabel(conf: RenewalConf | undefined): string {
    const auth = conf?.authenticator;
    if (!auth)
        return _("Unknown");
    if (auth === "standalone")
        return _("HTTP (standalone)");
    if (auth === "webroot")
        return _("HTTP (webroot)");
    if (auth.startsWith("dns-"))
        return cockpit.format(_("DNS: $0"), findProvider(auth).label);
    if (auth === "manual")
        return _("Manual");
    return auth;
}

const StatusLabel = ({ status, expiry }: { status: CertificateStatus, expiry: Date | null }) => {
    const days = expiry ? daysUntil(expiry) : 0;
    switch (status) {
    case "valid":
        return <Label status="success">{cockpit.format(cockpit.ngettext("Valid, $0 day left", "Valid, $0 days left", days), days)}</Label>;
    case "expiring":
        return <Label status="warning">{cockpit.format(cockpit.ngettext("Expires in $0 day", "Expires in $0 days", days), days)}</Label>;
    case "expired":
        return <Label status="danger">{_("Expired")}</Label>;
    case "test":
        return <Label color="purple">{_("Test certificate")}</Label>;
    default:
        return <Label status="danger">{_("Invalid")}</Label>;
    }
};

const RenewalTimerAlert = ({ timer, reload }: { timer: TimerState | null, reload: () => void }) => {
    const [error, setError] = useState<string | null>(null);

    if (!timer)
        return (
            <Alert variant="warning" isInline isPlain id="renewal-timer"
                   title={_("No certbot renewal timer found. Certificates will not renew automatically unless a cron job runs \"certbot renew\".")} />
        );
    if (timer.enabled && timer.active)
        return (
            <Alert variant="info" isInline isPlain id="renewal-timer"
                   title={timer.next && timer.next !== "n/a"
                       ? cockpit.format(_("Automatic renewal is on ($0). Next check: $1"), timer.unit, timer.next)
                       : cockpit.format(_("Automatic renewal is on ($0)."), timer.unit)} />
        );
    return (
        <Alert variant="warning" isInline id="renewal-timer"
               title={cockpit.format(_("Automatic renewal is off: $0 is not running"), timer.unit)}
               actionLinks={
                   <AlertActionLink onClick={() => backend.enableTimer(timer.unit).then(reload, ex => setError(ex.message))}>
                       {_("Turn on automatic renewal")}
                   </AlertActionLink>
               }>
            {error}
        </Alert>
    );
};

async function addCredentials(Dialogs: DialogsType, profiles: CredentialsProfile[],
    installed: PluginInfo[], reload: () => void, profile: CredentialsProfile | null = null) {
    let installedNow = false;
    const onInstall = async (provider: Provider) => {
        /* the install dialog is a separate modal that stacks above ours */
        await install_dialog(provider.package).then(() => { installedNow = true }, () => {});
    };
    await Dialogs.run(CredentialsDialog, { profile, profiles, installed, onInstall });
    if (installedNow)
        reload();
}

async function offerRestart(Dialogs: DialogsType) {
    const restart = await Dialogs.run(ConfirmDialog, {
        title: _("Restart the web console?"),
        body: _("Cockpit uses the new certificate after it restarts. This disconnects your session; reload the page and log in again afterwards."),
        confirm: _("Restart now"),
        cancel: _("Later"),
    });
    if (restart)
        await backend.restartCockpit();
}

async function showError(Dialogs: DialogsType, title: string, ex: unknown) {
    await Dialogs.run(ConfirmDialog, { title, body: (ex as Error).message ?? String(ex), confirm: null, cancel: _("Close") });
}

const CertificatesCard = ({ state, profiles, settings, version, reload }: {
    state: State,
    profiles: CredentialsProfile[],
    settings: Settings,
    version: string,
    reload: () => void,
}) => {
    const Dialogs = useDialogs();
    const installed = dnsPlugins(state.plugins);
    const cockpitName = state.cockpitCert?.selected;

    const run = async (title: string, args: string[], successText?: string) => {
        await Dialogs.run(CommandDialog, { title, args, ...successText && { successText } });
        reload();
    };

    const request = async () => {
        const result = await Dialogs.run(RequestDialog, {
            profiles,
            installed,
            existingNames: state.certificates.map(c => c.name),
            defaultEmail: settings.email ?? "",
        });
        if (result === "add-credentials")
            return addCredentials(Dialogs, profiles, installed, reload);
        if (!result)
            return;
        if (result.rememberEmail && result.request.email)
            await backend.saveSettings({ email: result.request.email }).catch(ex => console.warn(ex));
        await run(cockpit.format(_("Requesting certificate $0"), result.request.certName),
                  certonlyArgs(result.request),
                  _("Certificate issued"));
    };

    const deployToCockpit = async (cert: CertificateInfo) => {
        const host = window.location.hostname;
        const warnings = [];
        if (!coversHost(cert.domains, host))
            warnings.push(cockpit.format(_("You are connected to this machine as \"$0\", which this certificate does not cover. Browsers will show a warning for that address."), host));
        if (isStaging(cert, state.renewal))
            warnings.push(_("This is a test certificate from the staging server. Browsers do not trust it."));

        const ok = await Dialogs.run(ConfirmDialog, {
            title: cockpit.format(_("Use $0 for Cockpit?"), cert.name),
            body: _("The certificate is copied to /etc/cockpit/ws-certs.d/ now and again after every renewal, followed by a restart of the web console."),
            warnings,
            confirm: _("Use for Cockpit"),
        });
        if (!ok)
            return;
        try {
            await backend.useForCockpit(cert.name);
        } catch (ex) {
            reload();
            return showError(Dialogs, _("Could not install the certificate"), ex);
        }
        reload();
        await offerRestart(Dialogs);
    };

    const remove = async (cert: CertificateInfo) => {
        const choice = await Dialogs.run(DeleteCertificateDialog, { name: cert.name, staging: isStaging(cert, state.renewal) });
        if (!choice)
            return;
        await run(cockpit.format(_("Deleting certificate $0"), cert.name),
                  choice === "revoke" ? backend.revokeArgs(cert.name) : backend.deleteArgs(cert.name));
    };

    const rows = state.certificates.map(cert => {
        const status = certificateStatus(cert);
        const conf = state.renewal[cert.name];
        const isCockpit = cert.name === cockpitName;
        const actions = [
            <DropdownItem key="renew"
                          onClick={() => run(cockpit.format(_("Renewing $0"), cert.name),
                                             backend.renewArgs(cert.name, true), _("Certificate renewed"))}>
                {_("Renew now")}
            </DropdownItem>,
            <DropdownItem key="cockpit" isDisabled={isCockpit} onClick={() => deployToCockpit(cert)}>
                {_("Use for Cockpit")}
            </DropdownItem>,
            <Divider key="divider" />,
            <DropdownItem key="delete" isDanger isDisabled={isCockpit} onClick={() => remove(cert)}
                          description={isCockpit ? _("Used by Cockpit") : undefined}>
                {_("Delete")}
            </DropdownItem>,
        ];
        return {
            props: { key: cert.name },
            columns: [
                {
                    title: (
                        <Flex spaceItems={{ default: "spaceItemsSm" }}>
                            <span>{cert.name}</span>
                            {isCockpit && <Label color="blue" isCompact>{_("Cockpit")}</Label>}
                        </Flex>
                    )
                },
                { title: <span className="cert-domains">{cert.domains.join(", ")}</span> },
                { title: validationLabel(conf) },
                { title: cert.expiry ? timeformat.date(cert.expiry) : _("Unknown") },
                { title: <StatusLabel status={status} expiry={cert.expiry} /> },
                {
                    title: <KebabDropdown dropdownItems={actions} toggleButtonId={"cert-actions-" + cert.name} />,
                    props: { className: "pf-v6-c-table__action" }
                },
            ],
        };
    });

    return (
        <Card id="certificates">
            <CardHeader actions={{
                actions: (
                    <>
                        <Button variant="secondary" id="renew-due" isDisabled={state.certificates.length === 0}
                                onClick={() => run(_("Renewing certificates that are due"), backend.renewArgs(null, false))}>
                            {_("Renew due")}
                        </Button>
                        <Button variant="primary" id="request-certificate" onClick={request}>
                            {_("Request certificate")}
                        </Button>
                    </>
                ),
            }}>
                <CardTitle component="h2">{_("Certificates")}</CardTitle>
            </CardHeader>
            <CardBody>
                <Stack hasGutter>
                    <RenewalTimerAlert timer={state.timer} reload={reload} />
                    <ListingTable aria-label={_("Certificates")} variant="compact"
                                  emptyCaption={_("No certificates yet")}
                                  emptyCaptionDetail={cockpit.format(_("certbot $0"), version)}
                                  columns={[_("Name"), _("Domains"), _("Validation"), _("Expires"), _("Status"), { title: "", props: { screenReaderText: _("Actions") } }]}
                                  rows={rows} />
                </Stack>
            </CardBody>
        </Card>
    );
};

const CockpitCertCard = ({ state, reload }: { state: State, reload: () => void }) => {
    const Dialogs = useDialogs();
    const cc = state.cockpitCert;
    if (!cc)
        return null;

    const ours = cc.inUse === WS_CERT;
    const selectedCert = state.certificates.find(c => c.name === cc.selected);

    let source;
    if (ours && cc.selected)
        source = cockpit.format(_("Let's Encrypt certificate \"$0\""), cc.selected);
    else if (!cc.inUse)
        source = _("Self-signed certificate (not created yet)");
    else if (cc.inUse.endsWith("/0-self-signed.cert"))
        source = _("Self-signed certificate");
    else
        source = _("Other certificate");

    const stop = async () => {
        const ok = await Dialogs.run(ConfirmDialog, {
            title: _("Stop using Let's Encrypt for Cockpit?"),
            body: _("The copied certificate is removed from /etc/cockpit/ws-certs.d/ and renewals no longer update Cockpit, which falls back to its previous certificate. The Let's Encrypt certificate itself is kept."),
            confirm: _("Stop using"),
        });
        if (!ok)
            return;
        try {
            await backend.stopUsingForCockpit();
        } catch (ex) {
            reload();
            return showError(Dialogs, _("Could not remove the certificate"), ex);
        }
        reload();
        await offerRestart(Dialogs);
    };

    const redeploy = async () => {
        try {
            await backend.useForCockpit(cc.selected!);
        } catch (ex) {
            reload();
            return showError(Dialogs, _("Could not install the certificate"), ex);
        }
        reload();
        await offerRestart(Dialogs);
    };

    /* a file that sorts after ours wins; ours can only be fixed by redeploying if nothing does */
    const shadowed = !!cc.inUse && cc.inUse > WS_CERT;

    return (
        <Card id="cockpit-certificate">
            <CardHeader {...cc.selected && {
                actions: { actions: <Button variant="secondary" id="cockpit-cert-stop" onClick={stop}>{_("Stop using")}</Button> }
            }}>
                <CardTitle component="h2">{_("Web console certificate")}</CardTitle>
            </CardHeader>
            <CardBody>
                <Stack hasGutter>
                    {cc.selected && !selectedCert &&
                        <Alert variant="danger" isInline
                               title={cockpit.format(_("The certificate \"$0\" selected for Cockpit no longer exists."), cc.selected)}
                        />}
                    {cc.selected && selectedCert && !ours &&
                        <Alert variant="warning" isInline
                               title={shadowed
                                   ? cockpit.format(_("Cockpit uses $0 instead, because it sorts after $1. Rename or remove it to use Let's Encrypt."), cc.inUse, WS_CERT)
                                   : _("The Let's Encrypt certificate is not deployed.")}
                               {...!shadowed && { actionLinks: <AlertActionLink onClick={redeploy}>{_("Deploy now")}</AlertActionLink> }}
                        />}
                    {cc.selected && selectedCert && !cc.hookInstalled &&
                        <Alert variant="warning" isInline title={_("The renewal hook is missing, so renewals will not update Cockpit.")}
                               actionLinks={<AlertActionLink onClick={redeploy}>{_("Repair")}</AlertActionLink>}
                        />}
                    <DescriptionList isHorizontal isCompact>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("In use")}</DescriptionListTerm>
                            <DescriptionListDescription id="cockpit-cert-source">{source}</DescriptionListDescription>
                        </DescriptionListGroup>
                        {cc.inUse &&
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("File")}</DescriptionListTerm>
                                <DescriptionListDescription><code>{cc.inUse}</code></DescriptionListDescription>
                            </DescriptionListGroup>}
                        {cc.subject &&
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Subject")}</DescriptionListTerm>
                                <DescriptionListDescription>{cc.subject}</DescriptionListDescription>
                            </DescriptionListGroup>}
                        {cc.issuer &&
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Issuer")}</DescriptionListTerm>
                                <DescriptionListDescription>{cc.issuer}</DescriptionListDescription>
                            </DescriptionListGroup>}
                        {cc.notAfter &&
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Expires")}</DescriptionListTerm>
                                <DescriptionListDescription>{timeformat.dateTime(cc.notAfter)}</DescriptionListDescription>
                            </DescriptionListGroup>}
                    </DescriptionList>
                    {!cc.selected &&
                        <p id="cockpit-cert-hint">
                            {state.certificates.length
                                ? _("To secure the web console with a trusted certificate, choose \"Use for Cockpit\" in a certificate's menu below.")
                                : _("Request a certificate for this machine's host name below, then choose \"Use for Cockpit\" in its menu.")}
                        </p>}
                </Stack>
            </CardBody>
        </Card>
    );
};

const CredentialsCard = ({ state, profiles, reload }: {
    state: State,
    profiles: CredentialsProfile[],
    reload: () => void,
}) => {
    const Dialogs = useDialogs();
    const installed = dnsPlugins(state.plugins);

    /* which lineages use a profile, from the renewal configuration */
    const usedBy = (p: CredentialsProfile) => Object.entries(state.renewal)
            .filter(([, conf]) => conf.authenticator === p.plugin &&
                (!p.path || Object.values(conf).includes(p.path)))
            .map(([name]) => name);

    const remove = async (p: CredentialsProfile) => {
        const users = usedBy(p);
        const ok = await Dialogs.run(ConfirmDialog, {
            title: cockpit.format(_("Delete credentials $0?"), p.label),
            body: _("The credentials file is deleted."),
            warnings: users.length
                ? [cockpit.format(_("Used by $0. Renewing these certificates will fail."), users.join(", "))]
                : [],
            confirm: _("Delete"),
            danger: true,
        });
        if (!ok)
            return;
        try {
            await backend.removeProfile(p);
        } catch (ex) {
            return showError(Dialogs, _("Could not delete credentials"), ex);
        }
    };

    const rows = profiles.map(p => {
        const users = usedBy(p);
        const pluginOk = installed.some(i => i.name === p.plugin);
        const actions = [
            <DropdownItem key="edit" onClick={() => addCredentials(Dialogs, profiles, installed, reload, p)}>
                {_("Edit")}
            </DropdownItem>,
            <DropdownItem key="delete" isDanger onClick={() => remove(p)}>
                {_("Delete")}
            </DropdownItem>,
        ];
        return {
            props: { key: p.id },
            columns: [
                { title: p.label },
                {
                    title: (
                        <Flex spaceItems={{ default: "spaceItemsSm" }}>
                            <span>{findProvider(p.plugin).label}</span>
                            {!pluginOk && <Label status="warning" isCompact>{_("Plugin not installed")}</Label>}
                        </Flex>
                    )
                },
                { title: users.length ? users.join(", ") : _("Not used") },
                {
                    title: <KebabDropdown toggleButtonId={"profile-actions-" + p.id} dropdownItems={actions} />,
                    props: { className: "pf-v6-c-table__action" }
                },
            ],
        };
    });

    return (
        <Card id="dns-credentials">
            <CardHeader actions={{
                actions: (
                    <Button variant="secondary" id="add-credentials"
                            onClick={() => addCredentials(Dialogs, profiles, installed, reload)}>
                        {_("Add credentials")}
                    </Button>
                )
            }}>
                <CardTitle component="h2">{_("DNS provider credentials")}</CardTitle>
            </CardHeader>
            <CardBody>
                <ListingTable aria-label={_("DNS provider credentials")} variant="compact"
                              emptyCaption={_("No DNS credentials")}
                              emptyCaptionDetail={_("DNS validation needs API credentials for your DNS provider. They are stored readable by root only in /etc/letsencrypt/cockpit/credentials/.")}
                              columns={[_("Name"), _("Provider"), _("Used by"), { title: "", props: { screenReaderText: _("Actions") } }]}
                              rows={rows} />
            </CardBody>
        </Card>
    );
};
