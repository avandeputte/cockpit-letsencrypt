#!/usr/bin/env node
// Bundle the unit tests with esbuild (stubbing out cockpit.js) and run them with node:test

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import esbuild from 'esbuild';

const here = path.dirname(new URL(import.meta.url).pathname);
const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'letsencrypt-tests-'));
const tests = fs.readdirSync(here).filter(f => /^test-.*\.ts$/.test(f));

await esbuild.build({
    entryPoints: tests.map(t => path.join(here, t)),
    bundle: true,
    platform: 'node',
    format: 'esm',
    outdir,
    outExtension: { '.js': '.mjs' },
    alias: { cockpit: path.join(here, 'cockpit-stub.ts') },
    loader: { '.sh': 'text' },
    logLevel: 'warning',
});

const files = fs.readdirSync(outdir).map(f => path.join(outdir, f));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
fs.rmSync(outdir, { recursive: true, force: true });
process.exit(result.status ?? 1);
