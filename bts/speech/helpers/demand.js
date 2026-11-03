'use strict';

const crypto = require('crypto');
// Reports speech demand only. Selection of machines, leases, retries, fallback
// and quality checks are all owned by the main speech server.
class ServerDemand {
    constructor(broker) {this.broker=broker;this.next=0;this.parallelism=0;this.central=true;}
    execution(entry) {return entry.status !== 'completed' && !entry.retired ? entry.server_execution || null : null;}
    accepts(entry) {
        return entry.context?.kind === 'source' && entry.central_skip !== this.broker.identity &&
            this.broker.request_for(entry).text.length <= 380;
    }
    async step() {
        const b=this.broker;
        if (!b.server_helper_dispatch || !b.metadata_verified || b.reconfiguring || b.now()<this.next) return;
        this.next=b.now()+1000;
        const active=[...b.entries.values()].filter(entry=>entry.central_job&&!entry.retired&&entry.status!=='completed');
        const wanted=[...b.pending_order().filter(entry=>this.accepts(entry)),...active]
            .sort((a,b)=>a.priority-b.priority).slice(0,32);
        const owner=crypto.createHash('sha256').update(b.signing_key).digest('hex');
        try {
            const response=await b.request(b.config.base_url,b.config.api_key,'POST','/v1/helpers/demand',{
                owner,items:wanted.map(entry=>({key:entry.key,request:b.request_for(entry),tournaments:[...entry.tournaments].slice(0,32)})),
            },b.config.timeout_ms);
            if(!Array.isArray(response.items)||response.items.length>32)throw new Error('speech_invalid_response');
            for(const row of response.items) {
                const entry=wanted.find(item=>item.key===row.key);if(!entry)throw new Error('speech_invalid_response');
                if(row.error) {
                    if(['helper_prepared_source','helper_request_unsupported','helper_profile_mismatch'].includes(row.error))entry.central_skip=b.identity;
                    continue;
                }
                b.validate_response(entry,row.job);
                entry.central_job=row.job.job_id;entry.server_execution=row.job.execution;
                if(b.record_diagnostics(entry,row.job))await b.failures.persist();
                if(row.job.status==='completed') {
                    await b.publish(entry,row.job,b.identity);
                    delete entry.central_job;delete entry.server_execution;
                    b.on_change([...entry.tournaments]);
                } else if(row.job.status==='failed') {
                    b.update(entry,row.job);
                    delete entry.central_job;delete entry.server_execution;
                    b.on_change([...entry.tournaments]);
                } else b.update(entry,row.job);
            }
            b.health.clear('upstream_helpers');
        } catch(error) {b.health.fail('upstream_helpers',error,true,{endpoint:b.config.base_url});}
    }
}
module.exports={ServerDemand};
