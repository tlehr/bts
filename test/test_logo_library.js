'use strict';

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const {promisify} = require('util');
const database = require('../bts/database');
const logos = require('../bts/logo_library');

describe('Server logo library', function() {
 let directory, library, db;
 beforeEach(async function() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-logo-test-'));library = logos.create(directory);db = await database.init_test();
  await promisify(db.tournaments.insert.bind(db.tournaments))({key:'cup',logo_background_color:'#123456',logo_foreground_color:'#eeeeee'});
 });
 afterEach(async function() {await fs.rm(directory, {recursive:true,force:true});});
 it('keeps the original upload name after the logo is no longer assigned to a tournament', async function() {
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), id = await library.save(bytes, 'svg', 'Vereinslogo.svg');
  assert.deepStrictEqual(await fs.readFile(path.join(directory, id)), bytes);
  const catalogue = await library.list(db);
  assert.strictEqual(catalogue.length, 1);assert.strictEqual(catalogue[0].name, 'Vereinslogo.svg');assert.strictEqual(catalogue[0].id, id);
  assert(Number.isFinite(catalogue[0].uploaded_at));
 });
 it('includes older unassigned image files and recovers known names from tournaments and locations', async function() {
  for (const file of ['unassigned.png','tournament.jpg','hall.webp']) await fs.writeFile(path.join(directory,file),'image');
  await db.tournaments.update_async({key:'cup'},{$set:{logo_id:'tournament.jpg',logo_name:'Turnier.jpg'}},{});
  await promisify(db.locations.insert.bind(db.locations))({tournament_key:'cup',logo_id:'hall.webp',logo_name:'Halle.webp'});
  const items = await library.list(db), names = new Map(items.map(item=>[item.id,item.name]));
  assert.strictEqual(items.length,3);assert.strictEqual(names.get('unassigned.png'),'');assert.strictEqual(names.get('tournament.jpg'),'Turnier.jpg');assert.strictEqual(names.get('hall.webp'),'Halle.webp');
 });
 it('ignores metadata, unsupported files, directories and symbolic links', async function() {
  await library.save(Buffer.from('image'),'png','Logo.png');
  await fs.writeFile(path.join(directory,'readme.txt'),'note');await fs.mkdir(path.join(directory,'folder.png'));
  await fs.symlink(path.join(directory,'readme.txt'),path.join(directory,'linked.png'));
  assert.strictEqual((await library.list(db)).length,1);
 });
 it('omits generated QR codes from the gallery while keeping uploaded PNG logos and the QR files', async function() {
  const qrFiles = ['2026-11-04_y7EJu1lxERQ1N3db.png','2026-10-04_mb8BoIsf5KIF823n.png'];
  for (const file of qrFiles) await fs.writeFile(path.join(directory,file),'generated QR code');
  const id = await library.save(Buffer.from('uploaded logo'),'png',qrFiles[0]);
  const items = await library.list(db);
  assert.strictEqual(items.length,1);assert.strictEqual(items[0].id,id);assert.strictEqual(items[0].name,qrFiles[0]);
  for (const file of qrFiles) assert.strictEqual(await fs.readFile(path.join(directory,file),'utf8'),'generated QR code');
 });
 it('supports empty directories and a missing logo directory', async function() {
  assert.deepStrictEqual(await library.list(db),[]);await fs.rmdir(directory);assert.deepStrictEqual(await library.list(db),[]);
 });
 it('selects an existing image without copying it or changing either tournament color', async function() {
  const id = await library.save(Buffer.from('image'),'png','Auswahl.png'), files = await fs.readdir(directory);
  const props = await library.select(db,'cup',id), tournament = await db.tournaments.findOne_async({key:'cup'});
  assert.deepStrictEqual(props,{logo_id:id,logo_name:'Auswahl.png'});assert.strictEqual(tournament.logo_id,id);
  assert.strictEqual(tournament.logo_background_color,'#123456');assert.strictEqual(tournament.logo_foreground_color,'#eeeeee');
  assert.deepStrictEqual(await fs.readdir(directory),files);
 });
 it('can select an older logo even when it has no original filename or valid metadata', async function() {
  await fs.writeFile(path.join(directory,'old.gif'),'image');await fs.writeFile(path.join(directory,'old.gif.json'),'{unfinished');
  const props = await library.select(db,'cup','old.gif');assert.strictEqual(props.logo_id,'old.gif');assert(props.logo_name);
 });
 it('rejects paths, missing images, non-files and unknown tournaments without changing the selection', async function() {
  await fs.writeFile(path.join(directory,'regular.png'),'image');await fs.mkdir(path.join(directory,'folder.png'));
  await fs.symlink(path.join(directory,'regular.png'),path.join(directory,'linked.png'));
  for (const id of ['../regular.png','/tmp/regular.png','missing.png','folder.png','linked.png','image.txt',null,{id:'regular.png'}]) await assert.rejects(library.select(db,'cup',id));
  await assert.rejects(library.select(db,'missing','regular.png'),/Turnier/);
  assert.strictEqual((await db.tournaments.findOne_async({key:'cup'})).logo_id,undefined);
 });
 it('returns command errors to the caller and refreshes connected displays after selection', async function() {
  const admin = require('../bts/admin'), displays = require('../bts/bupws_v2'), originalSelect = logos.select, originalRefresh = displays.refresh_tournament;
  const calls = [], notifications = [], app = {db,speech:{changed:(...args)=>notifications.push(args)}};
  let response;
  const ws = {respond:(_message,error,value)=>{response={error,value};}};
  try {
   displays.refresh_tournament=async(_app,key)=>calls.push(key);
   logos.select=async()=>({logo_id:'regular.png',logo_name:'Original.png'});
   await admin.async_handle_tournament_select_logo(app,ws,{tournament_key:'cup',logo_id:'regular.png'});
   assert.deepStrictEqual(response.value,{logo_id:'regular.png',logo_name:'Original.png'});assert.strictEqual(response.error,null);
   assert.deepStrictEqual(notifications,[['cup','logo_changed',response.value]]);assert.deepStrictEqual(calls,['cup']);
   logos.select=async()=>{throw new Error('Das Logo ist nicht mehr vorhanden.');};
   await admin.async_handle_tournament_select_logo(app,ws,{tournament_key:'cup',logo_id:'missing.png'});
   assert.strictEqual(response.error.message,'Das Logo ist nicht mehr vorhanden.');assert.strictEqual(calls.length,1);
   await admin.async_handle_tournament_logo_list(app,ws,{tournament_key:'missing'});assert(response.error);
  } finally {logos.select=originalSelect;displays.refresh_tournament=originalRefresh;}
 });
 it('responds to upload failures for both tournament and location logos', async function() {
  const admin = require('../bts/admin'), originalSave = logos.save, responses = [];
  try {
   logos.save=async()=>{throw new Error('Synthetic storage failure');};
   const ws={respond:(_msg,error)=>responses.push(error)}, msg={tournament_key:'cup',location_id:'hall',name:'Logo.png',data_url:'data:image/png;base64,aW1hZ2U='};
   await admin.async_handle_tournament_upload_logo({db},ws,msg);
   await admin.async_handle_tournament_upload_location_logo({db},ws,msg);
   assert.strictEqual(responses.length,2);assert(responses.every(error=>error.message.includes('nicht hochgeladen')));
  } finally {logos.save=originalSave;}
 });
});
