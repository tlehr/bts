'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const root = path.resolve(process.env.BTS_TESTCLIENT_DIR || path.join(__dirname, '../../bts-testclient'));

function module_path(name) {
	if (!/^[a-z_]+(?:\/[a-z_]+)*$/.test(name)) throw new Error('Invalid testclient module');
	const filename = path.join(root, 'src', name + '.js');
	if (!fs.existsSync(filename)) throw new Error('Testclient fehlt unter ' + root + '. Eigenes Repository bts-testclient installieren oder BTS_TESTCLIENT_DIR setzen.');
	return filename;
}

function load(name) {
	process.env.BTS_REPOSITORY_DIR ||= path.resolve(__dirname, '..');
	return require(module_path(name));
}

function execute(name) {
	let child;
	try { child = spawn(process.execPath, [module_path(name), ...process.argv.slice(2)], {
		cwd: root, env: { ...process.env, BTS_REPOSITORY_DIR: path.resolve(__dirname, '..') }, stdio: 'inherit',
	}); } catch (error) { console.error(error.message); process.exitCode = 1; return; }
	const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
	process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
	child.on('error', error => { console.error(error.message); process.exitCode = 1; });
	child.on('close', (code, signal) => {
		process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
		process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
	});
}

module.exports = { module_path, load, execute };
