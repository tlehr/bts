'use strict';

const assert = require('assert');
const admin = require('../bts/admin');
const panels = require('../bts/bupws');

describe('Advertisement save responses', function() {
 let originalAdd, originalRemove, broadcasts, changes, app;
 beforeEach(function() {
  originalAdd = panels.send_advertisement_add;originalRemove = panels.send_advertisement_remove;
  broadcasts = [];changes = [];
  panels.send_advertisement_add = async (...args) => broadcasts.push(['add', ...args.slice(1)]);
  panels.send_advertisement_remove = async (...args) => broadcasts.push(['remove', ...args.slice(1)]);
  app = {db:{advertisements:{}}, speech:{changed:(...args) => changes.push(args)}};
 });
 afterEach(function() {panels.send_advertisement_add = originalAdd;panels.send_advertisement_remove = originalRemove;});
 function command(handler, message) {
  return new Promise(resolve => handler(app, {respond:(request, error, value) => resolve({request,error,value})}, message));
 }
 it('acknowledges a successful insert with the persisted identity used by the live notification', async function() {
  const advertisement = {id:'public-ad',type:'image',url:'/static/icons/court.svg',disabled:false}, persisted = {...advertisement,_id:'database-ad'};
  app.db.advertisements.insert = (record, callback) => {assert.deepStrictEqual(record,advertisement);setImmediate(() => callback(null,persisted));};
  const request = {tournament_key:'cup',advertisement}, response = await command(admin.handle_advertisement_add,request);
  assert.strictEqual(response.request,request);assert.strictEqual(response.error,null);assert.deepStrictEqual(response.value,{advertisement:persisted});
  assert.deepStrictEqual(changes,[['cup','advertisement_add',{advertisement:persisted}]]);
  assert.deepStrictEqual(broadcasts,[['add','cup',persisted]]);
 });
 it('reports insert errors without announcing an advertisement that was not saved', async function() {
  const error = new Error('Storage unavailable');app.db.advertisements.insert = (_record,callback) => callback(error);
  const response = await command(admin.handle_advertisement_add,{tournament_key:'cup',advertisement:{id:'new'}});
  assert.strictEqual(response.error,error);assert.deepStrictEqual(changes,[]);assert.deepStrictEqual(broadcasts,[]);
 });
 it('acknowledges deletion after storage succeeds and notifies the displays', async function() {
  app.db.advertisements.remove = (query,options,callback) => {assert.deepStrictEqual(query,{_id:'database-ad'});assert.deepStrictEqual(options,{});setImmediate(() => callback(null,1));};
  const response = await command(admin.handle_advertisement_remove,{tournament_key:'cup',advertisement_id:'database-ad'});
  assert.strictEqual(response.error,null);assert.deepStrictEqual(response.value,{});
  assert.deepStrictEqual(changes,[['cup','advertisement_removed',{advertisement_id:'database-ad'}]]);
  assert.deepStrictEqual(broadcasts,[['remove','cup','database-ad']]);
 });
 it('reports deletion errors without removing the advertisement from connected clients', async function() {
  const error = new Error('Storage unavailable');app.db.advertisements.remove = (_query,_options,callback) => callback(error);
  const response = await command(admin.handle_advertisement_remove,{tournament_key:'cup',advertisement_id:'database-ad'});
  assert.strictEqual(response.error,error);assert.deepStrictEqual(changes,[]);assert.deepStrictEqual(broadcasts,[]);
 });
});
