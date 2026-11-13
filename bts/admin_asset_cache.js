'use strict';

// Fingerprint the entry page's public assets without concatenating scripts or
// changing their scope/order. Tournament data and the HTML remain uncached.
const fs=require('fs').promises,path=require('path'),crypto=require('crypto'),zlib=require('zlib'),{promisify}=require('util');
const gzip=promisify(zlib.gzip);
module.exports=function createAdminAssetCache(root) {
 const files=new Map(),versions=new Map(),pending=new Map();let retained=0;
 const assetPattern=/(?:src|href)="((?:\/static\/(?:js|css)\/|\/bupdev\/(?:js|libs)\/)[^"?#]+\.(?:js|css))"/g;
 const filename=url=>path.join(root,url.startsWith('/bupdev/')?'static/bup/dev/'+url.slice(8):url);
 const remember=(url,entry)=>{
  const key=url+'?bts_asset='+entry.hash;if(versions.has(key))return;
  versions.set(key,entry);retained+=entry.bytes.length;
  while(retained>8*1024*1024&&versions.size>1){const oldest=versions.keys().next().value;retained-=versions.get(oldest).bytes.length;versions.delete(oldest);}
 };
 async function read(url) {
  if(pending.has(url))return pending.get(url);
  const request=(async()=>{
   const file=filename(url),stat=await fs.stat(file),signature=[stat.size,stat.mtimeMs,stat.ctimeMs].join('|');let entry=files.get(url);
   if(entry?.signature!==signature){const bytes=await fs.readFile(file);entry={signature,bytes,hash:crypto.createHash('sha256').update(bytes).digest('hex').slice(0,24),type:path.extname(file)==='.css'?'text/css; charset=utf-8':path.extname(file)==='.ttf'?'font/ttf':'text/javascript; charset=utf-8'};files.set(url,entry);}
   remember(url,entry);return entry;
  })();pending.set(url,request);
  try{return await request;}finally{pending.delete(url);}
 }
 async function decorate(html) {
  const urls=[...new Set([...html.matchAll(assetPattern)].map(match=>match[1]))];
  const entries=await Promise.all(urls.map(async url=>[url,await read(url)]));
  const hashes=new Map(entries.map(([url,entry])=>[url,entry.hash])),fontUrls=new Set();
  for(const [url,entry]of entries)if(url.endsWith('.css')) {
   for(const match of entry.bytes.toString().matchAll(/url\(["']?([^"'()?#]+\.(?:woff2?|ttf|otf))(?:\?[^"'()]*)?["']?\)/g)) {
    const font=new URL(match[1],'http://localhost'+url);
    if(font.origin==='http://localhost')fontUrls.add(font.pathname);
   }
  }
  const fonts=await Promise.all([...fontUrls].sort().map(async url=>{
   try {const stat=await fs.stat(filename(url));return[url,stat.size,stat.mtimeMs,stat.ctimeMs];}
   catch(error){if(error.code==='ENOENT')return[url,'absent'];throw error;}
  }));
  const metricsVersion=crypto.createHash('sha256').update(JSON.stringify([[...hashes],fonts])).digest('hex');
  return html.replace(assetPattern,(match,url)=>match.replace(url,url+'?bts_asset='+hashes.get(url)))
   .replace(/<head([^>]*)>/i,'<head$1><meta name="bts-name-metrics" content="'+metricsVersion+'">');
 }
 async function serve(req,res,next) {
  try {
   if(!['GET','HEAD'].includes(req.method)||!req.url.includes('bts_asset='))return next();
   const url=new URL(req.url,'http://localhost'),hash=url.searchParams.get('bts_asset');
   if(!/^[a-f0-9]{24}$/.test(hash||'')||url.pathname.split('/').some(part=>part.startsWith('.'))||!/^\/(?:static\/(?:js|css)|bupdev\/(?:js|libs))\/[\w./-]+\.(?:js|css)$/.test(url.pathname))return next();
   let entry=versions.get(url.pathname+'?bts_asset='+hash);
   if(!entry){entry=await read(url.pathname);if(entry.hash!==hash){res.writeHead(302,{'Location':url.pathname+'?bts_asset='+entry.hash,'Cache-Control':'no-store'});res.end();return;}}
   res.setHeader('Content-Type',entry.type);res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.setHeader('ETag','W/"'+entry.hash+'"');res.setHeader('Vary','Accept-Encoding');
   if((req.headers['if-none-match']||'').split(',').map(value=>value.trim()).some(value=>value==='*'||value.replace(/^W\//,'')==='"'+entry.hash+'"')){res.writeHead(304);res.end();return;}
   let bytes=entry.bytes;
   if(entry.bytes.length>1024&&(req.headers['accept-encoding']||'').split(',').some(value=>/^gzip(?:\s*;\s*q=(?:1(?:\.0*)?|0?\.\d*[1-9]\d*))?$/i.test(value.trim()))){
    entry.gzip??=gzip(entry.bytes).catch(error=>{entry.gzip=null;throw error;});bytes=await entry.gzip;res.setHeader('Content-Encoding','gzip');
   }
   res.setHeader('Content-Length',bytes.length);res.writeHead(200);res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){next(error.code==='ENOENT'?undefined:error);}
 }
 return {decorate,serve};
};
