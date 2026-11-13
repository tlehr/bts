'use strict';

const states = new WeakMap(), prepared = new WeakMap();
const {sections} = require('../../static/js/call_status_updates');
function begin(ws, key, delta) {
    const state = {key, delta:delta === true, loading:true, sent:0, base:null};
    states.set(ws,state);return {ws,state};
}
function finish(ticket, view) {
    if (states.get(ticket.ws) !== ticket.state) return;
    if (!ticket.state.sent) ticket.state.base = view;
    ticket.state.loading = false;
}
function patch(previous, current) {
    const old = new Map(previous.selections.map(row => [String(row.location_id),row]));
    const changed = [];
    for (const row of current.selections) {
        const id = String(row.location_id), before = old.get(id);old.delete(id);
        if (row === before) continue;
        if (!before) {changed.push({location_id:row.location_id,replace:row});continue;}
        const value = {location_id:row.location_id, fields:{}, unset:[]};
        for (const key of Object.keys(before)) if (!(key in row)) value.unset.push(key);
        for (const [key,field] of Object.entries(row)) {
            if (field === before[key]) continue;
            if (!sections.includes(key)) {
                if (field === undefined) {if (Object.prototype.hasOwnProperty.call(before,key)) value.unset.push(key);}
                else value.fields[key] = field;
                continue;
            }
            const records = before[key] || {}, next = field || {};
            value[key] = {set:Object.fromEntries(Object.entries(next).filter(([id,record]) => record !== records[id])),
                remove:Object.keys(records).filter(id => !Object.prototype.hasOwnProperty.call(next,id))};
        }
        changed.push(value);
    }
    return {call_status:current.call_status, selections_delta:{epoch:previous.call_status.epoch,base:previous.call_status.revision,
        changed,removed:[...old.keys()]}};
}
function prepare(value) {
    if (Object.isFrozen(value) && prepared.has(value)) return prepared.get(value);
    const variants = new WeakMap();
    const deliver = (ws,key) => {
        const state = states.get(ws);
        // Only pages subscribed to this tournament need its status stream.
        if (!state || state.key !== key) return null;
        const previous = state.base;if(previous===value&&!state.loading)return null;
        state.base = value;state.sent++;
        if (!state.delta || state.loading || !previous || previous.call_status.epoch !== value.call_status.epoch) return value;
        if (!variants.has(previous)) variants.set(previous,patch(previous,value));
        return variants.get(previous);
    };
    if (Object.isFrozen(value)) prepared.set(value,deliver);
    return deliver;
}
module.exports = {begin,finish,prepare,patch};
