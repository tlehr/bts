'use strict';

const fs = require('fs').promises;
const path = require('path');
const uuid = require('uuid/v4');
const utils = require('./utils');
const extensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);
// bupws.create_event_representation stores fallback QR codes as <date>_<tournament id>.png.
const generatedQrFilename = /^\d{4}-\d{2}-\d{2}_[a-zA-Z0-9]+\.png$/;

function create(directory = path.join(utils.root_dir(), 'data', 'logos')) {
 function valid(id) {
  return typeof id === 'string' && id.length <= 255 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|gif|svg|webp)$/.test(id);
 }
 async function names(db) {
  const rows = await Promise.all([db.tournaments.find_async({logo_id:{$exists:true}}, {logo_id:1,logo_name:1}), db.locations.find_async({logo_id:{$exists:true}}, {logo_id:1,logo_name:1})]);
  const result = new Map();
  for (const row of rows.flat()) if (row.logo_id && typeof row.logo_name === 'string' && row.logo_name) result.set(row.logo_id, row.logo_name);
  return result;
 }
 async function entry(id, knownNames) {
  if (!valid(id)) throw new Error('Ungültiges Logo.');
  let stat;
  try {stat = await fs.lstat(path.join(directory, id));}
  catch (error) {if (error.code === 'ENOENT') throw new Error('Das Logo ist nicht mehr vorhanden.');throw error;}
  if (!stat.isFile()) throw new Error('Ungültiges Logo.');
  let metadata;
  try {metadata = JSON.parse(await fs.readFile(path.join(directory, id + '.json'), 'utf8'));}
  catch (error) {if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;}
  const name = typeof metadata?.name === 'string' ? metadata.name : knownNames.get(id) || '';
  return {id, name, uploaded_at:Number.isFinite(metadata?.uploaded_at) ? metadata.uploaded_at : stat.mtimeMs};
 }
 async function save(buffer, extension, name) {
  if (!extensions.has(extension)) throw new Error('Nicht unterstütztes Bildformat.');
  const id = uuid() + '.' + extension;
  await fs.mkdir(directory, {recursive:true});
  await fs.writeFile(path.join(directory, id), buffer, {flag:'wx'});
  await fs.writeFile(path.join(directory, id + '.json'), JSON.stringify({name:String(name || ''), uploaded_at:Date.now()}), {flag:'wx'});
  return id;
 }
 async function list(db) {
  let files;
  try {files = await fs.readdir(directory, {withFileTypes:true});}
  catch (error) {if (error.code === 'ENOENT') return [];throw error;}
  const knownNames = await names(db), result = [];
  for (const file of files) if (file.isFile() && valid(file.name) && !generatedQrFilename.test(file.name)) {
   try {result.push(await entry(file.name, knownNames));}
   catch (error) {if (error.message !== 'Das Logo ist nicht mehr vorhanden.') throw error;}
  }
  return result.sort((a, b) => b.uploaded_at - a.uploaded_at || a.id.localeCompare(b.id));
 }
 async function select(db, key, id) {
  if (typeof key !== 'string' || !key) throw new Error('Das Turnier fehlt.');
  const tournament = await db.tournaments.findOne_async({key});
  if (!tournament) throw new Error('Das Turnier wurde nicht gefunden.');
  const logo = await entry(id, await names(db));
  const props = {logo_id:logo.id, logo_name:logo.name || 'Gespeichertes Logo'};
  const [updated] = await db.tournaments.update_async({key}, {$set:props}, {});
  if (!updated) throw new Error('Das Turnier wurde nicht gefunden.');
  return props;
 }
 return {save, list, select};
}

module.exports = {...create(), create};
