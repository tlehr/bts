'use strict';

require('../offload/worker')(message => {
	const encoded = Uint8Array.from(Buffer.from(JSON.stringify(message), 'utf8'));
	return { value: encoded.buffer, transfers: [encoded.buffer] };
});
