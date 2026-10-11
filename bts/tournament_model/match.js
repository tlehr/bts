'use strict';

const Entity = require('./entity');
const Participation = require('./participation');
const update_official_links = require('./official_links');
const { known_player_id, player_ids } = require('./player_ids');

class Match extends Entity {
	constructor(model, id, tournament) {
		super(model, 'matches', id, tournament);
		this.players = new Set();
		this.participations = new Map();
		this.official_assignments = new Map();
		this.court = null;
	}
	get umpire() { return this.official_assignments.get('umpire')?.official || null; }
	get service_judge() { return this.official_assignments.get('service_judge')?.official || null; }
	_links(document) {
		update_official_links(this, document);
		const tournament = this.tournament;
		const wanted = new Map();
		for (let team = 0; team < (document?.setup?.teams || []).length; team++) {
			(document.setup.teams[team].players || []).forEach((source, position) => wanted.set(`team:${team}:${position}`, source));
		}
		(document?.setup?.tabletoperators || []).forEach((source, position) => wanted.set(`tablet:${position}`, source));
		for (const [slot, participation] of this.participations) if (!wanted.has(slot)) {
			participation.player.participations.delete(participation);
			participation.player._detach(participation);
			this.participations.delete(slot);
		}
		const players = new Set();
		for (const [slot, source] of wanted) {
			const id = known_player_id(source.btp_id) || `local:${this.id}:${slot}`;
			const player = tournament.player(id);
			let participation = this.participations.get(slot);
			if (!participation) this.participations.set(slot, participation = new Participation(this, slot, player));
			participation._replace(source, player);
			players.add(player);
		}
		for (const id of player_ids(document)) if (known_player_id(id) !== null) players.add(tournament.player(id));
		for (const player of this.players) if (!players.has(player)) {
			player.matches.delete(this);
			this.players.delete(player);
		}
		for (const player of players) { this.players.add(player); player.matches.add(this); }
		const court = document?.setup?.court_id != null ? this.model.entity('courts', document.setup.court_id, tournament) : null;
		if (this.court !== court) {
			if (this.court) this.court.matches.delete(this);
			this.court = court;
			if (court) court.matches.add(this);
		}
	}
}

module.exports = Match;
