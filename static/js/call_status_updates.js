'use strict';
// Apply a negotiated status patch without replacing unchanged locations or
// game diagnoses. A missed baseline requires a fresh subscription snapshot.
var btsCallStatusUpdates = (function() {
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    const sections = ['diagnostics_by_match_id', 'call_on_court_diagnostics_by_match_id'];
    function apply(before, status, value) {
        const delta = value.selections_delta;
        if (!delta) return Object.fromEntries((value.selections || []).filter(row => row?.location_id != null).map(row => [String(row.location_id), row]));
        if (!status || status.epoch !== delta.epoch || status.revision !== delta.base ||
            value.call_status?.epoch !== status.epoch || value.call_status.revision <= status.revision ||
            !Array.isArray(delta.changed) || !Array.isArray(delta.removed)) return null;
        const result = {...before}, seen = new Set();
        for (const id of delta.removed) { if (seen.has(String(id))) return null; seen.add(String(id)); delete result[String(id)]; }
        for (const patch of delta.changed) {
            if (patch?.location_id == null) return null;
            const id = String(patch.location_id);
            if (seen.has(id)) return null; seen.add(id);
            if (patch.replace) {
                if (String(patch.replace.location_id) !== id) return null;
                Object.defineProperty(result,id,{value:patch.replace,enumerable:true,configurable:true,writable:true});continue;
            }
            if (!own(result,id) || !patch.fields || typeof patch.fields !== 'object') return null;
            const row = {...result[id], ...patch.fields};
            for (const field of patch.unset || []) { if (field === 'location_id' || sections.includes(field)) return null; delete row[field]; }
            for (const section of sections) if (patch[section]) {
                const change = patch[section];
                if (!change.set || typeof change.set !== 'object' || !Array.isArray(change.remove)) return null;
                const records = {...row[section], ...change.set};
                for (const key of change.remove) delete records[key];
                row[section] = records;
            }
            if (String(row.location_id) !== id) return null;
            Object.defineProperty(result,id,{value:row,enumerable:true,configurable:true,writable:true});
        }
        return result;
    }
    return {apply, sections};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = btsCallStatusUpdates;
