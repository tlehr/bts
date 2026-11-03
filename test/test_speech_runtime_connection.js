'use strict';

const assert = require('assert');
const fs = require('fs/promises'), os = require('os'), path = require('path');
const {create_inline} = require('../bts/speech');
const {configuration} = require('../bts/speech/broker');
const key = 'runtime-fixture-' + 'x'.repeat(40);
const config = values => configuration({enabled:true,api_key:key,url:'http://old.example:8077',cache_enabled:false,...values}, {});
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(check) {
    for(let i=0;i<200;i++) {if(check())return;await wait(10);}
    throw new Error('runtime_test_timeout');
}
function service(values) {
    const app = {db:{tournaments:{find:(_q,done)=>done(null,[])}}};
    return app.speech = create_inline(app,config(values));
}

describe('Live speech connection changes', function() {
    this.timeout(10000);

    it('waits for the previous POST and never polls its identifier on the new server', async function() {
        const s=service(),b=s.broker,requests=[];
        let finishPost;
        b.request=async(url,_key,method,pathname,body)=>{
            requests.push({url,method,pathname});
            if(pathname==='/health')return {status:'ready',model:'test',model_revision:'1'};
            if(pathname==='/v1/voices')return {voices:[{voice_id:'hallensprecherin',languages:['de-DE']}]};
            if(method==='POST') {
                if(url==='http://old.example:8077')await new Promise(resolve=>{finishPost=resolve;});
                return {...body,status:'processing',job_id:(url.includes('old.')?'a':'b').repeat(32)};
            }
            assert(!url.includes('new.')||!pathname.includes('a'.repeat(32)),'old job routed to new endpoint');
            return {...b.current.request,job_id:'b'.repeat(32),status:'processing'};
        };
        b.prepare(['Testdurchsage'],{priority:'high'},'default');s.start();
        try {
            await until(()=>finishPost);
            const changing=s.reconfigure_connection(config({url:'http://new.example:8077'}));
            await until(()=>b.reconfiguring);
            assert.strictEqual(b.config.base_url,'http://old.example:8077');
            finishPost();await changing;
            await until(()=>requests.some(r=>r.url==='http://new.example:8077'&&r.method==='POST'));
            assert(requests.filter(r=>r.url==='http://old.example:8077').every(r=>!r.pathname.startsWith('/v1/jobs/')));
        } finally {s.stop();await b.cycle;}
    });

    it('retains legacy grants only until their expiry and binds new grants to their connection', async function() {
        const s=service(),b=s.broker,id='a'.repeat(32);
        let now=1700000000000;b.now=()=>now;
        const old=new URL(b.audio_url('default',id),'http://bts');
        const allowed=url=>b.authorize('default',id,url.searchParams.get('expires'),url.searchParams.get('signature'),'',url.searchParams.get('connection')||undefined);
        await s.reconfigure_connection(config({url:'http://new.example:8077'}));
        const fresh=new URL(b.audio_url('default',id),'http://bts');
        assert(allowed(old));assert(allowed(fresh));
        assert.strictEqual(b.audio_connection(undefined).config.base_url,'http://old.example:8077');
        assert.strictEqual(b.audio_connection(fresh.searchParams.get('connection')).config.base_url,'http://new.example:8077');
        const tampered=new URL(fresh);tampered.searchParams.delete('connection');assert(!allowed(tampered));
        assert.strictEqual(b.audio_connection(['a'.repeat(32)]),null);
        now+=901000;assert(!allowed(old));assert.strictEqual(b.audio_connection(undefined),null);
    });

    it('changes the upstream without taking ownership of central helper leases', async function() {
        const s=service(),b=s.broker,releases=[];
        b.request=async(...values)=>{releases.push(values);return {};};
        await s.reconfigure_connection(config({url:'http://new.example:8077'}));
        assert.strictEqual(s.helpers.central,true);
        assert.strictEqual(s.helpers.state,undefined);
        assert.strictEqual(s.helpers.broker.config.base_url,'http://new.example:8077');
        assert.deepStrictEqual(releases,[]);
    });

    it('uses a separate persistent cache index for a different upstream', async function() {
        const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bts-runtime-cache-'));
        const s=service({cache_enabled:true,cache_dir:directory}),b=s.broker;
        try {
            const old=b.disk;await old.ready;
            await s.reconfigure_connection(config({url:'http://new.example:8077'}));await b.disk.ready;
            assert.notStrictEqual(b.disk,old);assert.notStrictEqual(b.disk.index,old.index);
            assert.strictEqual(old.config.base_url,'http://old.example:8077');
            assert.strictEqual(b.audio_connection(undefined).disk,old);
            const second=b.disk;
            await s.reconfigure_connection(config({url:'http://third.example:8077',enabled:false}));
            assert.strictEqual(b.disk,null);assert.strictEqual(second.config.base_url,'http://new.example:8077');
            await s.reconfigure_connection(config({url:'http://third.example:8077'}));await b.disk.ready;
            assert.notStrictEqual(b.disk.index,second.index);assert.strictEqual(b.disk.config.base_url,'http://third.example:8077');
        } finally {s.stop();await fs.rm(directory,{recursive:true,force:true});}
    });

    it('resumes the previous loop when applying fails before the connection changes', async function() {
        const s=service(),b=s.broker;
        b.request=async(_url,_key,_method,pathname)=>pathname==='/health'?{status:'ready',model_revision:'1'}:{voices:[]};
        b.cycle=Promise.reject(new Error('disk_failure'));b.cycle.catch(()=>{});
        s.started=true;
        try {
            await assert.rejects(s.reconfigure_connection(config({url:'http://new.example:8077'})),/disk_failure/);
            assert.strictEqual(b.config.base_url,'http://old.example:8077');assert.strictEqual(b.stopped,false);assert.strictEqual(b.reconfiguring,false);
        } finally {s.stop();await b.cycle;}
    });
});
