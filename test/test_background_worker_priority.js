'use strict';

const assert = require('assert');
const os = require('os');
const {Worker} = require('worker_threads');
const {create} = require('../bts/offload/background_priority');

describe('background worker CPU priority', function() {
	function fixture(options = {}) {
		let nice = options.nice ?? 0;
		const writes = [], warnings = [];
		const api = create({platform:'linux',main:false,enabled:() => true,
			os:{getPriority() {return nice;},setPriority(pid,value) {writes.push([pid,value]);nice=value;}},
			warn:message => warnings.push(message),...options});
		return {api,writes,warnings};
	}
	for (const role of ['btp_decode','sync_plan_worker','compaction_serialize','call_status_calculation']) {
		it('lowers only its named background worker: '+role,function() {
			const f=fixture(),status=f.api.configure(role);
			assert.deepStrictEqual(f.writes,[[0,5]]);assert.strictEqual(status.applied,true);
			assert.strictEqual(status.nice,5);status.nice=99;assert.strictEqual(f.api.snapshot().nice,5);
			f.api.configure(role);assert.strictEqual(f.writes.length,1);
		});
	}
	for (const [name,options,role] of [['main thread',{main:true},'sync_plan_worker'],
		['critical append',{},'database_append'],['other OS',{platform:'win32'},'sync_plan_worker'],
		['disabled feature',{enabled:() => false},'sync_plan_worker']]) {
		it('retains the current priority for '+name,function() {
			const f=fixture(options);assert.strictEqual(f.api.configure(role).applied,false);assert.deepStrictEqual(f.writes,[]);
		});
	}
	it('never raises an already lower priority and preserves work if the OS rejects the request',function() {
		const f=fixture({nice:10});assert.strictEqual(f.api.configure('sync_plan_worker').nice,10);assert.deepStrictEqual(f.writes,[]);
		const unavailable=fixture({os:{getPriority() {return 0;},setPriority() {throw Object.assign(new Error('denied'),{code:'EACCES'});}}});
		assert.strictEqual(unavailable.api.configure('sync_plan_worker').reason,'unavailable');
		assert.strictEqual(unavailable.api.snapshot().applied,false);assert.strictEqual(unavailable.warnings.length,1);
		unavailable.api.configure('sync_plan_worker');assert.strictEqual(unavailable.warnings.length,1);
	});
	it('changes a real Linux worker thread without changing the main or append thread',async function() {
		if(process.platform!=='linux')this.skip();
		this.timeout(5000);const before=os.getPriority(0),filename=require.resolve('../bts/offload/background_priority');
		for(const [role,enabled] of [['sync_plan_worker',true],['database_append',true],['sync_plan_worker',false]]) {
			const worker=new Worker(`const {parentPort,workerData}=require('worker_threads'),os=require('os');
const before=os.getPriority(0),api=require(workerData.filename),status=api.configure(workerData.role);
parentPort.postMessage({before,after:os.getPriority(0),status});`,{eval:true,workerData:{filename,role},env:{...process.env,BTS_BACKGROUND_WORKER_PRIORITY:enabled?'1':'0'}});
			try {
				const answer=await new Promise((resolve,reject) => {worker.once('message',resolve);worker.once('error',reject);});
				assert.strictEqual(answer.after,role==='sync_plan_worker'&&enabled?Math.max(answer.before,5):answer.before);
				assert.strictEqual(os.getPriority(0),before,'Main thread priority changed');
			} finally {await worker.terminate();}
		}
	});
});
