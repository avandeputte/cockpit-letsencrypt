# Development

This project is based on the Cockpit
[starter-kit](https://github.com/cockpit-project/starter-kit) and follows the
[Cockpit developer guide](https://docs.cockpit-project.org/cockpit-guide/latest/guide/development.html):
React and [PatternFly](https://www.patternfly.org/), built with esbuild, with
Cockpit's shared components from `pkg/lib`.

## Source layout

| File | Purpose |
| --- | --- |
| `src/manifest.json` | registers the page under *Tools* |
| `src/index.html`, `src/index.tsx` | page entry point |
| `src/app.tsx` | the page: certificate list, web console certificate card, credentials list, and the actions that run certbot |
| `src/RequestDialog.tsx` | the *Request certificate* dialog |
| `src/CredentialsDialog.tsx` | the *Add/Edit DNS credentials* dialog |
| `src/CommandDialog.tsx` | runs a command and shows its output live |
| `src/ConfirmDialog.tsx` | confirmation and *Delete certificate* dialogs |
| `src/backend.ts` | everything that touches the system, through `cockpit.spawn`, `cockpit.script` and `cockpit.file` |
| `src/certbot.ts` | pure functions: certbot output parsers, command line builders, constants and paths |
| `src/providers.ts` | DNS providers, their plugins, packages and credential fields |
| `src/deploy-hook.sh` | the certbot deploy hook that copies a renewed certificate to Cockpit |
| `src/install-plugin.sh` | installs a certbot plugin the way certbot itself was installed |
| `test/unit/` | unit tests for `certbot.ts` (Node's test runner) |
| `test/check-application` | Cockpit integration test for the cockpit test VMs |
| `packaging/` | RPM spec, Debian packaging, Arch PKGBUILD |
| `.github/workflows/packages.yml` | CI: lint, unit tests, RPM and DEB builds, releases |

The two shell scripts are bundled into the JavaScript as text, through
esbuild's `text` loader for `.sh` files, and run with `cockpit.script` or
`cockpit.spawn` as root.

## Building

You need Node.js 20 or later, `make` and `git`.

```sh
make                 # fetch pkg/lib from cockpit, npm install, build into dist/
make watch           # rebuild on every change
```

The first `make` checks out the pinned commit of Cockpit's `pkg/lib`
(`COCKPIT_REPO_COMMIT` in the `Makefile`) into `pkg/lib`.

## Trying it in a local Cockpit

```sh
make devel-install   # symlink dist/ to ~/.local/share/cockpit/letsencrypt
```

Log in to Cockpit on the same machine as the same user. The page uses
your build directly, so after each rebuild a reload is enough.
`make devel-uninstall` removes the link.

To install system-wide from source:

```sh
make
sudo make install    # installs to /usr/local/share/cockpit/letsencrypt
```

## Checks and tests

```sh
npm run eslint       # ESLint (cockpit's configuration)
npm run stylelint    # stylelint for the SCSS
npm run typecheck    # tsc --noEmit
npm test             # unit tests
```

The unit tests (`test/unit/test-*.ts`) cover the certbot output parsers (old
and new `certbot certificates` formats, `certbot plugins`, renewal
configuration), the credentials file format, domain validation and the
`certonly` command lines. `test/unit/run.js` bundles each test with esbuild,
replacing the `cockpit` module with a small stub, and runs it with
`node --test`.

`test/check-application` is an integration test for the
[cockpit test VMs](https://github.com/cockpit-project/bots): `make check`
builds a VM image with the RPM installed and runs it. It needs KVM.

## Packaging

```sh
make rpm             # RPM for Fedora/RHEL, in the current directory
make deb             # DEB for Debian/Ubuntu, needs debhelper and build-essential
make dist            # source tarball
```

The version comes from `git describe --tags`, or from `VERSION=` on the
command line (`make deb VERSION=1.2.3`).

* The **RPM** (`packaging/cockpit-letsencrypt.spec.in`) is `noarch`, requires
  `cockpit-bridge` and `certbot`, and recommends `cockpit-packagekit`, which
  the page uses to offer installing certbot.
* The **DEB** (`packaging/debian/`) is `Architecture: all` and depends on
  `cockpit-bridge` and `certbot`.
* `packaging/arch/PKGBUILD.in` is a PKGBUILD for Arch Linux.

## Continuous integration and releases

The `packages` workflow runs on every push and pull request:

1. **check**: ESLint, stylelint, type check and unit tests.
2. **rpm**: builds the RPM in a `fedora:latest` container.
3. **deb**: builds the DEB in a `debian:trixie` container.
4. **release**: only for version tags. It attaches the RPM, the DEB and the
   source tarball to the GitHub release for that tag, and creates the release
   if needed.

To release a new version, push a version tag:

```sh
git checkout main && git pull
git tag -a 0.2.0 -m "cockpit-letsencrypt 0.2.0"
git push origin 0.2.0
```

or run the workflow by hand on `main` (*Actions → packages → Run workflow*)
and enter the new version under **release**. The workflow builds the packages
as that version, creates the tag on the commit it built, and publishes the
release on the [releases page](https://github.com/avandeputte/cockpit-letsencrypt/releases)
with generated release notes.

To rebuild the packages of an existing release, for example after a CI fix,
run the workflow by hand (*Actions → packages → Run workflow*) and enter the
tag under **tag**. It checks out the tag, rebuilds, and replaces that release's assets.

## Screenshots

The screenshots in `doc/screenshots/` were taken with Playwright from a
Cockpit test machine, using sample certificates for example domains. When the
UI changes, retake them at 1400×940 so they keep a consistent size.
