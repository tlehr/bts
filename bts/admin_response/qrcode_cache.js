'use strict';

// QR bytes depend on the URL alone. Share concurrent generation, retry failures
// and bound retained URLs so editing a tournament immediately uses new bytes.
function create(render = (url, done) => require('qrcode').toDataURL(url, done), limit = 16) {
	const entries = new Map();
	return url => {
		if (entries.has(url)) return entries.get(url);
		const result = new Promise((resolve, reject) => render(url, (error, bytes) => error ? reject(error) : resolve(bytes)));
		entries.set(url, result);
		if (entries.size > limit) entries.delete(entries.keys().next().value);
		result.catch(() => { if (entries.get(url) === result) entries.delete(url); });
		return result;
	};
}

module.exports = create();
module.exports.create = create;
