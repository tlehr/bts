'use strict';
const assert = require('assert');
const {analyze} = require('../debug/strict_latency_report');
function fixture() {
	return {stop_reason:'completed',runtime_ms:600000,server_profiles:[{}],reception:{admin:[{method:'browser-dom-and-render-opportunity'}]},
		tablet_to_admin_ms:{count:2,sent_updates:2},tablet_to_tv_ms:{count:2,sent_updates:2},reception_expired:{admin:0,tv:0},
		test_events:[{label:'live-drill:finish-confirm',data:{trace_id:'finish'}}],point_receptions:[
			{trace_id:'point',admin_ms:99,tv_ms:49,admin_presentation_status:'presented'},
			{trace_id:'finish',admin_ms:149,tv_ms:49,admin_presentation_status:'presented'},
		]};
}
describe('strict per-kind latency acceptance', function() {
	it('accepts only a complete render run below all three maxima', function() {assert(analyze(fixture()).target_met);});
	it('exposes occupied fields and failed background operations alongside latency results', function() {
		const report=fixture();report.scenario='benchmark';report.seed='519';
		report.phases=[{name:'load',points:100,finish_confirmations:3,occupied_courts:{mean:12,max:15}}];
		report.server_performance={traces:[{name:'periodic_preparation_age',status:'error'},
			{name:'periodic_preparation_age',status:'error'},{name:'score',status:'ok'}]};
		const result=analyze(report);
		assert.strictEqual(result.workload.phases[0].occupied_courts.mean,12);
		assert.deepStrictEqual(result.operation_failures,{periodic_preparation_age:2});
		assert.strictEqual(result.successful_operations,false);
		assert.strictEqual(result.target_met,false,'A failed preparation operation must not make the load test look successful');
	});
	it('rejects equality at every strict threshold instead of accepting a good average', function() {
		for (const [index,key,value] of [[0,'admin_ms',100],[1,'admin_ms',150],[0,'tv_ms',50]]) {
			const report=fixture();report.point_receptions[index][key]=value;assert(!analyze(report).target_met);
		}
	});
	it('rejects partial, unmatched, absent-finish, mixed-server and reception-only runs', function() {
		for (const mutate of [r=>{r.partial=true;},r=>{r.runtime_ms=599999;},r=>{r.point_receptions.pop();},
			r=>{r.test_events=[];},r=>{r.mixed_server_profiles=true;},r=>{r.reception.admin[0].method='independent-websocket';},
			r=>{r.point_receptions[0].admin_presentation_status='superseded';},r=>{r.reception_expired.admin=1;}]) {
			const report=fixture();mutate(report);assert(!analyze(report).target_met);
		}
	});
});
