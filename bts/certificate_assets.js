'use strict';
const fs = require('fs').promises, path = require('path'), crypto = require('crypto');
const {promisify} = require('util');
const utils = require('./utils');
const MAX_BYTES = 8 * 1024 * 1024;
function directory(app, key) {
 const root = app.certificate_assets_directory || path.join(utils.root_dir(), 'data', 'certificates');
 return path.join(root, crypto.createHash('sha256').update(key).digest('hex'));
}
function format(bytes) {
 if (bytes.subarray(0, 5).toString() === '%PDF-') return {mime: 'application/pdf', extension: 'pdf'};
 if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return {mime: 'image/png', extension: 'png'};
 if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return {mime: 'image/jpeg', extension: 'jpg'};
 return null;
}
async function upload(req, res) {
 try {
  const {tournament_key: key} = req.params;
  const tournament = await promisify(req.app.db.tournaments.findOne.bind(req.app.db.tournaments))({key});
  if (!tournament) return res.status(404).json({message: 'Turnier nicht gefunden.'});
  const bytes = req.body;
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) return res.status(400).json({message: 'Die Vorlage darf maximal 8 MB groß sein.'});
  const info = format(bytes);if (!info) return res.status(400).json({message: 'Bitte eine PDF-, PNG- oder JPEG-Vorlage verwenden.'});
  const id = crypto.createHash('sha256').update(bytes).digest('hex') + '.' + info.extension;
  const folder = directory(req.app, key);await fs.mkdir(folder, {recursive: true});
  try {await fs.writeFile(path.join(folder, id), bytes, {flag: 'wx'});} catch (err) {if (err.code !== 'EEXIST') throw err;}
  let name;try {name = decodeURIComponent(req.get('X-File-Name') || 'Vorlage');} catch (_) {name = 'Vorlage';}
  res.json({background: {id, mime: info.mime, name: path.basename(name).slice(0, 180)}});
 } catch (_) {res.status(500).json({message: 'Die Hintergrundvorlage konnte nicht gespeichert werden.'});}
}
function get(req, res) {
 const {tournament_key: key, asset_id: id} = req.params;
 if (!/^[a-f0-9]{64}\.(pdf|png|jpg)$/.test(id)) return res.status(404).end();
 res.set('X-Content-Type-Options', 'nosniff');res.set('Cache-Control', 'private, max-age=31536000, immutable');
 res.type(id.endsWith('.pdf') ? 'application/pdf' : id.endsWith('.png') ? 'image/png' : 'image/jpeg');
 res.sendFile(path.join(directory(req.app, key), id), err => {if (err && !res.headersSent) res.status(err.statusCode || 404).end();});
}
module.exports = {upload, get, MAX_BYTES};
