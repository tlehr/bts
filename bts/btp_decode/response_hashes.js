'use strict';

// Fingerprints of the decoded wire packet, before local planning annotations.
// Keep them outside the response so protocol data and JSON remain unchanged.
const captured = new WeakMap();

function remember(response, hashes) {
	if (!response || typeof response !== 'object' || typeof hashes?.json !== 'string' || !/^[a-f0-9]{40}$/.test(hashes.sha1) || !/^[a-f0-9]{64}$/.test(hashes.sha256)) return;
	captured.set(response, { sha1: hashes.sha1, sha256: hashes.sha256, json: hashes.json });
}

module.exports = { remember, get: response => captured.get(response) };
