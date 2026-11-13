'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');

function fixture(view) {
	let refreshes=0;
	const context={curt:{},current_view:view,ctournament:{refresh_current_view(){refreshes++;}}};
	vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/change'),'utf8'),context);
	return {context,refreshes:()=>refreshes,send:(ctype,val)=>context.change.default_handler(()=>assert.fail('No full view rebuild'))({ctype,val})};
}
describe('Accounting updates stay in their owning page',function(){
	for(const view of ['show','devices','registration_control','accounting'])it('retains data without rebuilding unrelated views: '+view,function(){
		const h=fixture(view),model=h.context.curt;
		h.send('registration_accounting_entry',{entry:{id:'entry',amount:10}});
		h.send('registration_accounting_entry',{entry:{id:'entry',amount:20}});
		assert.strictEqual(model.accounting_entries.length,1);assert.strictEqual(model.accounting_entries[0].amount,20);
		h.send('registration_accounting_entry_remove',{entry_id:'entry'});assert.strictEqual(model.accounting_entries.length,0);
		h.send('registration_accounting_document',{document:{id:'document'}});assert.strictEqual(model.accounting_documents[0].id,'document');
		h.send('registration_accounting_item',{item:{id:'item'}});assert.strictEqual(model.accounting_items[0].id,'item');
		h.send('registration_accounting_item_remove',{item_id:'item'});assert.strictEqual(model.accounting_items.length,0);
		h.send('update_btp_payments',{btp_payments:{payments:[{id:'payment'}]}});assert.strictEqual(model.btp_payments.payments[0].id,'payment');
		assert.strictEqual(h.refreshes(),view==='accounting'?7:0);
	});
});
