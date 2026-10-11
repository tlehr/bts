'use strict';

const { create_server } = require('./web_dashboard/server');

async function main(argv) {
	let port = 4444;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--port') port = Number(argv[++i]);
		else if (['--help', '-h'].includes(argv[i])) { console.log('BTS-Testdashboard: npm run debug:dashboard -- [--port 4444]'); return; }
		else throw new Error('Unbekannte Option: ' + argv[i]);
	}
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Der Port muss zwischen 1 und 65535 liegen.');
	const app = create_server();
	await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, '127.0.0.1', resolve); });
	console.log('BTS-Testdashboard: http://127.0.0.1:' + port);
	console.log('Im Browser öffnen. Der Test startet erst mit „Test starten“. Beenden mit Strg+C.');
	let closing = false;
	const close = async () => { if (closing) return; closing = true; await app.close(); };
	process.on('SIGINT', close); process.on('SIGTERM', close);
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error('BTS-Testdashboard:', error.message); process.exitCode = 1; });
module.exports = { main };
