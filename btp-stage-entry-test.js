#!/usr/bin/env node
'use strict';

/* eslint-disable no-console */

const argparse = require('argparse');
const {promisify} = require('util');

const btp_conn = require('./bts/btp_conn');
const btp_proto = require('./bts/btp_proto');
const database = require('./bts/database');

function first(value) {
	return Array.isArray(value) ? value[0] : value;
}

function player_name(player) {
	if (!player) return '<unknown player>';
	const firstname = first(player.Firstname) || '';
	const lastname = first(player.Lastname) || '';
	return `${firstname} ${lastname}`.trim() || `<player ${first(player.ID)}>`;
}

function stage_label(stage) {
	if (!stage) return '<unknown stage>';
	return `${first(stage.Name)} (${first(stage.ID)}, type ${first(stage.StageType)})`;
}

function normalize_stage_entry(stage_entry) {
	const update = {
		ID: first(stage_entry.ID),
		StageID: first(stage_entry.StageID),
		EntryID: first(stage_entry.EntryID),
	};
	if (stage_entry.Status) update.Status = first(stage_entry.Status);
	if (stage_entry.Seed1) update.Seed1 = first(stage_entry.Seed1);
	if (stage_entry.Seed2) update.Seed2 = first(stage_entry.Seed2);
	return update;
}

function get_tournament(response) {
	return response?.Result?.[0]?.Tournament?.[0];
}

function build_indexes(tournament) {
	const stages = new Map((tournament.Stages?.[0]?.Stage || []).map(stage => [first(stage.ID), stage]));
	const entries = new Map((tournament.Entries?.[0]?.Entry || []).map(entry => [first(entry.ID), entry]));
	const players = new Map((tournament.Players?.[0]?.Player || []).map(player => [first(player.ID), player]));
	const stage_entries = (tournament.StageEntries?.[0]?.StageEntry || []);
	return {stages, entries, players, stage_entries};
}

function describe_stage_entry(stage_entry, indexes) {
	const stage = indexes.stages.get(first(stage_entry.StageID));
	const entry = indexes.entries.get(first(stage_entry.EntryID));
	const player1 = entry ? indexes.players.get(first(entry.Player1ID)) : null;
	const player2 = entry && entry.Player2ID ? indexes.players.get(first(entry.Player2ID)) : null;
	const players = [player_name(player1)];
	if (player2) players.push(player_name(player2));
	return {
		stage_entry_id: first(stage_entry.ID),
		entry_id: first(stage_entry.EntryID),
		stage_id: first(stage_entry.StageID),
		stage: stage_label(stage),
		status: stage_entry.Status ? first(stage_entry.Status) : null,
		players: players.join(' / '),
	};
}

function find_auto_candidate(indexes) {
	for (const stage_entry of indexes.stage_entries) {
		const current_stage = indexes.stages.get(first(stage_entry.StageID));
		if (!current_stage || first(current_stage.StageType) !== 9999) {
			continue;
		}
		const event_id = first(current_stage.EventID);
		const reserve_stage = Array.from(indexes.stages.values()).find(stage => (
			first(stage.EventID) === event_id &&
			first(stage.StageType) === 9998
		));
		if (!reserve_stage) {
			continue;
		}
		return {
			stage_entry,
			target_stage: reserve_stage,
			reason: 'first excluded entry with reserve stage in the same event',
		};
	}
	return null;
}

function find_explicit_candidate(indexes, args) {
	const stage_entry_id = args.stage_entry_id != null ? Number(args.stage_entry_id) : null;
	const entry_id = args.entry_id != null ? Number(args.entry_id) : null;
	const target_stage_id = args.target_stage_id != null ? Number(args.target_stage_id) : null;

	if (target_stage_id == null && args.target_status == null) {
		throw new Error('Need --target-stage-id with explicit --entry-id or --stage-entry-id');
	}
	const target_stage = target_stage_id == null ? null : indexes.stages.get(target_stage_id);
	if (!target_stage) {
		if (target_stage_id != null) {
			throw new Error(`Cannot find target stage ${target_stage_id}`);
		}
	}

	const stage_entry = indexes.stage_entries.find(candidate => (
		(stage_entry_id != null && first(candidate.ID) === stage_entry_id) ||
		(entry_id != null && first(candidate.EntryID) === entry_id)
	));
	if (!stage_entry) {
		throw new Error(`Cannot find stage entry for ${stage_entry_id != null ? `stageEntry ${stage_entry_id}` : `entry ${entry_id}`}`);
	}

	return {
		stage_entry,
		target_stage: target_stage || indexes.stages.get(first(stage_entry.StageID)),
		reason: 'explicit command line selection',
	};
}

async function load_tournament_from_db(tournament_key) {
	const db = await promisify(database.init)();
	const tournament = await db.tournaments.findOne_async({key: tournament_key});
	if (!tournament) {
		throw new Error(`Cannot find tournament ${tournament_key} in BTS database`);
	}
	return tournament;
}

async function send_request(ip, port, req, time_zone) {
	const raw = await promisify(btp_conn.send_raw_request)(ip, port, btp_proto.encode(req, time_zone));
	return promisify(btp_proto.decode)(raw);
}

function read_result_code(response) {
	return response?.Action?.[0]?.Result?.[0];
}

async function login(ip, password, time_zone) {
	const response = await send_request(ip, btp_conn.BTP_PORT, btp_proto.login_request(password), time_zone);
	const result = read_result_code(response);
	if (result !== 1) {
		throw new Error(`BTP login failed with result ${result}`);
	}
	const unicode = response?.Action?.[0]?.Unicode?.[0];
	if (!unicode) {
		throw new Error('BTP login did not return Unicode token');
	}
	return unicode;
}

