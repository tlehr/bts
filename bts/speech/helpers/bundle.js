'use strict';

const fs = require('fs/promises'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const TABLE = Array.from({ length: 256 }, (_, i) => {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
    return value >>> 0;
});
function crc32(data) { let value = 0xffffffff; for (const byte of data) value = TABLE[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }
// Small source/configuration download; model/runtime bytes never cross IPC.
function zip(files) {
    const entries = [], directory = []; let offset = 0;
    for (const [filename, content] of Object.entries(files)) {
        const name = Buffer.from(filename), bytes = Buffer.from(content), crc = crc32(bytes);
        const compressed = zlib.deflateRawSync(bytes), packed = compressed.length < bytes.length ? compressed : bytes;
        const method = packed === compressed ? 8 : 0;
        const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
        local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
        central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(bytes.length, 24);
        central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
        entries.push(local, name, packed); directory.push(central, name); offset += local.length + name.length + packed.length;
    }
    const central = Buffer.concat(directory), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length / 2, 8); end.writeUInt16LE(directory.length / 2, 10);
    end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...entries, central, end]);
}
async function bundle(pool, endpoint, certificate_sha256, platform = 'windows') {
    if (!['windows', 'linux', 'zip'].includes(platform)) throw new Error('helper_platform_invalid');
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        ['localhost', '[::1]', '0.0.0.0', '[::]'].includes(url.hostname) || /^127\./.test(url.hostname)) throw new Error('helper_address_not_reachable');
    if (url.protocol === 'https:' && !/^[a-f0-9]{64}$/.test(certificate_sha256 || '')) throw new Error('helper_certificate_missing');
    const pairing = await pool.pair();
    const root = path.resolve(__dirname, '../../../static/speech-helper');
    const config = { protocol: 1, endpoint: url.origin, certificate_sha256: certificate_sha256 || null,
        bootstrap: pairing.key, runtime: pairing.runtime, threads: 2 };
    if (platform === 'linux') {
        const source = (await fs.readFile(path.join(root, 'Linux.py'))).toString('base64');
        // Read personal configuration from this file, never from process argv.
        const loader = 'import base64,json,pathlib,sys; p=pathlib.Path(sys.argv[1]); s,c=p.read_text().rsplit("\\n__BTS_PAYLOAD__\\n",1)[1].splitlines(); exec(compile(base64.b64decode(s),str(p),"exec"),{"__name__":"__main__","BTS_BUNDLE_CONFIG":json.loads(base64.b64decode(c))})';
        const script = '#!/bin/sh\n# Persoenlicher BTS-Sprachhelfer. Start: bash BTS-Sprachhelfer-Linux.sh\n' +
            'if ! command -v python3 >/dev/null 2>&1; then\n  echo "Python 3.8+ fehlt. Bitte mit Ihrem Paketmanager installieren (Ubuntu: sudo apt install python3)." >&2\n  exit 1\nfi\n' +
            'exec python3 -c \'' + loader + '\' "$0" "$@"\nexit 1\n__BTS_PAYLOAD__\n' + source + '\n' + Buffer.from(JSON.stringify(config)).toString('base64') + '\n';
        return { filename: 'BTS-Sprachhelfer-Linux.sh', content_base64: Buffer.from(script).toString('base64'), mime_type: 'text/x-shellscript', expires: pairing.expires };
    }
    const files = {};
    for (const name of ['Start.ps1', 'Window.ps1', 'Worker.ps1', 'Plan.ps1', 'Runtime.cs', 'README.txt', 'RUECKNAHME.txt']) files[name] = await fs.readFile(path.join(root, name));
    files['helper.json'] = JSON.stringify(config, null, 2);
    if (platform === 'zip') {
        return { filename: 'BTS-Sprachhelfer-Windows.zip', zip_base64: zip({ 'Start.cmd': await fs.readFile(path.join(root, 'Start.cmd')), ...files }).toString('base64'), expires: pairing.expires };
    }
    const stub = await fs.readFile(path.join(root, 'windows-launcher.bin'));
    if (stub.toString('ascii', 0, 2) !== 'MZ') throw new Error('helper_launcher_invalid');
    const payload = zip(files), trailer = Buffer.alloc(56);
    trailer.writeBigInt64LE(BigInt(payload.length)); crypto.createHash('sha256').update(payload).digest().copy(trailer, 8);
    trailer.write('BTSHELPER-EXE-1!', 40, 'ascii');
    // Keep the payload trailer aligned before a future Authenticode table.
    // Signing must happen AFTER personalization; no payload belongs inside the
    // certificate table or may be appended after a signature is issued.
    const padding = Buffer.alloc((8 - (stub.length + payload.length + trailer.length) % 8) % 8);
    return { filename: 'BTS-Sprachhelfer-Windows.exe', content_base64: Buffer.concat([stub, padding, payload, trailer]).toString('base64'), mime_type: 'application/vnd.microsoft.portable-executable', expires: pairing.expires };
}
module.exports = { bundle, zip, crc32 };
