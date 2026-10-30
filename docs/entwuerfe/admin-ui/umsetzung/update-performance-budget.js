'use strict';
const limits = Object.freeze({ small:{handler_ms:16,total_ms:100},structural:{handler_ms:100,total_ms:500},full:{handler_ms:250,total_ms:1000} });
function assess(samples, kind='small') {
 const budget=limits[kind];if(!budget)throw new Error('Unknown performance budget: '+kind);
 if(samples.length<3)throw new Error('At least three measured updates are required');
 const median=key=>{const values=samples.map(s=>s.timings[key]).sort((a,b)=>a-b);return values[Math.floor(values.length/2)];};
 if(samples.some(s=>s.status!=='presented'||!Number.isFinite(s.presented_at)||!s.presented_at||!['handler_ms','total_ms'].every(key=>Number.isFinite(s.timings[key])&&s.timings[key]>=0)||s.timings.total_ms<s.timings.handler_ms))throw new Error('Only completed presentation receipts are valid performance samples');
 const result={samples:samples.length,handler_ms:median('handler_ms'),total_ms:median('total_ms'),max_ms:Math.max(...samples.map(s=>s.timings.total_ms)),budget};
 if(result.handler_ms>budget.handler_ms||result.total_ms>budget.total_ms||result.max_ms>budget.total_ms*2)throw new Error('Update exceeds '+kind+' budget: '+JSON.stringify(result));
 return result;
}
module.exports={limits,assess};