async function fetch_tournament(ip, password, time_zone) {
	const response = await send_request(ip, btp_conn.BTP_PORT, btp_proto.get_info_request(password), time_zone);
	const tournament = get_tournament(response);
	if (!tournament) {
		throw new Error('BTP response did not contain a tournament');
	}
	return tournament;
}

async function send_stage_entry_update(ip, password, time_zone, unicode, update) {
	const req = btp_proto.update_stage_entries_request([update], unicode, password);
	const response = await send_request(ip, btp_conn.BTP_PORT, req, time_zone);
	const result = read_result_code(response);
	if (result !== 1) {
		throw new Error(`StageEntry update failed with result ${result}`);
	}
	return response;
}

function print_plan(label, candidate, indexes, update, target_stage) {
	console.log(label);
	console.log('  reason:', candidate.reason);
	console.log('  from:', describe_stage_entry(candidate.stage_entry, indexes));
	console.log('  to:', {
		stage_entry_id: update.ID,
		entry_id: update.EntryID,
		stage_id: update.StageID,
		stage: stage_label(target_stage),
		status: update.Status,
	});
}

async function main() {
	const parser = argparse.ArgumentParser({
		description: 'Experimental BTP StageEntry update test. Use only on copied test tournaments.',
	});
	parser.addArgument(['--tournament-key'], {
		defaultValue: 'default',
		help: 'BTS tournament key used to load BTP IP/password if --ip is omitted.',
	});
	parser.addArgument(['--ip'], {
		help: 'BTP IP address. Defaults to the BTS tournament BTP IP.',
	});
	parser.addArgument(['--password'], {
		help: 'BTP password. Defaults to the BTS tournament BTP password.',
	});
	parser.addArgument(['--entry-id'], {
		help: 'EntryID to move.',
	});
	parser.addArgument(['--stage-entry-id'], {
		help: 'StageEntry ID to move.',
	});
parser.addArgument(['--target-stage-id'], {
	help: 'Target StageID. Required with explicit --entry-id or --stage-entry-id.',
});
parser.addArgument(['--target-status'], {
	help: 'Target StageEntry Status. Optional; useful to test whether StageEntry fields are writable at all.',
});
	parser.addArgument(['--list'], {
		action: 'storeTrue',
		help: 'List StageEntries and exit without sending an update.',
	});
	parser.addArgument(['--send'], {
		action: 'storeTrue',
		help: 'Actually send the update to BTP. Without this, only print XML.',
	});
	parser.addArgument(['--restore'], {
		action: 'storeTrue',
		help: 'After sending, move the StageEntry back to its original StageID.',
	});
	parser.addArgument(['--xml'], {
		action: 'storeTrue',
		help: 'Print the generated SENDUPDATE XML.',
	});

	const args = parser.parseArgs();
	let tournament_config = null;
	if (!args.ip || args.password == null) {
		tournament_config = await load_tournament_from_db(args.tournament_key);
	}

	const ip = args.ip || tournament_config.btp_ip;
	const password = args.password != null ? args.password : tournament_config.btp_password;
	const time_zone = tournament_config ? tournament_config.btp_timezone : null;
	if (!ip) {
		throw new Error('Need BTP IP via --ip or BTS tournament config');
	}

	const tournament = await fetch_tournament(ip, password, time_zone);
	const indexes = build_indexes(tournament);
	if (args.list) {
		for (const stage_entry of indexes.stage_entries) {
			console.log(describe_stage_entry(stage_entry, indexes));
		}
		return;
	}
	const candidate = (args.entry_id || args.stage_entry_id)
		? find_explicit_candidate(indexes, args)
		: find_auto_candidate(indexes);

	if (!candidate) {
		throw new Error('Cannot find automatic test candidate');
	}

	const original_update = normalize_stage_entry(candidate.stage_entry);
	const next_update = {
		...original_update,
	};
	if (candidate.target_stage) {
		next_update.StageID = first(candidate.target_stage.ID);
	}
	if (args.target_status != null) {
		next_update.Status = Number(args.target_status);
	}

	print_plan('Planned StageEntry update:', candidate, indexes, next_update, candidate.target_stage);

	if (args.xml || !args.send) {
		const req = btp_proto.update_stage_entries_request([next_update], '<login-unicode-token>', password);
		console.log('\nGenerated SENDUPDATE XML:');
		console.log(btp_proto._req2xml(req, time_zone));
	}

	if (!args.send) {
		console.log('\nDry run only. Add --send to execute this against BTP.');
		return;
	}

	const unicode = await login(ip, password, time_zone);
	await send_stage_entry_update(ip, password, time_zone, unicode, next_update);
	console.log('\nSent update. Fetching BTP state again...');

	const after_tournament = await fetch_tournament(ip, password, time_zone);
	const after_indexes = build_indexes(after_tournament);
	const after_stage_entry = after_indexes.stage_entries.find(stage_entry => first(stage_entry.ID) === next_update.ID);
	console.log('After update:', describe_stage_entry(after_stage_entry, after_indexes));

	if (args.restore) {
		const restore_update = {
			...original_update,
		};
		console.log('\nRestoring original StageEntry...');
		await send_stage_entry_update(ip, password, time_zone, unicode, restore_update);

		const restored_tournament = await fetch_tournament(ip, password, time_zone);
		const restored_indexes = build_indexes(restored_tournament);
		const restored_stage_entry = restored_indexes.stage_entries.find(stage_entry => first(stage_entry.ID) === next_update.ID);
		console.log('After restore:', describe_stage_entry(restored_stage_entry, restored_indexes));
	}
}

main().then(() => {
	process.exit(0);
}).catch(err => {
	console.error(err.stack || err.message || err);
	process.exit(1);
});
