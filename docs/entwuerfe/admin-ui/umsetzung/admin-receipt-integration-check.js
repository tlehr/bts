'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const WebSocket=require('ws');
const root=path.resolve(__dirname,'../../../..');
const clientRoot=process.env.BTS_TESTCLIENT_DIR||path.resolve(root,'../bts-testclient');
const {BrowserAdminSocket}=require(path.join(clientRoot,'src/reception/browser_admin'));
const ReceptionTransport=require(path.join(clientRoot,'src/reception/transport'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 let server,wss,browser,transport;
 const scores=[],errors=[];
 try {
  server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://local');let file=path.resolve(root,'.'+url.pathname);
   if(url.pathname.startsWith('/admin/t/preview/')) {
    const html=fs.readFileSync(path.join(root,'static/cbts.html'),'utf8').replaceAll('{{static_path}}','/static/').replaceAll('{{root_path}}','/').replaceAll('{{app_root}}','/admin/').replaceAll('{{error_reporting}}','false').replace(/<script src="[^"]*cadmin.js"><\/script>/,'')+'<script src="/fixture.js"></script>';
    res.writeHead(200,{'Content-Type':'text/html'});res.end(html);return;
   }
   if(url.pathname==='/fixture.js') {res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fs.readFileSync(path.join(__dirname,'fixture.js'),'utf8')+';conn_ui.ui_connect();');return;}
   if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
   if(url.pathname.startsWith('/bup/'))file=path.join(root,'static/bup/dev',url.pathname.slice(5));
   if(url.pathname.startsWith('/bupdev/'))file=path.join(root,'static/bup/dev',url.pathname.slice(8));
   if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
   try {fs.statSync(file);const ext=path.extname(file);res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.xml':'application/xml'}[ext]||'application/octet-stream'});fs.createReadStream(file).pipe(res);}catch{res.writeHead(404);res.end();}
  });
  wss=new WebSocket.Server({server});
  wss.on('connection',socket=>socket.on('message',raw=>{
   const msg=JSON.parse(raw);
   if(msg.type==='test_point')for(const score of msg.scores)socket.send(JSON.stringify({type:'change',tournament_key:'preview',ctype:'score',val:{match_id:'match-44',network_score:[score],presses:[],now_on_court:true,court_id:'CH_1'}}));
   socket.send(JSON.stringify({type:'answer',rid:msg.rid,status:'ok'}));
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  transport=new ReceptionTransport({tournamentKey:'preview'});await transport.ready;
  browser=new transport.WebSocket('ws://127.0.0.1:'+server.address().port+'/ws/admin','bts-admin',{render_updates:true});
  assert(browser instanceof BrowserAdminSocket,'The measured Admin transport must use the real page');
  browser.on('error',error=>errors.push(error.message));
  browser.on('message',(raw,_binary,timing)=>{const message=JSON.parse(raw);if(message.ctype==='score')scores.push({message,timing})});
  await new Promise((resolve,reject)=>{browser.once('open',resolve);browser.once('error',reject)});
  await browser.cdp.evaluate(`window.__originalRoute=crouting.on_change;crouting.on_change=message=>{if(message.ctype==='score'){const until=performance.now()+80;while(performance.now()<until){}}return __originalRoute(message)}`);
  const start=Date.now();browser.send(JSON.stringify({type:'test_point',rid:11,scores:[[8,8]]}));
  await delay(35);assert.strictEqual(scores.length,0,'Reception must not be acknowledged before the slow UI change');
  await transport.flush();
  for(let i=0;i<100&&scores.length<1;i++)await delay(20);
  assert.strictEqual(scores[0].timing.presentation_status,'presented');assert(scores[0].timing.timings.handler_ms>=80);
  assert(scores[0].timing.presented_at-start>=80);assert.strictEqual(await browser.cdp.evaluate(`document.querySelector('tr[data-match_id="match-44"] .match_score').textContent`),'8:8');
  await browser.cdp.evaluate(`crouting.on_change=__originalRoute;Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})`);
  browser.send(JSON.stringify({type:'test_point',rid:12,scores:[[9,8]]}));
  for(let i=0;i<100&&scores.length<2;i++)await delay(20);
  assert.strictEqual(scores[1].timing.presentation_status,'hidden');assert.strictEqual(scores[1].timing.presented_at,null);
  await browser.cdp.evaluate(`delete document.hidden`);
  browser.send(JSON.stringify({type:'test_point',rid:13,scores:[[10,8],[11,8]]}));
  for(let i=0;i<100&&scores.length<4;i++)await delay(20);
  assert(scores.some(row=>row.timing.presentation_status==='superseded'));assert.strictEqual(scores.at(-1).timing.presentation_status,'presented');
  assert.strictEqual(await browser.cdp.evaluate(`document.querySelector('tr[data-match_id="match-44"] .match_score').textContent`),'11:8');
  await browser.cdp.evaluate(`window.__busyBoard=cleitstand.isUpdating;window.__busyTournament=ctournament.isUpdating;cleitstand.isUpdating=()=>true;ctournament.isUpdating=()=>true`);
  await transport.flush();
  await browser.cdp.evaluate(`cleitstand.isUpdating=__busyBoard;ctournament.isUpdating=__busyTournament`);
  assert.deepStrictEqual(errors,[]);assert.strictEqual(transport.snapshot().method,'browser-admin-render-and-worker-tv-reception');
  console.log(JSON.stringify({checks:10,scope:'Echte Browserseite, echter lokaler WebSocket, isolierte Fixture; keine laufenden Dienste.',slow_update_ms:scores[0].timing.timings,outcomes:scores.map(row=>row.timing.presentation_status)},null,2));
 } finally {
  await browser?.dispose();await transport?.close();if(wss){for(const socket of wss.clients)socket.terminate();await new Promise(resolve=>wss.close(resolve))}if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1});
