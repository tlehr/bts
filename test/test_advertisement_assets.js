'use strict';

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const {promisify} = require('util');
const database = require('../bts/database');
const assets = require('../bts/advertisement_assets');
const utils = require('../bts/utils');

describe('Advertisement file uploads', function() {
 let directory, app, server, base;
 const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 const mp4 = Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(24)]);
 beforeEach(async function() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(),'bts-advertisement-upload-'));
  app = express();app.db = await database.init_test();
  await promisify(app.db.tournaments.insert.bind(app.db.tournaments))({key:'cup'});
  assets.create({directory,maxBytes:4096}).register(app);
  server = http.createServer(app);await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));base = 'http://127.0.0.1:' + server.address().port;
 });
 afterEach(async function() {
  server.closeAllConnections();await new Promise(resolve => server.close(resolve));await fs.rm(directory,{recursive:true,force:true});
 });
 async function upload(bytes, name = 'Sponsor.png', key = 'cup') {
  const response = await fetch(base + '/h/' + key + '/advertisements/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name)},body:bytes});
  return {status:response.status,body:await response.json()};
 }
 async function waitForNoFiles() {
  for (let i=0;i<50;i++) {if (!(await fs.readdir(directory)).length) return;await new Promise(resolve => setTimeout(resolve,10));}
  assert.deepStrictEqual(await fs.readdir(directory),[]);
 }
 async function withService(service, check) {
  const isolated = express();isolated.db = app.db;isolated.diagnostics = app.diagnostics;service.register(isolated);
  const listener = http.createServer(isolated);
  await new Promise(resolve => listener.listen(0,'127.0.0.1',resolve));
  try {await check('http://127.0.0.1:' + listener.address().port);}
  finally {listener.closeAllConnections();await new Promise(resolve => listener.close(resolve));}
 }
 it('uploads with the default storage layout while preserving the advertisements database file', async function() {
  const data = path.join(directory,'data'), databaseFile = path.join(data,'advertisements'), contents = '{"id":"existing-advertisement"}\n';
  await fs.mkdir(data);await fs.writeFile(databaseFile,contents);
  const originalRoot = utils.root_dir;let service;
  try {utils.root_dir = () => directory;service = assets.create();}
  finally {utils.root_dir = originalRoot;}
  await withService(service,async url => {
   const response = await fetch(url + '/h/cup/advertisements/upload',{method:'POST',body:png});
   const result = await response.json();assert.strictEqual(response.status,201,JSON.stringify(result));
   assert.strictEqual(await fs.readFile(databaseFile,'utf8'),contents);
   assert.deepStrictEqual(await fs.readFile(path.join(data,'advertisement_assets',result.advertisement.asset_id)),png);
   assert.deepStrictEqual(Buffer.from(await (await fetch(url + result.advertisement.url)).arrayBuffer()),png);
   const library = await (await fetch(url + '/h/cup/advertisements/library')).json();
   assert.strictEqual(library.assets[0].id,result.advertisement.asset_id);
  });
 });
 it('explains and logs a storage path collision without overwriting the existing file', async function() {
  const occupied = path.join(directory,'occupied'), entries = [];
  await fs.writeFile(occupied,'database');app.diagnostics = {record:entry => entries.push(entry)};
  await withService(assets.create({directory:occupied}),async url => {
   const response = await fetch(url + '/h/cup/advertisements/upload',{method:'POST',body:png}), error = await response.json();
   assert.strictEqual(response.status,500);assert.strictEqual(error.code,'EEXIST');
   assert(error.message.includes('durch eine Datei belegt'));assert.strictEqual(error.stage,'Speicherordner anlegen');
   assert(error.details.includes('EEXIST'));assert(error.details.includes(occupied));
  });
  assert.strictEqual(await fs.readFile(occupied,'utf8'),'database');assert.deepStrictEqual(await app.db.advertisements.find_async({}),[]);
  assert.strictEqual(entries.length,1);assert.strictEqual(entries[0].level,'error');assert.strictEqual(entries[0].tournament_key,'cup');
  assert(entries[0].message.includes('EEXIST'));
 });
 it('persists the original filename and media bytes and immediately registers the advertisement', async function() {
  const result = await upload(png,'../Sponsör Ü.png');assert.strictEqual(result.status,201);
  const ad = result.body.advertisement;assert.strictEqual(ad.name,'Sponsör Ü.png');assert.strictEqual(ad.type,'image');assert.strictEqual(ad.disabled,false);
  assert(ad._id);assert.strictEqual((await app.db.advertisements.findOne_async({_id:ad._id})).url,ad.url);
  assert.deepStrictEqual(await fs.readFile(path.join(directory,ad.asset_id)),png);
  assert.deepStrictEqual((await fs.readdir(directory)).sort(),[ad.asset_id,ad.asset_id + '.json']);
  const metadata = JSON.parse(await fs.readFile(path.join(directory,ad.asset_id + '.json'),'utf8'));assert.strictEqual(metadata.name,ad.name);assert(Number.isFinite(metadata.uploaded_at));
  const response = await fetch(base + ad.url);assert.strictEqual(response.status,200);assert.strictEqual(response.headers.get('content-type'),'image/png');
  assert.strictEqual(response.headers.get('x-content-type-options'),'nosniff');assert.deepStrictEqual(Buffer.from(await response.arrayBuffer()),png);
 });
 it('detects video files from their contents and serves byte ranges and HEAD requests', async function() {
  const {status,body} = await upload(mp4,'Film.mp4');assert.strictEqual(status,201);const ad = body.advertisement;
  assert.strictEqual(ad.type,'video_file_url');assert(ad.asset_id.endsWith('.mp4'));
  const response = await fetch(base + ad.url,{headers:{Range:'bytes=4-11'}});
  assert.strictEqual(response.status,206);assert.strictEqual(response.headers.get('content-type'),'video/mp4');
  assert.strictEqual(response.headers.get('content-range'),'bytes 4-11/' + mp4.length);assert.deepStrictEqual(Buffer.from(await response.arrayBuffer()),mp4.subarray(4,12));
  const head = await fetch(base + ad.url,{method:'HEAD'});assert.strictEqual(head.status,200);assert.strictEqual(Number(head.headers.get('content-length')),mp4.length);
  assert.strictEqual((await head.arrayBuffer()).byteLength,0);
 });
 it('recognizes JPEG, GIF, WebP and WebM as well as PNG and MP4', async function() {
  const files = [[Buffer.from([255,216,255,224]),'jpeg','jpg','image'],[Buffer.from('GIF89a'),'gif','gif','image'],
   [Buffer.from('RIFF1234WEBP'),'webp','webp','image'],[Buffer.concat([Buffer.from([26,69,223,163]),Buffer.from('DocTypewebm')]),'webm','webm','video_file_url']];
  for (const [bytes,name,extension,type] of files) {
   const result = await upload(bytes,'Sponsor.' + name);assert.strictEqual(result.status,201);
   assert(result.body.advertisement.asset_id.endsWith('.' + extension));assert.strictEqual(result.body.advertisement.type,type);
  }
 });
 it('uses the detected format even when the uploaded name has the wrong extension', async function() {
  const {body} = await upload(png,'Bild.mp4');assert.strictEqual(body.advertisement.type,'image');assert(body.advertisement.asset_id.endsWith('.png'));
 });
 it('rejects empty, unsupported and disguised files and removes temporary data', async function() {
  for (const bytes of [Buffer.alloc(0),Buffer.from('<html>not an image</html>'),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypavif')])]) {
   assert.strictEqual((await upload(bytes,'Bild.png')).status,400);await waitForNoFiles();
  }
  assert.deepStrictEqual(await app.db.advertisements.find_async({}),[]);
 });
 it('rejects oversized requests before creating an advertisement', async function() {
  assert.strictEqual((await upload(Buffer.alloc(4097))).status,413);assert.deepStrictEqual(await app.db.advertisements.find_async({}),[]);await waitForNoFiles();
 });
 it('enforces the size limit for a chunked upload and still returns a useful response', async function() {
  const response = await new Promise((resolve,reject) => {
   const request = http.request(base + '/h/cup/advertisements/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream'}},response => {
    let body='';response.on('data',chunk => body+=chunk);response.on('end',() => resolve({status:response.statusCode,body:JSON.parse(body)}));
   });request.on('error',reject);request.write(png);request.write(Buffer.alloc(8192));request.end();
  });
  assert.strictEqual(response.status,413);assert(response.body.message.includes('groß'));await waitForNoFiles();
  assert.deepStrictEqual(await app.db.advertisements.find_async({}),[]);
 });
 it('does not retain an uploaded file when the database cannot save its entry', async function() {
  app.db.advertisements.insert = (_record,callback) => callback(new Error('Synthetic storage failure'));
  const result = await upload(png);assert.strictEqual(result.status,500);assert(!result.body.message.includes('Synthetic'));await waitForNoFiles();
  assert.strictEqual(result.body.stage,'Werbeeintrag in der Datenbank speichern');assert.strictEqual(result.body.details,'Synthetic storage failure');
 });
 it('explains exhausted server storage and cleans up the unsuccessful upload', async function() {
  app.db.advertisements.insert = (_record,callback) => callback(Object.assign(new Error('No space left on device'),{code:'ENOSPC'}));
  const result = await upload(png);assert.strictEqual(result.status,500);assert.strictEqual(result.body.code,'ENOSPC');
  assert(result.body.message.includes('kein Speicherplatz'));await waitForNoFiles();
 });
 it('cleans up a partial video after the client cancels the transfer', async function() {
  const request = http.request(base + '/h/cup/advertisements/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream'}});
  request.on('error',() => {});request.write(mp4);
  for (let i=0;i<50 && !(await fs.readdir(directory)).length;i++) await new Promise(resolve => setTimeout(resolve,10));
  assert((await fs.readdir(directory)).some(name => name.startsWith('.upload-')));request.destroy();await waitForNoFiles();
  assert.deepStrictEqual(await app.db.advertisements.find_async({}),[]);
 });
 it('does not write files for unknown tournaments or expose files through invalid asset IDs', async function() {
  assert.strictEqual((await upload(png,'Sponsor.png','missing')).status,404);await waitForNoFiles();
  for (const id of ['not-an-id.png','..%2F..%2Fconfig.json','00000000-0000-0000-0000-000000000000.png']) assert.strictEqual((await fetch(base + '/media/advertisements/' + id)).status,404);
 });
 async function catalogue(key = 'cup') {
  const response = await fetch(base + '/h/' + key + '/advertisements/library');return {status:response.status,body:await response.json()};
 }
 async function select(id, key = 'cup') {
  const response = await fetch(base + '/h/' + key + '/advertisements/library/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({asset_id:id})});
  return {status:response.status,body:await response.json()};
 }
 it('lists saved images and videos and marks entries already in the advertisement list', async function() {
  const image = (await upload(png,'Sponsor.png')).body.advertisement, video = (await upload(mp4,'Film.mp4')).body.advertisement;
  const result = await catalogue();assert.strictEqual(result.status,200);assert.strictEqual(result.body.assets.length,2);
  const items = new Map(result.body.assets.map(item => [item.id,item]));
  assert.strictEqual(items.get(image.asset_id).name,'Sponsor.png');assert.strictEqual(items.get(image.asset_id).advertisement_id,image._id);
  assert.strictEqual(items.get(video.asset_id).type,'video_file_url');assert.strictEqual(items.get(video.asset_id).size,mp4.length);
 });
 it('keeps the original name after removing an entry and reuses its existing file without uploading or copying it', async function() {
  const original = (await upload(png,'Alter Sponsor.png')).body.advertisement;
  await promisify(app.db.advertisements.remove.bind(app.db.advertisements))({_id:original._id},{});
  const files = await fs.readdir(directory), item = (await catalogue()).body.assets[0];
  assert.strictEqual(item.name,'Alter Sponsor.png');assert.strictEqual(item.advertisement_id,null);
  const response = await select(item.id);assert.strictEqual(response.status,200);const reused = response.body.advertisement;
  assert.notStrictEqual(reused._id,original._id);assert.strictEqual(reused.asset_id,original.asset_id);assert.strictEqual(reused.url,original.url);
  assert.strictEqual(reused.name,'Alter Sponsor.png');assert.strictEqual(reused.disabled,false);
  assert.deepStrictEqual(await fs.readdir(directory),files);assert.deepStrictEqual(await fs.readFile(path.join(directory,reused.asset_id)),png);
 });
 it('does not duplicate entries when an already-used asset is selected or concurrent requests overlap', async function() {
  const original = (await upload(mp4,'Film.mp4')).body.advertisement;
  await promisify(app.db.advertisements.remove.bind(app.db.advertisements))({_id:original._id},{});
  const responses = await Promise.all([select(original.asset_id),select(original.asset_id),select(original.asset_id)]);
  assert(responses.every(response => response.status === 200));assert.strictEqual(new Set(responses.map(response => response.body.advertisement._id)).size,1);
  const saved = responses[0].body.advertisement;assert.strictEqual((await app.db.advertisements.find_async({})).length,1);
  await app.db.advertisements.update_async({_id:saved._id},{$set:{disabled:true}},{});
  const repeat = await select(original.asset_id);assert.strictEqual(repeat.body.advertisement._id,saved._id);assert.strictEqual(repeat.body.advertisement.disabled,true);
 });
 it('keeps a reusable file intact if saving its new advertisement fails', async function() {
  const original = (await upload(png)).body.advertisement, insert = app.db.advertisements.insert;
  await promisify(app.db.advertisements.remove.bind(app.db.advertisements))({_id:original._id},{});
  app.db.advertisements.insert = (_record,callback) => callback(new Error('Synthetic failure'));
  assert.strictEqual((await select(original.asset_id)).status,500);
  assert.deepStrictEqual(await fs.readFile(path.join(directory,original.asset_id)),png);
  app.db.advertisements.insert = insert;assert.strictEqual((await select(original.asset_id)).status,200);
  assert.strictEqual((await app.db.advertisements.find_async({})).length,1);
 });
 it('recovers names of old uploads from existing entries and supports unnamed files or malformed metadata', async function() {
  const id = '00000000-0000-4000-8000-000000000001.png';await fs.writeFile(path.join(directory,id),png);
  await fs.writeFile(path.join(directory,id + '.json'),'{unfinished');
  const old = await promisify(app.db.advertisements.insert.bind(app.db.advertisements))({name:'Altes Logo.png',url:'/media/advertisements/' + id,type:'image'});
  assert.strictEqual((await catalogue()).body.assets[0].name,'Altes Logo.png');
  await promisify(app.db.advertisements.remove.bind(app.db.advertisements))({_id:old._id},{});
  const item = (await catalogue()).body.assets[0];assert.strictEqual(item.name,'');assert(Number.isFinite(item.uploaded_at));
  assert((await select(id)).body.advertisement.name.startsWith('Werbedatei vom '));
 });
 it('excludes incomplete uploads, directories, unsupported files, empty files and symbolic links from the library', async function() {
  await upload(png);await fs.writeFile(path.join(directory,'.upload-partial'),'partial');await fs.writeFile(path.join(directory,'note.txt'),'text');
  await fs.mkdir(path.join(directory,'00000000-0000-4000-8000-000000000002.png'));
  await fs.writeFile(path.join(directory,'00000000-0000-4000-8000-000000000003.png'),'');
  await fs.symlink(path.join(directory,'note.txt'),path.join(directory,'00000000-0000-4000-8000-000000000004.png'));
  assert.strictEqual((await catalogue()).body.assets.length,1);
 });
 it('returns an empty library for a missing directory and rejects invalid, missing or non-file selections', async function() {
  assert.deepStrictEqual((await catalogue()).body.assets,[]);await fs.rmdir(directory);assert.deepStrictEqual((await catalogue()).body.assets,[]);
  for (const id of ['../logo.png','00000000-0000-4000-8000-000000000005.png',null,{id:'file'}]) assert.strictEqual((await select(id)).status,404);
  assert.strictEqual((await catalogue('missing')).status,404);assert.strictEqual((await select('00000000-0000-4000-8000-000000000005.png','missing')).status,404);
  await fs.mkdir(directory);await fs.mkdir(path.join(directory,'00000000-0000-4000-8000-000000000006.png'));
  assert.strictEqual((await select('00000000-0000-4000-8000-000000000006.png')).status,404);
  assert.deepStrictEqual(await app.db.advertisements.find_async({}),[]);
 });
});
