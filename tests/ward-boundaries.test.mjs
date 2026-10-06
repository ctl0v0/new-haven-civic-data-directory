import test from 'node:test';
import assert from 'node:assert/strict';
import {wardCoverage,validPolygon,containsPoint} from '../scripts/verify-ward-boundaries.mjs';
const ring=[[-72.95,41.3],[-72.94,41.3],[-72.94,41.31],[-72.95,41.31],[-72.95,41.3]];
const feature=ward=>({attributes:{WARD:ward},geometry:{rings:[ring]}});
test('coverage rejects duplicates, absent wards and unclosed geometry',()=>{
 const good=Array.from({length:30},(_,i)=>feature(i+1));assert.equal(wardCoverage(good,'WARD').length,30);
 assert.throws(()=>wardCoverage(good.slice(1),'WARD'),/coverage/);
 assert.throws(()=>wardCoverage([...good.slice(1),feature(2)],'WARD'),/coverage/);
 assert.equal(validPolygon({geometry:{rings:[ring.slice(1)]}}),false);
});
test('point-in-polygon handles holes and locations outside a polygon',()=>{
 const point={x:-72.945,y:41.305};assert.equal(containsPoint([ring],point),true);
 assert.equal(containsPoint([ring],{x:-72.96,y:41.305}),false);
 const hole=[[-72.946,41.304],[-72.944,41.304],[-72.944,41.306],[-72.946,41.306],[-72.946,41.304]];
 assert.equal(containsPoint([ring,hole],point),false);
});
