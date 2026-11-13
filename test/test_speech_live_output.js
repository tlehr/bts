'use strict';

const assert = require('assert');
const {EventEmitter} = require('events');
const foreground = require('../bts/foreground_work');
const speech = require('../bts/speech');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
	const ws = new EventEmitter();ws.readyState = 1;ws.messages = [];ws.speech_tournament_key = 'test';
	ws.send = bytes => ws.messages.push(JSON.parse(bytes));
	require('../bts/wshandler').handle({on_connect() {},on_close() {}},{},ws);
	const value = {speech:{enabled:true},clips:[{status:'completed',local:true,url:'/speech/test.wav'}]};
	const app = {speech:{broker:{config:{enabled:true}},request:async () => value}};
	return {app,ws,value};
}

describe('speech readiness replies beside live points', function() {
	let previous;
	beforeEach(function() {previous = process.env.BTS_ADMIN_RESPONSE_PRIORITY;process.env.BTS_ADMIN_RESPONSE_PRIORITY = '1';});
	afterEach(function() {
		if (previous === undefined) delete process.env.BTS_ADMIN_RESPONSE_PRIORITY;
		else process.env.BTS_ADMIN_RESPONSE_PRIORITY = previous;
	});
	for (const type of ['speech_status','speech_resolve','speech_prepare']) it(type + ' does not make point publication wait for foreground cleanup', async function() {
		const {app,ws,value} = fixture(), release = foreground.begin('handle_score_update_v2');
		try {
			await speech.handle(app,ws,{type,tournament_key:'test',rid:1,parts:['Test']});
			ws.sendmsg({type:'change',ctype:'score',val:{network_score:[[1,0]]}});
			assert.strictEqual(ws.messages.length,2,'readiness encoding must not hold this socket until the point finishes');
			assert.deepStrictEqual(ws.messages[0],{...value,type:'answer',rid:1});
			assert.strictEqual(ws.messages[1].ctype,'score');
		} finally {release();await tick();ws.emit('close');}
	});
	it('retains background encoding for an inventory response', async function() {
		const {app,ws} = fixture(), release = foreground.begin('handle_score_update_v2');
		try {
			await speech.handle(app,ws,{type:'speech_inventory',tournament_key:'test',rid:1});
			assert.strictEqual(ws.outbox_stats().active,1);assert.deepStrictEqual(ws.messages,[]);
		} finally {release();await tick();ws.emit('close');}
	});
	it('keeps readiness and later points behind a genuinely reserved tournament snapshot', async function() {
		const {app,ws} = fixture(), reply = ws.reserve_response({rid:'overview',key:'test'});
		try {
			await speech.handle(app,ws,{type:'speech_status',tournament_key:'test',rid:'speech'});
			ws.sendmsg({type:'change',ctype:'score',val:{network_score:[[2,0]]}});
			assert.deepStrictEqual(ws.messages,[]);
			reply(null,{tournament:{matches:[]}});await tick();
			assert.deepStrictEqual(ws.messages.map(message=>message.rid||message.ctype),['overview','speech','score']);
		} finally {ws.emit('close');}
	});
});
