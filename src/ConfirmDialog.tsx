/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";

import cockpit from 'cockpit';
import type { DialogResult } from 'dialogs';

const _ = cockpit.gettext;

/* Simple yes/no dialog. With confirm=null it only shows a message. */
export const ConfirmDialog = ({ title, body, warnings = [], confirm, cancel, danger, dialogResult }: {
    title: string,
    body: React.ReactNode,
    warnings?: string[],
    confirm: string | null,
    cancel?: string,
    danger?: boolean,
    dialogResult: DialogResult<boolean>,
}) => (
    <Modal id="confirm-dialog" position="top" variant="small" isOpen
           onClose={() => dialogResult.resolve(false)}>
        <ModalHeader title={title} {...danger && { titleIconVariant: "warning" }} />
        <ModalBody>
            <Stack hasGutter>
                {warnings.map(w => <Alert key={w} variant="warning" isInline title={w} />)}
                <p>{body}</p>
            </Stack>
        </ModalBody>
        <ModalFooter>
            {confirm &&
                <Button variant={danger ? "danger" : "primary"} onClick={() => dialogResult.resolve(true)}>
                    {confirm}
                </Button>}
            <Button variant={confirm ? "link" : "secondary"} onClick={() => dialogResult.resolve(false)}>
                {cancel ?? _("Cancel")}
            </Button>
        </ModalFooter>
    </Modal>
);

export const DeleteCertificateDialog = ({ name, staging, dialogResult }: {
    name: string,
    staging: boolean,
    dialogResult: DialogResult<"delete" | "revoke" | null>,
}) => {
    const [mode, setMode] = useState<"delete" | "revoke">("delete");

    return (
        <Modal id="delete-dialog" position="top" variant="small" isOpen
               onClose={() => dialogResult.resolve(null)}>
            <ModalHeader title={cockpit.format(_("Delete certificate $0?"), name)} titleIconVariant="warning" />
            <ModalBody>
                <Stack hasGutter>
                    <p>{_("The certificate, its key and its renewal configuration are removed from this machine.")}</p>
                    <Radio id="delete-only" name="delete-mode" isChecked={mode === "delete"}
                           onChange={() => setMode("delete")}
                           label={_("Delete only")}
                           description={_("The certificate stays valid until it expires.")} />
                    <Radio id="delete-revoke" name="delete-mode" isChecked={mode === "revoke"}
                           onChange={() => setMode("revoke")}
                           label={_("Revoke and delete")}
                           description={staging
                               ? _("Tells the staging server the certificate must no longer be trusted.")
                               : _("Tells Let's Encrypt the certificate must no longer be trusted, for example because the key leaked.")} />
                </Stack>
            </ModalBody>
            <ModalFooter>
                <Button variant="danger" onClick={() => dialogResult.resolve(mode)}>
                    {mode === "revoke" ? _("Revoke and delete") : _("Delete")}
                </Button>
                <Button variant="link" onClick={() => dialogResult.resolve(null)}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
};
