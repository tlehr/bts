'use strict';
const assert=require('assert'),{updates}=require('../bts/btp_court_state');
describe('BTP court state after a local release',function(){
	const match={_id:'btp_default_MX U19_81',btp_match_ids:[{id:81}],setup:{now_on_court:false,court_id:null}};
	it('clears an already released court after uncalling a modern match ID',function(){
		assert.deepStrictEqual(updates([{_id:'c1',btp_id:1,match_id:null}],match,'c1'),[{btp_id:1}]);
	});
	it('clears the court retained on a finished match after its local slot is released',function(){
		assert.deepStrictEqual(updates([{_id:'c1',btp_id:1,match_id:null}],{...match,setup:{now_on_court:false,court_id:'c1'}}),[{btp_id:1}]);
	});
	it('does not clear a replacement game or an unrelated empty court',function(){
		assert.deepStrictEqual(updates([{_id:'c1',btp_id:1,match_id:'replacement'},{_id:'c2',btp_id:2,match_id:null}],match,'c1'),[]);
	});
	it('recognizes occupied slots for modern and legacy IDs',function(){
		assert.deepStrictEqual(updates([{_id:'c1',btp_id:1,match_id:match._id},{_id:'c2',btp_id:2,match_id:'btp_81'}],{...match,btp_id:81}),[{btp_id:1},{btp_id:2}]);
	});
	it('retains ordinary court calls and never creates incomplete BTP requests',function(){
		const courts=[{_id:'c1',btp_id:1},{_id:'c2',btp_id:2}];
		assert.deepStrictEqual(updates(courts,{...match,setup:{now_on_court:true,court_id:'c1'}}),[{btp_id:1,btp_match_id:81}]);
		assert.deepStrictEqual(updates(courts,{...match,btp_match_ids:[],setup:{now_on_court:true,court_id:'c1'}}),[]);
		assert.deepStrictEqual(updates([{_id:'c1',match_id:null}],match,'c1'),[]);
	});
});
