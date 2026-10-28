/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';

import cockpit from 'cockpit';
import type { DialogResult } from 'dialogs';

import { runStreaming } from './backend';

const _ = cockpit.gettext;

/* Runs a command (usually certbot) and shows its live output. Resolves to
 * true when the command succeeded. With autoClose, a successful run closes
 * the dialog by itself, for steps that lead into another one. */
export const CommandDialog = ({ title, args, command, environ, successText, autoClose, dialogResult }: {
    title: string,
    args: string[],
    /* shown instead of args, e.g. for an embedded script */
    command?: string,
    environ?: string[],
    successText?: string,
    autoClose?: boolean,
    dialogResult: DialogResult<boolean>,
}) => {
    const [output, setOutput] = useState("");
    const [state, setState] = useState<"running" | "done" | "failed">("running");
    const [error, setError] = useState("");
    const proc = useRef<cockpit.Spawn<string> | null>(null);
    const pre = useRef<HTMLPreElement>(null);

    useEffect(() => {
        const p = runStreaming(args, text => setOutput(o => o + text), environ);
        proc.current = p;
        p.then(() => {
            if (autoClose)
                dialogResult.resolve(true);
            else
                setState("done");
        })
                .catch(ex => {
                    setError(ex.message || String(ex));
                    setState("failed");
                });
        return () => { if (p.state() === "pending") p.close("terminated"); };
        // run exactly once per dialog
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (pre.current)
            pre.current.scrollTop = pre.current.scrollHeight;
    }, [output]);

    const close = () => dialogResult.resolve(state === "done");

    return (
        <Modal id="command-dialog" position="top" variant="medium" isOpen
               onClose={state === "running" ? undefined : close}>
            <ModalHeader title={title} />
            <ModalBody>
                {state === "done" && <Alert variant="success" isInline title={successText ?? _("Completed")} />}
                {state === "failed" && <Alert variant="danger" isInline title={_("Failed")}>{error}</Alert>}
                <pre ref={pre} className="command-output" aria-live="polite">
                    {"$ " + (command ?? args.join(" ")) + "\n" + output}
                </pre>
            </ModalBody>
            <ModalFooter>
                {state === "running"
                    ? <Button variant="secondary" isLoading
                              onClick={() => proc.current?.close("terminated")}>
                        {_("Cancel")}
                    </Button>
                    : <Button variant="primary" onClick={close}>{_("Close")}</Button>}
            </ModalFooter>
        </Modal>
    );
};
