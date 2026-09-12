'use strict';

function build_base_setting(tournament, id, description, devicemode) {
	const language = tournament && tournament.language ? tournament.language : 'auto';
	return {
		id,
		description,
		devicemode,
		fullscreen_ask: devicemode === 'display' ? 'auto' : 'never',
		show_announcements: devicemode === 'display' ? 'all' : 'none',
		network_timeout: '10000',
		network_update_interval: '10000',
		displaymode_update_interval: 500,
		d_c0: '#50e87d',
		d_cb0: '#000000',
		d_c1: '#f76a23',
		d_cb1: '#000000',
		d_cbg: '#000000',
		d_cfg: '#ffffff',
		d_cfgdark: '#000000',
		d_cbg2: '#d9d9d9',
		d_cbg3: '#252525',
		d_cbg4: '#404040',
		d_cfg2: '#aaaaaa',
		d_cfg3: '#cccccc',
		d_cfg4: '#000000',
		d_cexp: '#ff0000',
		d_cborder: '#444444',
		d_ct: '#80ff00',
		d_ctim_blue: '#0070c0',
		d_ctim_active: '#ffc000',
		d_cserv: '#fff200',
		d_cserv2: '#dba766',
		d_crecv: '#707676',
		d_scale: '100',
		d_team_colors: false,
		d_show_pause: true,
		d_show_court_number: true,
		d_show_competition: true,
		d_show_round: true,
		d_show_players: true,
		d_show_team_name: true,
		d_show_middle_name: false,
		d_abbreviate_first_name: false,
		d_show_doubles_receiving: false,
		settings_autohide: 30000,
		double_click_timeout: 1000,
		button_block_timeout: devicemode === 'display' ? '1200' : '1000',
		negative_timers: devicemode !== 'display',
		shuttle_counter: devicemode === 'display',
		language,
		editmode_doubleclick: devicemode !== 'display',
		displaymode_style: 'tournamentcourt',
		displaymode_court_id: '',
		wakelock: 'display',
		click_mode: 'auto',
		settings_style: devicemode === 'display' ? 'complete' : 'default',
		style: devicemode === 'display' ? 'complete' : 'hidden',
		tablet_mode: 'umpire',
	};
}

function build_default_display_setting(tournament) {
	const key = tournament && tournament.key ? tournament.key : 'default';
	return build_base_setting(tournament, `${key}_default_display`, 'Anzeige', 'display');
}

function build_default_tablet_setting(tournament) {
	const key = tournament && tournament.key ? tournament.key : 'default';
	return build_base_setting(tournament, `${key}_default_umpire`, 'Schiedsrichter', 'umpire');
}

function build_default_registration_setting(tournament) {
	const key = tournament && tournament.key ? tournament.key : 'default';
	const setting = build_base_setting(tournament, `${key}_default_registration`, 'Anmeldung', 'umpire');
	setting.tablet_mode = 'registration_check';
	setting.style = 'hidden';
	setting.show_announcements = 'none';
	setting.negative_timers = false;
	setting.shuttle_counter = false;
	setting.editmode_doubleclick = false;
	return setting;
}

function choose_default_patch(tournament, displaysettings) {
	const settings = Array.isArray(displaysettings) ? displaysettings : [];
	const first_display = settings.find((setting) => setting.devicemode === 'display');
	const first_umpire = settings.find((setting) => setting.devicemode === 'umpire');
	const selected_display = settings.find((setting) => setting.id === tournament.displaysettings_general);
	const selected_tablet = settings.find((setting) => setting.id === tournament.displaysettings_general_tablet);
	const patch = {};
	if (!selected_display || selected_display.devicemode !== 'display') {
		patch.displaysettings_general = first_display ? first_display.id : tournament.displaysettings_general;
	}
	if (!selected_tablet || selected_tablet.devicemode !== 'umpire') {
		patch.displaysettings_general_tablet = first_umpire ? first_umpire.id : tournament.displaysettings_general_tablet;
	}
	return patch;
}

async function insert_setting_if_missing(db, setting) {
	const existing = await db.displaysettings.findOne_async({ id: setting.id });
	if (existing) {
		return existing;
	}
	return new Promise((resolve, reject) => {
		db.displaysettings.insert(setting, (err, inserted) => {
			if (err) return reject(err);
			return resolve(inserted);
		});
	});
}

async function ensure_default_displaysettings(app, tournament) {
	if (!tournament) {
		return { tournament, displaysettings: [] };
	}
	let displaysettings = await app.db.displaysettings.find_async({});
	if (displaysettings.length === 0) {
		const default_display = await insert_setting_if_missing(app.db, build_default_display_setting(tournament));
		const default_tablet = await insert_setting_if_missing(app.db, build_default_tablet_setting(tournament));
		const default_registration = await insert_setting_if_missing(app.db, build_default_registration_setting(tournament));
		displaysettings = [default_display, default_tablet, default_registration];
	} else {
		const default_registration = await insert_setting_if_missing(app.db, build_default_registration_setting(tournament));
		if (!displaysettings.some((setting) => setting.id === default_registration.id)) {
			displaysettings.push(default_registration);
		}
	}
	const patch = choose_default_patch(tournament, displaysettings);
	if (Object.keys(patch).length > 0) {
		const [, updated_tournament] = await app.db.tournaments.update_async(
			{ key: tournament.key },
			{ $set: patch },
			{ returnUpdatedDocs: true },
		);
		Object.assign(tournament, updated_tournament || patch);
	}
	return { tournament, displaysettings };
}

module.exports = {
	ensure_default_displaysettings,
	build_default_display_setting,
	build_default_tablet_setting,
	build_default_registration_setting,
};
