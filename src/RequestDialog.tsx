/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Form, FormGroup, FormSection } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import cockpit from 'cockpit';
import type { DialogResult } from 'dialogs';
import { FormHelper } from 'cockpit-components-form-helper';

import {
    defaultCertName, isValidCertName, isValidDomain, needsDns, splitDomains,
} from './certbot';
import type { CertificateRequest, Challenge, CredentialsProfile, PluginInfo } from './certbot';
import { findProvider } from './providers';

const _ = cockpit.gettext;

export interface RequestDialogResult {
    request: CertificateRequest;
    rememberEmail: boolean;
}

export const RequestDialog = ({ profiles, installed, existingNames, defaultEmail, dialogResult }: {
    profiles: CredentialsProfile[],
    installed: PluginInfo[],
    existingNames: string[],
    defaultEmail: string,
    dialogResult: DialogResult<RequestDialogResult | "add-credentials" | null>,
}) => {
    const usable = profiles.filter(p => installed.some(i => i.name === p.plugin));

    const [domainText, setDomainText] = useState("");
    const [certName, setCertName] = useState("");
    const [method, setMethod] = useState<"dns" | "standalone" | "webroot">(usable.length ? "dns" : "standalone");
    const [profileId, setProfileId] = useState(usable[0]?.id ?? "");
    const [propagation, setPropagation] = useState("");
    const [webroot, setWebroot] = useState("/var/www/html");
    const [port, setPort] = useState("");
    const [email, setEmail] = useState(defaultEmail);
    const [keyType, setKeyType] = useState<"ecdsa" | "rsa">("ecdsa");
    const [staging, setStaging] = useState(false);
    const [validate, setValidate] = useState(false);

    const domains = splitDomains(domainText);
    const name = certName.trim() || defaultCertName(domains);
    const profile = usable.find(p => p.id === profileId);

    const badDomains = domains.filter(d => !isValidDomain(d));
    const errors: Record<string, string | null> = {
        domains: domains.length === 0
            ? _("Enter at least one domain name")
            : badDomains.length
                ? cockpit.format(_("Not a valid domain name: $0"), badDomains.join(", "))
                : (method !== "dns" && needsDns(domains))
                    ? _("Wildcard certificates require DNS validation")
                    : null,
        name: name && !isValidCertName(name) ? _("Use letters, digits, dots, dashes and underscores only") : null,
        profile: method === "dns" && !profile ? _("Add DNS provider credentials first") : null,
        webroot: method === "webroot" && !webroot.startsWith("/") ? _("Enter an absolute path") : null,
        port: port && !(Number(port) > 0 && Number(port) < 65536) ? _("Enter a port number") : null,
        propagation: propagation && !(Number(propagation) >= 0) ? _("Enter a number of seconds") : null,
        email: email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? _("Not a valid email address") : null,
    };
    const err = (key: string) => validate ? errors[key] : null;
    const replaces = existingNames.includes(name);

    const submit = () => {
        setValidate(true);
        if (Object.values(errors).some(Boolean))
            return;

        let challenge: Challenge;
        if (method === "dns") {
            const provider = findProvider(profile!.plugin);
            challenge = {
                type: "dns",
                provider,
                ...profile!.path && { credentials: profile!.path },
                ...propagation && { propagationSeconds: Number(propagation) },
            };
        } else if (method === "webroot") {
            challenge = { type: "webroot", path: webroot };
        } else {
            challenge = { type: "standalone", ...port && { port: Number(port) } };
        }

        dialogResult.resolve({
            request: { certName: name, domains, email: email.trim(), challenge, keyType, staging },
            rememberEmail: email.trim() !== defaultEmail,
        });
    };

    return (
        <Modal id="request-dialog" position="top" variant="medium" isOpen
               onClose={() => dialogResult.resolve(null)}>
            <ModalHeader title={_("Request certificate")} />
            <ModalBody>
                <Form isHorizontal onSubmit={e => { e.preventDefault(); submit() }}>
                    <FormGroup label={_("Domains")} fieldId="request-domains" isRequired>
                        <TextInput id="request-domains" value={domainText}
                                   placeholder="example.com, *.example.com"
                                   validated={err("domains") ? "error" : "default"}
                                   onChange={(_e, v) => setDomainText(v)} />
                        <FormHelper fieldId="request-domains"
                                    helperText={_("Separate several names with commas or spaces. Wildcards (*.example.com) need DNS validation.")}
                                    helperTextInvalid={err("domains")} />
                    </FormGroup>
                    <FormGroup label={_("Certificate name")} fieldId="request-name">
                        <TextInput id="request-name" value={certName} placeholder={defaultCertName(domains)}
                                   validated={err("name") ? "error" : "default"}
                                   onChange={(_e, v) => setCertName(v)} />
                        <FormHelper fieldId="request-name"
                                    helperText={replaces
                                        ? _("A certificate with this name exists; it will be replaced with these domains.")
                                        : _("Files are stored under /etc/letsencrypt/live/<name>.")}
                                    variant={replaces && !err("name") ? "warning" : undefined}
                                    helperTextInvalid={err("name")} />
                    </FormGroup>

                    <FormGroup label={_("Validation")} fieldId="request-method" isStack role="radiogroup">
                        <Radio id="request-method-dns" name="method" isChecked={method === "dns"}
                               onChange={() => setMethod("dns")}
                               label={_("DNS (DNS-01)")}
                               description={_("Creates a TXT record through your DNS provider's API. Works for wildcards and hosts that are not reachable from the internet.")} />
                        <Radio id="request-method-standalone" name="method" isChecked={method === "standalone"}
                               onChange={() => setMethod("standalone")}
                               label={_("HTTP, built-in web server (HTTP-01)")}
                               description={_("certbot listens on port 80 during validation; nothing else may use that port.")} />
                        <Radio id="request-method-webroot" name="method" isChecked={method === "webroot"}
                               onChange={() => setMethod("webroot")}
                               label={_("HTTP, existing web server (HTTP-01)")}
                               description={_("certbot writes the challenge into the document root of a running web server.")} />
                    </FormGroup>

                    {method === "dns" &&
                        <FormSection>
                            <FormGroup label={_("DNS credentials")} fieldId="request-profile" isRequired>
                                {usable.length > 0
                                    ? <FormSelect id="request-profile" value={profileId}
                                                  onChange={(_e, v) => setProfileId(v)}>
                                        {usable.map(p =>
                                            <FormSelectOption key={p.id} value={p.id}
                                                              label={`${p.label} (${findProvider(p.plugin).label})`}
                                            />)}
                                    </FormSelect>
                                    : <Alert variant="warning" isInline isPlain title={_("No usable DNS credentials")}>
                                        <Button variant="link" isInline
                                                onClick={() => dialogResult.resolve("add-credentials")}>
                                            {_("Add DNS credentials")}
                                        </Button>
                                    </Alert>}
                            </FormGroup>
                            {profile && findProvider(profile.plugin).propagation &&
                                <FormGroup label={_("Propagation wait")} fieldId="request-propagation">
                                    <TextInput id="request-propagation" type="number" value={propagation}
                                               placeholder={_("plugin default")}
                                               validated={err("propagation") ? "error" : "default"}
                                               onChange={(_e, v) => setPropagation(v)} />
                                    <FormHelper fieldId="request-propagation"
                                                helperText={_("Seconds to wait for the TXT record to propagate before validation.")}
                                                helperTextInvalid={err("propagation")} />
                                </FormGroup>}
                        </FormSection>}
                    {method === "webroot" &&
                        <FormGroup label={_("Document root")} fieldId="request-webroot" isRequired>
                            <TextInput id="request-webroot" value={webroot}
                                       validated={err("webroot") ? "error" : "default"}
                                       onChange={(_e, v) => setWebroot(v)} />
                            <FormHelper fieldId="request-webroot" helperTextInvalid={err("webroot")} />
                        </FormGroup>}
                    {method === "standalone" &&
                        <FormGroup label={_("Listen port")} fieldId="request-port">
                            <TextInput id="request-port" type="number" value={port} placeholder="80"
                                       validated={err("port") ? "error" : "default"}
                                       onChange={(_e, v) => setPort(v)} />
                            <FormHelper fieldId="request-port"
                                        helperText={_("Only change this if port 80 is forwarded to another port on this machine.")}
                                        helperTextInvalid={err("port")} />
                        </FormGroup>}

                    <FormGroup label={_("Account email")} fieldId="request-email">
                        <TextInput id="request-email" type="email" value={email}
                                   validated={err("email") ? "error" : "default"}
                                   onChange={(_e, v) => setEmail(v)} />
                        <FormHelper fieldId="request-email"
                                    helperText={_("Used by Let's Encrypt for account recovery. Only used when this machine has no ACME account yet.")}
                                    helperTextInvalid={err("email")} />
                    </FormGroup>
                    <FormGroup label={_("Key type")} fieldId="request-keytype">
                        <FormSelect id="request-keytype" value={keyType}
                                    onChange={(_e, v) => setKeyType(v as "ecdsa" | "rsa")}>
                            <FormSelectOption value="ecdsa" label={_("ECDSA (recommended)")} />
                            <FormSelectOption value="rsa" label="RSA" />
                        </FormSelect>
                    </FormGroup>
                    <FormGroup fieldId="request-staging">
                        <Checkbox id="request-staging" isChecked={staging}
                                  onChange={(_e, v) => setStaging(v)}
                                  label={_("Test certificate (staging server)")}
                                  description={_("Not trusted by browsers, but has generous rate limits. Use it to try out a configuration.")} />
                    </FormGroup>
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={submit}>{_("Request")}</Button>
                <Button variant="link" onClick={() => dialogResult.resolve(null)}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
};
