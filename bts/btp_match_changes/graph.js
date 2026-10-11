'use strict';

const integrated_match = require('./integrated_match');

const key = (draw, planning) => JSON.stringify([String(draw), String(planning)]);

function dependency(node, visible) {
	if (visible) return JSON.stringify([
		node.ID, node.DrawID, node.PlanningID, node.MatchNr, node.From1, node.From2,
		node.WinnerTo, node.LoserTo, node.Winner, node.ScoreStatus, node.ForwardLoser,
		node.IsMatch, node.ReverseHomeAway, node.bts_complete, node.PlannedTime, node.RoundName,
		(node.bts_players || []).map(team => (team || []).map(player => player.ID)),
		node.bts_winners?.map(player => player.ID),
	]);
	const { bts_players, bts_winners, ...fields } = node;
	delete fields.Sets;
	return JSON.stringify({ ...fields,
		players: (bts_players || []).map(team => (team || []).map(player => player.ID)),
		winners: bts_winners?.map(player => player.ID),
	});
}

function graph_index(state, previous, fingerprint) {
	const nodes = new Map();
	const records = new Map();
	const dirty = new Set();
	const visible = new Set(state.matches.filter(integrated_match).map(node => key(node.DrawID?.[0], node.PlanningID?.[0])));
	const planning_nodes = Array.from((state.planning_nodes || new Map()).values());
	const indexed_nodes = new Set(planning_nodes);
	const inputs = [
		...Array.from(state.links || [], node => ['link', node]),
		...planning_nodes.map(node => ['planning', node]),
		...state.matches.filter(node => !indexed_nodes.has(node)).map(node => ['match', node]),
	];
	for (const [kind, node] of inputs) {
		const planning_key = key(node.DrawID?.[0], node.PlanningID?.[0]);
		const id = kind + ':' + planning_key;
		const draw = String(node.DrawID?.[0]);
		const old = previous?.records.get(id);
		const revision = fingerprint(node, old?.revision);
		const signature = revision.signature;
		const is_visible = kind !== 'link' && visible.has(planning_key);
		const topology = old?.signature === signature && old.visible === is_visible
			? old.dependency : dependency(node, is_visible);
		if (!old || topology !== old.dependency || old.visible !== is_visible) dirty.add(draw);
		const record = { data: node, key: planning_key, draw, signature, revision, visible: is_visible, dependency: topology };
		records.set(id, record);
		if (kind !== 'link') nodes.set(planning_key, record);
	}
	for (const [id, old] of previous?.records || []) if (!records.has(id)) dirty.add(old.draw);
	const order = new Map();
	for (const [id, node] of records) {
		if (!order.has(node.draw)) order.set(node.draw, []);
		order.get(node.draw).push(id);
	}
	for (const [draw, ids] of order) {
		const old = previous?.order.get(draw);
		if (!old || old.length !== ids.length || ids.some((id, index) => id !== old[index])) dirty.add(draw);
	}
	return { key, nodes, records, dirty, order };
}

module.exports = graph_index;
