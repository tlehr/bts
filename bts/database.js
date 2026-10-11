'use strict';

const fs = require('fs');
const path = require('path');
const {promisify} = require('util');

const async = require('async');
const Datastore = require('nedb');

const tabletoperator_audit = require('./tabletoperator_audit');
const utils = require('./utils');
const tournament_model = require('./tournament_model');
const schedule_compaction = require('./database_compaction');
const database_tasks = require('./database_tasks');

const TABLES = [
	'courts',
	'locations',
	'event',
	'matches',
	'tournaments',
	'umpires',
	'logs',
	'tabletoperators',
	'displaysettings',
	'display_court_displaysettings',
	'normalizations',
	'advertisements',
	'app_settings'
];

const DB_LOCK_FILE = '.bts-db.lock';

function is_process_running(pid) {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err && err.code === 'EPERM';
	}
}

function read_lock_owner(lock_file) {
	try {
		return JSON.parse(fs.readFileSync(lock_file, 'utf8'));
	} catch (err) {
		return null;
	}
}

function acquire_database_lock(db_dir) {
	const lock_file = path.join(db_dir, DB_LOCK_FILE);
	const write_lock = () => {
		const fd = fs.openSync(lock_file, 'wx');
		const owner = {
			pid: process.pid,
			started_at: new Date().toISOString(),
			cwd: process.cwd(),
		};
		fs.writeFileSync(fd, JSON.stringify(owner, null, 2));
		fs.closeSync(fd);
		let released = false;
		const release = () => {
			if (released) {
				return;
			}
			released = true;
			try {
				const current_owner = read_lock_owner(lock_file);
				if (current_owner && current_owner.pid === process.pid) {
					fs.unlinkSync(lock_file);
				}
			} catch (err) {
				// Ignore cleanup errors during process shutdown.
			}
		};
		process.once('exit', release);
		return release;
	};

	try {
		return write_lock();
	} catch (err) {
		if (!err || err.code !== 'EEXIST') {
			throw err;
		}
		const owner = read_lock_owner(lock_file);
		if (owner && is_process_running(Number(owner.pid))) {
			throw new Error(
				'BTS database is already open by process ' + owner.pid +
				' (' + lock_file + '). Stop the other BTS process before starting another one.'
			);
		}
		fs.unlinkSync(lock_file);
		return write_lock();
	}
}


async function init_test() {
	const db = {}
	for (const key of TABLES) {
		db[key] = new Datastore({ inMemoryOnly: true });
	}
	await promisify(prepare)(db);
	return db;
}

function init(callback) {
	const db = {};

	const db_dir = path.join(utils.root_dir(), '/data');
	if (! fs.existsSync(db_dir)) {
		fs.mkdirSync(db_dir);
	}
	const release_database_lock = acquire_database_lock(db_dir);

	const macos_noindex_file = path.join(db_dir, '.metadata_never_index');
	const macos_noindex_fd = fs.openSync(macos_noindex_file, 'a');
	fs.closeSync(macos_noindex_fd);

	const logos_dir = path.join(db_dir, 'logos');
	if (! fs.existsSync(logos_dir)) {
		fs.mkdirSync(logos_dir);
	}

	TABLES.forEach(function(key) {
		var d = new Datastore({ filename: path.join(db_dir, key) });
		require('./compaction_worker').attach(d, key, { identity_serialization: true });
		{
			const timing_enabled = () => require('./server_diagnostics').enabled() ||
				process.env.BTS_BTP_SYNC_TIMING === '1' || require('./debug_flags').any_score_press_timing_enabled();
			const persist_cached = d.persistence.persistCachedDatabase;
			d.persistence.persistCachedDatabase = function(callback) {
				if (!timing_enabled()) return persist_cached.call(this, callback);
				const started = process.hrtime.bigint();
				console.warn('[bts] database:compaction_start ' + JSON.stringify({ collection: key, ts: Date.now() }));
				return persist_cached.call(this, err => {
					if (timing_enabled()) console.warn('[bts] database:compaction_done ' + JSON.stringify({
						collection: key, ts: Date.now(),
						duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
						error: err ? err.message : null,
					}));
					if (callback) callback(err);
				});
			};
		}
		db[key] = d;
		if (key === 'tabletoperators' && tabletoperator_audit.enabled()) {
			const exists = fs.existsSync(d.filename);
			console.warn('[bts] tabletoperator_audit:datafile_before_load', {
				filename: d.filename,
				exists,
				size: exists ? fs.statSync(d.filename).size : 0,
			});
		}
	});

	async.parallel(TABLES.map(function(key) {
		return function(cb) {
			db[key].loadDatabase(cb);
		};
	}), function(err) {
		if (err) {
			release_database_lock();
			return callback(err);
		}
		db.release_database_lock = release_database_lock;
		prepare(db, (prepare_error, prepared_db) => {
			if (prepare_error) {
				release_database_lock();
				return callback(prepare_error);
			}
			db.compaction = schedule_compaction(db, TABLES);
			callback(null, prepared_db);
		});
	});
}

