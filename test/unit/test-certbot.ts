import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    certificateStatus, certonlyArgs, coversHost, credentialsFileContent, defaultCertName, dnsPlugins,
    formatIni, isValidCertName, isValidDomain, parseCertificates, parseCockpitWsConf, parseEnsureCheck,
    parseIni, parsePlugins, parseRenewalConfs, slugify, splitDomains, cockpitWsConf,
} from '../../src/certbot';
import { findProvider, genericProvider } from '../../src/providers';

// certbot 5.x output (captured from a real run)
const CERTIFICATES_NEW = `Saving debug log to /var/log/letsencrypt/letsencrypt.log

- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
Found the following certs:
  Certificate Name: example.org
    Serial Number: 608806c5dbf1d2cb6e1793457248772f7a28a99b
    Key Type: ECDSA
    Identifiers: example.org *.example.org
    Expiry Date: 2026-12-27 17:45:19+00:00 (INVALID: TEST_CERT)
    Certificate Path: /etc/letsencrypt/live/example.org/fullchain.pem
    Private Key Path: /etc/letsencrypt/live/example.org/privkey.pem
  Certificate Name: cockpit.home.example.net
    Serial Number: 3abc
    Key Type: RSA
    Identifiers: cockpit.home.example.net
    Expiry Date: 2027-01-20 08:00:00+00:00 (VALID: 84 days)
    Certificate Path: /etc/letsencrypt/live/cockpit.home.example.net/fullchain.pem
    Private Key Path: /etc/letsencrypt/live/cockpit.home.example.net/privkey.pem
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
`;

// certbot 1.x/2.x output uses "Domains:"
const CERTIFICATES_OLD = `Found the following certs:
  Certificate Name: old.example.com
    Serial Number: 1
    Key Type: RSA
    Domains: old.example.com www.old.example.com
    Expiry Date: 2020-01-01 00:00:00+00:00 (INVALID: EXPIRED)
    Certificate Path: /etc/letsencrypt/live/old.example.com/fullchain.pem
    Private Key Path: /etc/letsencrypt/live/old.example.com/privkey.pem
`;

test('parseCertificates (Identifiers)', () => {
    const certs = parseCertificates(CERTIFICATES_NEW);
    assert.equal(certs.length, 2);
    assert.equal(certs[0].name, 'example.org');
    assert.deepEqual(certs[0].domains, ['example.org', '*.example.org']);
    assert.equal(certs[0].keyType, 'ECDSA');
    assert.equal(certs[0].expiry?.toISOString(), '2026-12-27T17:45:19.000Z');
    assert.equal(certs[0].validity, 'INVALID: TEST_CERT');
    assert.equal(certs[1].certPath, '/etc/letsencrypt/live/cockpit.home.example.net/fullchain.pem');
    assert.equal(certs[1].keyPath, '/etc/letsencrypt/live/cockpit.home.example.net/privkey.pem');
});

test('parseCertificates (Domains) and no certificates', () => {
    const certs = parseCertificates(CERTIFICATES_OLD);
    assert.deepEqual(certs[0].domains, ['old.example.com', 'www.old.example.com']);
    assert.deepEqual(parseCertificates('Saving debug log\nNo certificates found.\n'), []);
});

test('certificateStatus', () => {
    const now = new Date('2026-10-28T00:00:00Z');
    const [test, valid] = parseCertificates(CERTIFICATES_NEW);
    assert.equal(certificateStatus(test, now), 'test');
    assert.equal(certificateStatus(valid, now), 'valid');
    assert.equal(certificateStatus(valid, new Date('2027-01-10T00:00:00Z')), 'expiring');
    assert.equal(certificateStatus(valid, new Date('2027-02-01T00:00:00Z')), 'expired');
    assert.equal(certificateStatus(parseCertificates(CERTIFICATES_OLD)[0], now), 'expired');
});

test('parseRenewalConfs', () => {
    const confs = parseRenewalConfs(`==> example.org.conf <==
# renew_before_expiry = 30 days
version = 5.8.0
cert = /etc/letsencrypt/live/example.org/cert.pem

[renewalparams]
authenticator = dns-cloudflare
dns_cloudflare_credentials = /etc/letsencrypt/cockpit/credentials/cloudflare-home.ini
server = https://acme-staging-v02.api.letsencrypt.org/directory

==> other.conf <==
[renewalparams]
authenticator = standalone
`);
    assert.deepEqual(Object.keys(confs), ['example.org', 'other']);
    assert.equal(confs['example.org'].authenticator, 'dns-cloudflare');
    assert.equal(confs['example.org'].dns_cloudflare_credentials, '/etc/letsencrypt/cockpit/credentials/cloudflare-home.ini');
    assert.equal(confs.other.authenticator, 'standalone');
    assert.equal(confs['example.org']['renew_before_expiry'], undefined);
});

test('parsePlugins', () => {
    // certbot 5.x output (captured from a real run), wrapped descriptions
    const plugins = parsePlugins(`Saving debug log to /var/log/letsencrypt/letsencrypt.log

- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
* dns-cloudflare
Description: Obtain certificates using a DNS TXT record (if you are using
Cloudflare for DNS).
Interfaces: Authenticator, Plugin
Entry point: EntryPoint(name='dns-cloudflare',
value='certbot_dns_cloudflare._internal.dns_cloudflare:Authenticator',
group='certbot.plugins')

* standalone
Description: Runs an HTTP server locally which serves the necessary validation
files under the /.well-known/acme-challenge/ request path. Suitable if there is
no HTTP server already running. HTTP challenge only (wildcards not supported).
Interfaces: Authenticator, Plugin
Entry point: EntryPoint(name='standalone',
value='certbot._internal.plugins.standalone:Authenticator',
group='certbot.plugins')
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
`);
    assert.deepEqual(plugins.map(p => p.name), ['dns-cloudflare', 'standalone']);
    assert.equal(plugins[0].description, 'Obtain certificates using a DNS TXT record (if you are using Cloudflare for DNS).');
    assert.deepEqual(plugins[0].interfaces, ['Authenticator', 'Plugin']);
    assert.deepEqual(dnsPlugins(plugins).map(p => p.name), ['dns-cloudflare']);
});

