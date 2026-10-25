'use strict';

const { SpeechBroker, configuration } = require('../../bts/speech/broker');
const { prepare } = require('../../bts/speech/text');
const { fixture } = require('./fixture');

process.on('disconnect', () => process.exit(0));
process.once('message', async options => {
	try {
		const config = configuration({ enabled: true, api_key: options.key, url: options.url, cache_enabled: true,
			cache_dir: options.directory, submit_interval_ms: 50, poll_interval_ms: 100 }, {});
		const broker = new SpeechBroker(config);
		await broker.disk.ready; await broker.refresh();
		const data = fixture(373), tournament = { ...data.tournaments[0], locations: data.locations, courts: data.courts,
			normalizations: [], speech: { context_version: broker.context_version } };
		const parts = prepare(tournament, data.matches.slice(0, 26), 'de');
		const writes = [], write = broker.disk.store.bind(broker.disk);
		broker.disk.store = async (...args) => {
			const began = process.hrtime.bigint();
			try { return await write(...args); }
			finally { writes.push({ elapsed_ms: Number(process.hrtime.bigint() - began) / 1e6, completed_at: Date.now() }); }
		};
		process.send({ type: 'ready', parts: parts.length, context_version: broker.context_version });
		process.on('message', async message => {
			if (message.type === 'start') {
				for (let i = 0; i < parts.length; i += 64) broker.prepare(parts.slice(i, i + 64), { voice: 'hallensprecher', priority: 'low' }, 'default');
				broker.start();
			} else if (message.type === 'finish') {
				broker.stop(); await broker.disk.writes;
				process.send({ type: 'done', result: { cache_store_ms: writes, completed: [...broker.entries.values()].filter(e => e.status === 'completed').length,
					failed: [...broker.entries.values()].filter(e => e.status === 'failed').length, preparing: [...broker.entries.values()].filter(e => ['processing', 'unsubmitted', 'queued'].includes(e.status)).length } });
			} else if (message.type === 'stop') { broker.stop(); process.exit(0); }
		});
	} catch (error) { process.send({ type: 'error', message: error.stack }); }
});
