/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption, FormSelectOptionGroup } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import cockpit from 'cockpit';
import type { DialogResult } from 'dialogs';
import { FormHelper } from 'cockpit-components-form-helper';
import { ModalError } from 'cockpit-components-inline-notification';

import { credentialsFileContent, credentialsPath, parseIni, slugify } from './certbot';
import type { CredentialsProfile, PluginInfo } from './certbot';
import { readFile, saveProfile, writeSecretFile } from './backend';
import { PROVIDERS, findProvider, genericProvider, isGeneric } from './providers';
import type { Provider } from './providers';

const _ = cockpit.gettext;

/* Providers to offer: all known ones, plus any installed dns-* plugin we don't know */
export function availableProviders(installed: PluginInfo[]): Provider[] {
    const extra = installed.filter(p => !PROVIDERS.some(k => k.plugin === p.name))
            .map(p => genericProvider(p.name, p.description));
    return [...PROVIDERS, ...extra];
}

export const CredentialsDialog = ({ profile, profiles, installed, onInstall, dialogResult }: {
    profile: CredentialsProfile | null,
    profiles: CredentialsProfile[],
    installed: PluginInfo[],
    onInstall: (provider: Provider) => Promise<void>,
    dialogResult: DialogResult<CredentialsProfile | null>,
}) => {
    const providers = availableProviders(installed);
    const isInstalled = (p: Provider) => installed.some(i => i.name === p.plugin);

    const [plugin, setPlugin] = useState(profile?.plugin ??
                                         (providers.find(isInstalled) ?? providers[0]).plugin);
    const provider = providers.find(p => p.plugin === plugin) ?? findProvider(plugin);
    const [label, setLabel] = useState(profile?.label ?? "");
    const [values, setValues] = useState<Record<string, string>>({});
    /* secrets that already exist on disk; left empty in the form means "keep" */
    const [existing, setExisting] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [validate, setValidate] = useState(false);

    useEffect(() => {
        if (!profile)
            return;
        readFile(profile.path).then(text => {
            const p = findProvider(profile.plugin);
            let old: Record<string, string>;
            if (p.format === "json")
                old = { json: text ?? "" };
            else if (isGeneric(p))
                old = { ini: text ?? "" };
            else
                old = parseIni(text ?? "");
            setExisting(old);
            /* prefill non-secret fields; secrets stay hidden */
            setValues(Object.fromEntries(p.fields.filter(f => !f.secret).map(f => [f.key, old[f.key] ?? ""])));
        }, ex => setError(ex.message));
    }, [profile]);

    const fieldValue = (key: string) => values[key] ?? provider.fields.find(f => f.key === key)?.default ?? "";
    const effective = (key: string) => fieldValue(key) || existing[key] || "";

    const id = profile?.id ?? slugify(`${plugin.replace(/^dns-/, "")}-${label}`);
    const labelError = !label.trim()
        ? _("Name must not be empty")
        : (!profile && profiles.some(p => p.id === id))
            ? _("Credentials with this name already exist")
            : null;
    const fieldErrors = Object.fromEntries(provider.fields
            .filter(f => !f.optional && !effective(f.key).trim())
            .map(f => [f.key, _("This field is required")]));
    if (provider.format === "json" && effective("json").trim()) {
        try {
            JSON.parse(effective("json"));
        } catch {
            fieldErrors.json = _("Not valid JSON");
        }
    }

    const save = async () => {
        setValidate(true);
        if (labelError || Object.keys(fieldErrors).length)
            return;
        setBusy(true);
        setError(null);
        try {
            const path = credentialsPath(provider, id);
            if (provider.format !== "none") {
                const merged = Object.fromEntries(provider.fields.map(f => [f.key, effective(f.key)]));
                await writeSecretFile(path, credentialsFileContent(provider, merged));
            }
            const saved = { id, label: label.trim(), plugin, path: provider.format === "none" ? "" : path };
            await saveProfile(saved);
            dialogResult.resolve(saved);
        } catch (ex) {
            setError((ex as Error).message);
            setBusy(false);
        }
    };

    const installHelp = !isInstalled(provider) && (
        <Alert variant="warning" isInline
               title={cockpit.format(_("The certbot plugin $0 is not installed"), provider.plugin)}>
            {provider.package
                ? <Button variant="link" isInline onClick={() => onInstall(provider)}>
                    {cockpit.format(_("Install $0"), provider.package)}
                </Button>
                : provider.pip && <p>{cockpit.format(_("Install it with: $0"), `pip install ${provider.pip}`)}</p>}
        </Alert>
    );

    const known = providers.filter(p => !isGeneric(p));
    const others = providers.filter(p => isGeneric(p));

    return (
        <Modal id="credentials-dialog" position="top" variant="small" isOpen
               onClose={() => dialogResult.resolve(null)}>
            <ModalHeader title={profile ? _("Edit DNS credentials") : _("Add DNS credentials")} />
            <ModalBody>
                {error && <ModalError dialogError={_("Could not save credentials")} dialogErrorDetail={error} />}
                <Form isHorizontal onSubmit={e => { e.preventDefault(); save() }}>
                    <FormGroup label={_("DNS provider")} fieldId="credentials-provider">
                        <FormSelect id="credentials-provider" value={plugin} isDisabled={!!profile}
                                    onChange={(_e, v) => { setPlugin(v); setValues({}) }}>
                            <FormSelectOptionGroup label={_("Known providers")}>
                                {known.map(p =>
                                    <FormSelectOption key={p.plugin} value={p.plugin}
                                                      label={isInstalled(p) ? p.label : cockpit.format(_("$0 (not installed)"), p.label)}
                                    />)}
                            </FormSelectOptionGroup>
                            {others.length > 0 &&
                                <FormSelectOptionGroup label={_("Other installed plugins")}>
                                    {others.map(p => <FormSelectOption key={p.plugin} value={p.plugin} label={p.label} />)}
                                </FormSelectOptionGroup>}
                        </FormSelect>
                    </FormGroup>
                    {installHelp}
                    {provider.note && <Alert variant="info" isInline isPlain title={provider.note} />}
                    <FormGroup label={_("Name")} fieldId="credentials-label" isRequired>
                        <TextInput id="credentials-label" value={label} isDisabled={!!profile}
                                   validated={validate && labelError ? "error" : "default"}
                                   placeholder={_("e.g. Home zone")}
                                   onChange={(_e, v) => setLabel(v)} />
                        <FormHelper fieldId="credentials-label" helperTextInvalid={validate ? labelError : null} />
                    </FormGroup>
                    {provider.fields.map(f => {
                        const fid = "credentials-" + f.key;
                        const invalid = validate && fieldErrors[f.key];
                        const keep = f.secret && existing[f.key] ? _("Leave empty to keep the current value") : undefined;
                        const multiline = f.key === "json" || f.key === "ini";
                        return (
                            <FormGroup key={f.key} label={f.label} fieldId={fid} isRequired={!f.optional && !keep}>
                                {multiline
                                    ? <TextArea id={fid} value={values[f.key] ?? ""} rows={8} resizeOrientation="vertical"
                                                className="credentials-textarea" placeholder={keep ?? ""}
                                                validated={invalid ? "error" : "default"}
                                                onChange={(_e, v) => setValues(old => ({ ...old, [f.key]: v }))} />
                                    : <TextInput id={fid} value={fieldValue(f.key)} type={f.secret ? "password" : "text"}
                                                 autoComplete="off" placeholder={keep ?? f.placeholder ?? ""}
                                                 validated={invalid ? "error" : "default"}
                                                 onChange={(_e, v) => setValues(old => ({ ...old, [f.key]: v }))}
                                    />}
                                <FormHelper fieldId={fid} helperTextInvalid={invalid || null} />
                            </FormGroup>
                        );
                    })}
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={save} isLoading={busy} isDisabled={busy}>
                    {_("Save")}
                </Button>
                <Button variant="link" onClick={() => dialogResult.resolve(null)}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
};