test('INI helpers', () => {
    assert.deepEqual(parseIni('# comment\na = 1\n b= two words \n[section]\n'), { a: '1', b: 'two words' });
    assert.equal(formatIni({ a: '1', empty: '', b: 'x\ny' }), 'a = 1\nb = x y\n');
});

test('credentialsFileContent', () => {
    assert.equal(credentialsFileContent(findProvider('dns-cloudflare'), { dns_cloudflare_api_token: ' tok ' }),
                 'dns_cloudflare_api_token = tok\n');
    assert.equal(credentialsFileContent(findProvider('dns-google'), { json: '{"a":1}\n\n' }), '{"a":1}\n');
    assert.equal(credentialsFileContent(genericProvider('dns-foo'), { ini: 'dns_foo_key = 1' }), 'dns_foo_key = 1\n');
});

test('domain validation', () => {
    assert.ok(isValidDomain('example.com'));
    assert.ok(isValidDomain('*.home.example.com'));
    assert.ok(isValidDomain('xn--bcher-kva.example'));
    assert.ok(!isValidDomain('localhost'));
    assert.ok(!isValidDomain('192.168.1.1'));
    assert.ok(!isValidDomain('foo.*.example.com'));
    assert.ok(!isValidDomain('-bad.example.com'));
    assert.deepEqual(splitDomains('Example.com, *.example.com  example.com\nwww.example.com'),
                     ['example.com', '*.example.com', 'www.example.com']);
    assert.equal(defaultCertName(['*.example.com', 'example.com']), 'example.com');
    assert.ok(isValidCertName('example.com-0001'));
    assert.ok(!isValidCertName('../etc'));
    assert.ok(!isValidCertName('a/b'));
    assert.equal(slugify('Cloudflare: Home zone!'), 'cloudflare-home-zone');
});

test('certonlyArgs: DNS', () => {
    const args = certonlyArgs({
        certName: 'example.com',
        domains: ['example.com', '*.example.com'],
        email: 'me@example.com',
        challenge: {
            type: 'dns',
            provider: findProvider('dns-cloudflare'),
            credentials: '/etc/letsencrypt/cockpit/credentials/cf.ini',
            propagationSeconds: 30,
        },
        keyType: 'ecdsa',
        staging: true,
    });
    assert.deepEqual(args, [
        'certbot', 'certonly', '--non-interactive', '--agree-tos',
        '--email', 'me@example.com', '--no-eff-email',
        '--cert-name', 'example.com', '--key-type', 'ecdsa',
        '--domain', 'example.com', '--domain', '*.example.com',
        '--authenticator', 'dns-cloudflare',
        '--dns-cloudflare-credentials', '/etc/letsencrypt/cockpit/credentials/cf.ini',
        '--dns-cloudflare-propagation-seconds', '30',
        '--test-cert',
    ]);
});

test('certonlyArgs: HTTP and route53', () => {
    const base = { certName: 'h', domains: ['h.example.com'], email: '', keyType: 'rsa' as const, staging: false };
    assert.deepEqual(certonlyArgs({ ...base, challenge: { type: 'standalone', port: 8080 } }).slice(4),
                     ['--register-unsafely-without-email', '--cert-name', 'h', '--key-type', 'rsa',
                         '--domain', 'h.example.com', '--standalone', '--http-01-port', '8080']);
    assert.deepEqual(certonlyArgs({ ...base, challenge: { type: 'webroot', path: '/var/www/html' } }).slice(-3),
                     ['--webroot', '--webroot-path', '/var/www/html']);
    // route53 has neither a credentials file nor a propagation option
    assert.deepEqual(certonlyArgs({
        ...base, challenge: { type: 'dns', provider: findProvider('dns-route53'), credentials: '/x', propagationSeconds: 10 }
    }).slice(-2), ['--authenticator', 'dns-route53']);
});

test('cockpit-certificate-ensure and ws conf', () => {
    assert.equal(parseEnsureCheck('Would use certificate /etc/cockpit/ws-certs.d/90-letsencrypt.cert\n'),
                 '/etc/cockpit/ws-certs.d/90-letsencrypt.cert');
    assert.equal(parseEnsureCheck('Would create a self-signed certificate\n'), null);
    assert.equal(parseCockpitWsConf(cockpitWsConf('cockpit.example.com')), 'cockpit.example.com');
    assert.equal(parseCockpitWsConf(null), null);
});

test('coversHost', () => {
    assert.ok(coversHost(['example.com', '*.example.com'], 'cockpit.example.com'));
    assert.ok(coversHost(['Cockpit.Example.com'], 'cockpit.example.com.'));
    assert.ok(!coversHost(['*.example.com'], 'a.b.example.com'));
    assert.ok(!coversHost(['*.example.com'], 'example.com'));
    assert.ok(!coversHost(['example.com'], '192.168.1.10'));
});
