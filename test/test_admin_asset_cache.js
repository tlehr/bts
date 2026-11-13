'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),zlib=require('zlib');
const create=require('../bts/admin_asset_cache');
describe('versioned admin assets',()=>{
 let root,cache,server,base;
 const html='<link href="/static/css/main.css"><script src="/bupdev/libs/old.js"></script><script src="/static/js/app.js"></script><link href="/static/css/seg7.ttf">';
 beforeEach(async()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'bts-asset-cache-'));
  for(const file of ['static/js/app.js','static/css/main.css','static/bup/dev/libs/old.js']){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),file.endsWith('.css')?'body{color:red}':'window.test="'+file+'";'+('/* unchanged scope */\n'.repeat(120)));}
  cache=create(root);server=http.createServer((req,res)=>cache.serve(req,res,error=>{res.writeHead(error?500:404);res.end();}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 });
 afterEach(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 const assets=value=>[...value.matchAll(/(?:src|href)="([^"]+)"/g)].map(match=>match[1]);
 const request=(url,headers={},method='GET')=>new Promise((resolve,reject)=>{const req=http.request(base+url,{method,headers},res=>{const chunks=[];res.on('data',part=>chunks.push(part));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();});
 it('preserves order, script scope and relative CSS URLs while versioning only entry CSS/JS',async()=>{
  const output=await cache.decorate(html),urls=assets(output);assert(urls.slice(0,3).every(url=>/bts_asset=[a-f0-9]{24}$/.test(url)));assert.equal(urls[3],'/static/css/seg7.ttf');assert(output.indexOf('old.js')<output.indexOf('app.js'));
  const diagnosed=assets(require('../bts/diagnostics/pages').html(output,'example')).find(url=>url.includes('app.js'));assert(diagnosed.includes('&v=example'));assert.equal((await request(diagnosed)).status,200);
  for(const url of urls.slice(0,3)){const res=await request(url);assert.equal(res.status,200);assert.match(res.headers['cache-control'],/immutable/);assert(res.body.equals(fs.readFileSync(path.join(root,url.startsWith('/bupdev/')?'static/bup/dev/'+url.split('?')[0].slice(8):url.split('?')[0]))));}
 });
 it('compresses bytes once without changing contents and supports explicit identity/quality',async()=>{
  const url=assets(await cache.decorate(html))[2],source=fs.readFileSync(path.join(root,'static/js/app.js'));
  for(const encoding of ['gzip','gzip;q=0.5']){const res=await request(url,{'accept-encoding':encoding});assert.equal(res.headers['content-encoding'],'gzip');assert(zlib.gunzipSync(res.body).equals(source));}
  const identity=await request(url,{'accept-encoding':'br,gzip;q=0'});assert(!identity.headers['content-encoding']);assert(identity.body.equals(source));
 });
 it('changes the address after edits and can still serve the exact previous release',async()=>{
  const original=assets(await cache.decorate(html))[2],bytes=(await request(original)).body;fs.appendFileSync(path.join(root,'static/js/app.js'),'\nwindow.changed=true;');
  const updated=assets(await cache.decorate(html))[2];assert.notEqual(updated,original);assert((await request(original)).body.equals(bytes));assert((await request(updated)).body.toString().endsWith('window.changed=true;'));
 });
 it('coalesces concurrent HTML loads and leaves unrelated references intact',async()=>{
  const values=await Promise.all(Array.from({length:12},()=>cache.decorate(html)));assert(values.every(value=>value===values[0]));assert.equal(await cache.decorate('<script src="https://example.invalid/a.js"></script>'),'<script src="https://example.invalid/a.js"></script>');
 });
 it('supports conditional GET and HEAD without sending a body',async()=>{
  const url=assets(await cache.decorate(html))[2],first=await request(url),notModified=await request(url,{'if-none-match':first.headers.etag}),head=await request(url,{},'HEAD');assert.equal(notModified.status,304);assert.equal(notModified.body.length,0);assert.equal(head.status,200);assert.equal(head.body.length,0);assert(Number(head.headers['content-length'])>0);
 });
 it('does not cache arbitrary paths, unversioned requests or writes',async()=>{
  fs.writeFileSync(path.join(root,'static/js/.hidden.js'),'private');
  await cache.decorate(html);for(const url of ['/static/js/app.js','/config.json?bts_asset='+('a'.repeat(24)),'/static/js/.hidden.js?bts_asset='+('a'.repeat(24)),'/static/js/absent.js?bts_asset='+('a'.repeat(24))]){const res=await request(url);assert.equal(res.status,404);assert(!res.headers['cache-control']);}
  assert.equal((await request(assets(await cache.decorate(html))[2],{},'POST')).status,404);
 });
 it('changes the measurement version when CSS or a referenced local font changes',async()=>{
  const page='<head>'+html+'</head>',version=value=>/name="bts-name-metrics" content="([a-f0-9]+)"/.exec(value)[1];
  fs.writeFileSync(path.join(root,'static/css/font.ttf'),'font-v1');
  fs.writeFileSync(path.join(root,'static/css/main.css'),'@font-face{font-family:test;src:url("font.ttf")} body{color:red}');
  const first=version(await cache.decorate(page));assert.equal(version(await cache.decorate(page)),first);
  fs.appendFileSync(path.join(root,'static/css/font.ttf'),'font-v2');const second=version(await cache.decorate(page));assert.notEqual(second,first);
  fs.appendFileSync(path.join(root,'static/css/main.css'),'body{color:blue}');assert.notEqual(version(await cache.decorate(page)),second);
 });
 it('redirects obsolete addresses after a restart instead of caching new bytes under an old hash',async()=>{
  const old=assets(await cache.decorate(html))[2];fs.appendFileSync(path.join(root,'static/js/app.js'),'changed');cache=create(root);const res=await request(old),updated=assets(await cache.decorate(html))[2];assert.equal(res.status,302);assert.equal(res.headers.location,updated);assert.equal(res.headers['cache-control'],'no-store');
 });
});

describe('admin entry page cache integration',()=>{
 it('keeps HTML fresh and serves fingerprinted scripts through the real BTS router',async()=>{
  const db=await require('../bts/database').init_test();
  const app=require('../bts/bts').create_app({port:0,host:'127.0.0.1',bup_location:'static/bup/dev',report_errors:false,diagnostics:{enabled:false},speech:{enabled:false}},db);
  const server=app.wss.options.server;if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const request=url=>new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:server.address().port,path:url,agent:false},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));}).on('error',reject);});
  try {
   const first=await request('/admin/t/example/');assert.equal(first.status,200);assert.match(first.headers['cache-control'],/no-store/);
   const url=/src="(\/static\/js\/cadmin\.js\?bts_asset=[a-f0-9]{24})"/.exec(first.body.toString())?.[1];assert(url);
   const asset=await request(url);assert.equal(asset.status,200);assert.match(asset.headers['cache-control'],/immutable/);assert(asset.body.equals(fs.readFileSync(path.join(__dirname,'../static/js/cadmin.js'))));
   assert.equal((await request('/admin/t/example/')).body.toString(),first.body.toString());
  }finally{app.wss.close();await new Promise(resolve=>server.close(resolve));}
 });
});
