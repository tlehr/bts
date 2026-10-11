'use strict';

const crypto = require('crypto');

// Metadata for one incoming record, with a shared prototype. The expensive
// combined signature is only requested for selected integration candidates.
class MatchInput {
	constructor(bm, draw, revision, assignment, player_ids, sources, index) {
		this.bm = bm;
		this.draw = draw;
		this.revision = revision;
		this.signature = revision.signature;
		this.assignment = assignment;
		this.player_ids = player_ids;
		this.sources = sources;
		this.index = index;
	}
	get content_signature() {
		const { contexts, graph, players } = this.index;
		return crypto.createHash('sha1').update(JSON.stringify([
			this.signature, this.assignment, contexts.get(this.draw),
			[...this.player_ids].map(player => players.get(player)),
			this.sources.map(source => graph.nodes.get(source)?.dependency),
		])).digest('hex');
	}
}

module.exports = MatchInput;