function prepare(db, callback) {
	db.courts.ensureIndex({fieldName: 'tournament_key', unique: false});
	db.locations.ensureIndex({fieldName: 'tournament_key', unique: false});
	db.locations.ensureIndex({fieldName: 'location_id', unique: false});
	db.matches.ensureIndex({fieldName: 'court_id', unique: false});
	db.matches.ensureIndex({fieldName: 'tournament_key', unique: false});
	db.matches.ensureIndex({fieldName: 'event_key', unique: false});
	db.tournaments.ensureIndex({fieldName: 'key', unique: true});
	db.app_settings.ensureIndex({fieldName: '_id', unique: true});
	db.umpires.ensureIndex({fieldName: 'name', unique: true});
	db.umpires.ensureIndex({fieldName: 'tournament_key', unique: false});
	db.logs.ensureIndex({ fieldName: 'tournament_key', unique: false });

	setup_helpers(db);

	async.parallel([function(cb) {
		setup_autonum(cb, db, 'matches');
	}, function(cb) {
		setup_autonum(cb, db, 'tournaments');
	}], function(err) {
		callback(err, db);
	});
}

function setup_helpers(db) {
	for (const key of TABLES) if (db[key]?.executor) database_tasks.attach(db[key], key);
	for (const single_database of Object.values(db)) {
		if (!single_database || typeof single_database.find !== 'function') {
			continue;
		}
		single_database.find_async = promisify(single_database.find);
		single_database.findOne_async = promisify(single_database.findOne);
		single_database.remove_async = promisify(single_database.remove);
		single_database.update_async = (...args) => {
			return new Promise((resolve, reject) => {
				single_database.update(...args, (err, ...results) => {
					if (err) return reject(err);
					return resolve(results);
				});
			});
		};
	}
	db.fetch_all = function() {
		var args = [db];
		for (var i = 0;i < arguments.length;i++) {
			args.push(arguments[i]);
		}
		return fetch_all.apply(null, args);
	};
	tabletoperator_audit.wrap_datastore(db.tabletoperators);
	tournament_model.attach(db);
	for (const key of TABLES) require('./btp_planner/batch_writes').certify(db[key]);
	if (tabletoperator_audit.enabled()) {
		db.tabletoperators.count({}, (err, count) => {
			if (err) {
				console.warn('[bts] tabletoperator_audit:loaded_count_failed', err && (err.stack || err.message || String(err)));
				return;
			}
			console.warn('[bts] tabletoperator_audit:loaded_count', { count });
		});
	}
}

function fetch_all(db, specs, callback) {
	var results = {};
	var done = false;

	specs.forEach(function(spec, index) {
		var queryFunc = spec.queryFunc || 'find';
		if (queryFunc === '_findOne') {
			queryFunc = 'findOne';
		}

		const col = db[spec.collection];
		if (!col && !done) {
			done = true;
			return callback(new Error('Cannot find collection ' + spec.collection));
		}
		col[queryFunc](spec.query, function (err, docs) {
			if (done) {
				return;  // Error occured already
			}
			if (err) {
				done = true;
				return callback(err, null);
			}

			if ((spec.queryFunc == '_findOne') && !docs) {
				done = true;
				return callback(new Error('Cannot find one of ' + spec.collection));
			}

			results['r' + index] = docs;
			if (utils.size(results) == specs.length) {
				done = true;
				var args = [null];
				specs.forEach(function(spec, index) {
					args.push(results['r' + index]);
				});
				return callback.apply(null, args);
			}
		});
	});
}

function setup_autonum(callback, db, collection, start) {
	var idx = (start === undefined) ? 0 : start;
	db[collection].autonum = function() {
		idx++;
		return '' + idx;
	};

	db[collection].find({}, function(err, docs) {
		if (err) {
			callback(err);
		}

		docs.forEach(function(doc) {
			idx = Math.max(idx, doc._id);
		});

		return callback();
	});
}

module.exports = {
	init,
	init_test,
	setup_helpers,
};
