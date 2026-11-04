'use strict';

const fs = require('fs');
const path = require('path');
const {Transform} = require('stream');
const {pipeline} = require('stream/promises');
const {promisify} = require('util');
const uuid = require('uuid/v4');
const utils = require('./utils');
const MAX_BYTES = 250 * 1024 * 1024;
const assetPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|gif|webp|mp4|webm)$/;
const mimeTypes = {png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp',mp4:'video/mp4',webm:'video/webm'};

function format(bytes) {
 if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
 if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
 if (/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii'))) return 'gif';
 if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'webp';
 if (bytes.subarray(4,8).toString() === 'ftyp' && ['isom','iso2','mp41','mp42','avc1','M4V ','dash','msdh','msix'].includes(bytes.subarray(8,12).toString())) return 'mp4';
 if (bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])) && bytes.includes(Buffer.from('webm'))) return 'webm';
 return null;
}
function uploadError(message, status = 400) {return Object.assign(new Error(message), {status});}
function create({directory = path.join(utils.root_dir(),'data','advertisement_assets'), maxBytes = MAX_BYTES} = {}) {
 const fsp = fs.promises, selections = new Map();
 const mediaUrl = id => '/media/advertisements/' + id;
 const mediaType = id => /\.(mp4|webm)$/.test(id) ? 'video_file_url' : 'image';
 function respondError(req, res, error, stage, fallback) {
  const status = error.status || 500;
  const reasons = {
   EEXIST:'Der Speicherordner für Werbedateien ist bereits durch eine Datei belegt.',
   ENOTDIR:'Der Speicherpfad für Werbedateien enthält eine Datei statt eines Ordners.',
   EACCES:'BTS hat keine Berechtigung, auf den Speicherordner für Werbedateien zuzugreifen.',
   EPERM:'Das Betriebssystem verweigert BTS den Zugriff auf die Werbedateien.',
   ENOSPC:'Auf dem BTS-Server ist kein Speicherplatz mehr frei.',
   EDQUOT:'Das Speicherkontingent auf dem BTS-Server ist ausgeschöpft.',
   EROFS:'Der Speicherort für Werbedateien ist schreibgeschützt.',
  };
  const code = typeof error.code === 'string' ? error.code.slice(0,80) : undefined;
  const details = String(error.message || error).slice(0,1200);
  if (status >= 500) req.app.diagnostics?.record({source:'server',level:'error',tournament_key:req.params.tournament_key,
   message:'Werbedateien · ' + stage + (code ? ' · ' + code : '') + ': ' + details});
  if (!res.headersSent && !res.destroyed) res.status(status).json({message:error.status ? error.message : reasons[code] || fallback,code,stage,details});
 }
 async function tournament(db, key) {
  if (typeof key !== 'string' || !key || !await promisify(db.tournaments.findOne.bind(db.tournaments))({key})) throw uploadError('Turnier nicht gefunden.',404);
 }
 async function publish(app, key, advertisement) {
  require('./admin').notify_change(app,key,'advertisement_add',{advertisement});
  await require('./bupws').send_advertisement_add(app,key,advertisement);
 }
 async function entry(id, known = []) {
  if (typeof id !== 'string' || !assetPattern.test(id)) throw uploadError('Die Werbedatei wurde nicht gefunden.',404);
  let stat;
  try {stat = await fsp.lstat(path.join(directory,id));}
  catch (error) {if (error.code === 'ENOENT') throw uploadError('Die Werbedatei ist nicht mehr vorhanden.',404);throw error;}
  if (!stat.isFile() || !stat.size) throw uploadError('Die Werbedatei wurde nicht gefunden.',404);
  let metadata;
  try {metadata = JSON.parse(await fsp.readFile(path.join(directory,id + '.json'),'utf8'));}
  catch (error) {if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;}
  const current = known.find(ad => ad.asset_id === id || ad.url === mediaUrl(id));
  return {id,url:mediaUrl(id),type:mediaType(id),name:typeof metadata?.name === 'string' ? metadata.name : current?.name || '',
   uploaded_at:Number.isFinite(metadata?.uploaded_at) ? metadata.uploaded_at : stat.mtimeMs,size:stat.size,advertisement_id:current?._id || null};
 }
 async function list(db, key) {
  await tournament(db,key);
  let files;
  try {files = await fsp.readdir(directory,{withFileTypes:true});}
  catch (error) {if (error.code === 'ENOENT') return [];throw error;}
  const known = await promisify(db.advertisements.find.bind(db.advertisements))({}), result = [];
  for (const file of files) if (file.isFile() && assetPattern.test(file.name)) {
   try {result.push(await entry(file.name,known));}
   catch (error) {if (error.status !== 404) throw error;}
  }
  return result.sort((a,b) => b.uploaded_at-a.uploaded_at || a.id.localeCompare(b.id));
 }
 async function select(db, key, id) {
  await tournament(db,key);
  if (typeof id !== 'string' || !assetPattern.test(id)) throw uploadError('Die Werbedatei wurde nicht gefunden.',404);
  if (selections.has(id)) return {...await selections.get(id),inserted:false};
  const pending = (async () => {
   const current = await promisify(db.advertisements.findOne.bind(db.advertisements))({$or:[{asset_id:id},{url:mediaUrl(id)}]});
   const asset = await entry(id,current ? [current] : []);
   if (current) return {advertisement:current,inserted:false};
   const date = new Date(asset.uploaded_at).toLocaleDateString('de-DE');
   const advertisement = await promisify(db.advertisements.insert.bind(db.advertisements))({
    id:uuid(),asset_id:id,name:asset.name || 'Werbedatei vom ' + date,url:asset.url,type:asset.type,disabled:false,
   });
   return {advertisement,inserted:true};
  })();
  selections.set(id,pending);
  try {return await pending;} finally {selections.delete(id);}
 }
 async function upload(req, res) {
  let temporary, destination, metadataFile, saved = false, stage = 'Turnier prüfen';
  try {
   const key = req.params.tournament_key;
   await tournament(req.app.db,key);
   if (Number(req.get('Content-Length')) > maxBytes) {req.resume();throw uploadError('Die Datei ist zu groß. Maximal ' + Math.floor(maxBytes/1024/1024) + ' MB sind möglich.',413);}
   if (req.aborted) throw uploadError('Upload abgebrochen.');
   stage = 'Speicherordner anlegen';
   const id = uuid();await fsp.mkdir(directory,{recursive:true});if (req.aborted) throw uploadError('Upload abgebrochen.');temporary = path.join(directory,'.upload-' + id);
   let size = 0, header = Buffer.alloc(0);
   const meter = new Transform({transform(chunk,_encoding,callback) {
    size += chunk.length;
    if (size > maxBytes) return callback(uploadError('Die Datei ist zu groß. Maximal ' + Math.floor(maxBytes/1024/1024) + ' MB sind möglich.',413));
    if (header.length < 4096) header = Buffer.concat([header,chunk.subarray(0,4096-header.length)]);
    callback(null,chunk);
   }});
   const abort = () => meter.destroy(uploadError('Upload abgebrochen.'));
   const failed = error => meter.destroy(error);
   req.once('aborted',abort);req.once('error',failed);
   stage = 'Datei übertragen und speichern';
   try {req.pipe(meter);await pipeline(meter,fs.createWriteStream(temporary,{flags:'wx'}));}
   finally {req.unpipe(meter);req.removeListener('aborted',abort);req.removeListener('error',failed);if (!req.complete && !req.destroyed) req.resume();}
   stage = 'Dateiformat prüfen';const extension = format(header);
   if (!size || !extension) throw uploadError('Bitte ein Bild (PNG, JPG, GIF, WebP) oder ein Video (MP4, WebM) auswählen.');
   if (req.aborted || res.destroyed) throw uploadError('Upload abgebrochen.');
   const asset_id = id + '.' + extension;destination = path.join(directory,asset_id);
   stage = 'Datei übernehmen';await fsp.rename(temporary,destination);temporary = null;
   if (req.aborted || res.destroyed) throw uploadError('Upload abgebrochen.');
   let filename;try {filename = decodeURIComponent(req.get('X-File-Name') || 'Werbung.' + extension);} catch (_) {filename = 'Werbung.' + extension;}
   const name = filename.split(/[\\/]/).pop().replace(/\p{Cc}/gu,'').slice(0,180) || 'Werbung.' + extension;
   stage = 'Dateiinformationen speichern';
   metadataFile = destination + '.json';await fsp.writeFile(metadataFile,JSON.stringify({name,uploaded_at:Date.now()}),{flag:'wx'});
   stage = 'Werbeeintrag in der Datenbank speichern';
   const advertisement = await promisify(req.app.db.advertisements.insert.bind(req.app.db.advertisements))({
    id,asset_id,name,url:mediaUrl(asset_id),type:mediaType(asset_id),disabled:false,
   });
   saved = true;
   stage = 'Anzeigen benachrichtigen';await publish(req.app,key,advertisement);
   res.status(201).json({advertisement});
  } catch (error) {
   if (!req.complete && !req.destroyed) req.resume();
   respondError(req,res,error,stage,'Die Werbedatei konnte nicht gespeichert werden. Unter „Fehlerdetails“ steht die Ursache.');
  } finally {
   for (const file of [temporary,!saved && destination,!saved && metadataFile]) if (file) await fsp.unlink(file).catch(() => {});
  }
 }
 function get(req, res) {
  const id = req.params.asset_id;if (!assetPattern.test(id)) return res.status(404).end();
  res.set('X-Content-Type-Options','nosniff');res.set('Cache-Control','private, max-age=31536000, immutable');res.type(mimeTypes[id.split('.').pop()]);
  res.sendFile(path.join(directory,id),{acceptRanges:true},error => {if (error && !res.headersSent) res.status(error.statusCode || 404).end();});
 }
 function register(app) {
  app.post('/h/:tournament_key/advertisements/upload',upload);
  app.get('/h/:tournament_key/advertisements/library',async (req,res) => {
   try {res.json({assets:await list(req.app.db,req.params.tournament_key)});}
   catch (error) {respondError(req,res,error,'Gespeicherte Werbedateien laden','Die gespeicherten Werbedateien konnten nicht geladen werden.');}
  });
  app.post('/h/:tournament_key/advertisements/library/select',require('express').json({limit:'8kb'}),async (req,res) => {
   try {
    const key = req.params.tournament_key, result = await select(req.app.db,key,req.body?.asset_id);
    if (result.inserted) await publish(req.app,key,result.advertisement);
    res.json({advertisement:result.advertisement});
   } catch (error) {respondError(req,res,error,'Gespeicherte Werbedatei übernehmen','Die Werbedatei konnte nicht übernommen werden. Bitte erneut versuchen.');}
  });
  app.get('/media/advertisements/:asset_id',get);
 }
 return {register,upload,get,list,select};
}
module.exports = {...create(),create,MAX_BYTES};
