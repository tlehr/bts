'use strict';

const { isDeepStrictEqual: equal } = require('util');

// Read-only refresh messages can also name an unchanged game. Only accept
// complete snapshot copies (or a bare canonical ID); never guess from payloads.
class OrderingNotifications {
	constructor(changed_ids, matches) {
		this.changed_ids = changed_ids;
		this.matches = matches;
		this.by_id = null;
		this.unchanged = 0;
	}

	accept({ resources }) {
		if (resources.deferred_job) return Object.keys(resources).every(key => key === 'deferred_job');
		const note = resources.notification, value = note?.value;
		if (Object.keys(resources).some(key => key !== 'notification') || note?.ctype !== 'match_edit' || !value ||
			Object.keys(value).some(key => key.startsWith('all_'))) return false;
		const id = value.match__id || value._id;
		if (id == null) return false;
		if (this.changed_ids.has(id)) return !value.match || this.changed_ids.has(value.match._id);
		if (!this.by_id) this.by_id = new Map(this.matches.map(match => [match._id, match]));
		const known = this.by_id.get(id);
		if (!known) return false;
		const wrapper = value.match__id === id && Object.keys(value).every(key => ['match__id', 'match'].includes(key));
		if (!(wrapper ? !value.match || equal(value.match, known) : equal(value, known))) return false;
		this.unchanged++;
		return true;
	}
}

module.exports = OrderingNotifications;
