'use strict';
// JSON catalog revisions have no cycles or special object values. Replace a
// resized array as a whole; stable arrays can update one entry in place.
module.exports = function diff(before, after) {
    const changes = [], started = process.hrtime.bigint();
    let visited = 0;
    function visit(left, right, path) {
        if ((++visited & 255) === 0 && process.hrtime.bigint() - started > 4000000n) throw new Error('Patch work budget');
        if (Object.is(left, right)) return;
        if (changes.length >= 128 || path.length > 12) throw new Error('Patch bounds');
        const array = Array.isArray(left), sameShape = left && right && typeof left === 'object' && typeof right === 'object' && array === Array.isArray(right);
        if (!sameShape || array && left.length !== right.length) { changes.push({path, value:right}); return; }
        if (array) { for (let index=0;index<left.length;index++) visit(left[index],right[index],[...path,index]);return; }
        const targetKeys = Object.keys(right), predictedKeys = [...Object.keys(left).filter(key => Object.prototype.hasOwnProperty.call(right,key)), ...targetKeys.filter(key => !Object.prototype.hasOwnProperty.call(left,key))];
        if (predictedKeys.length !== targetKeys.length || predictedKeys.some((key,index) => key !== targetKeys[index])) { changes.push({path,value:right});return; }
        if (Object.keys(left).some(key => ['__proto__','constructor','prototype'].includes(key))) throw new Error('Unsafe path');
        for (const key of Object.keys(left)) if (!Object.prototype.hasOwnProperty.call(right,key)) changes.push({path:[...path,key],remove:true});
        for (const key of Object.keys(right)) {
            if (['__proto__','constructor','prototype'].includes(key)) throw new Error('Unsafe path');
            if (!Object.prototype.hasOwnProperty.call(left,key)) changes.push({path:[...path,key],value:right[key]});
            else visit(left[key],right[key],[...path,key]);
        }
        if (changes.length > 128) throw new Error('Patch bounds');
    }
    try { visit(before,after,[]);return changes; } catch { return null; }
};
