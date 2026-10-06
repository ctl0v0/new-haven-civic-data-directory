import test from 'node:test';import assert from 'node:assert/strict';import {interpret} from '../scripts/validate-sources.mjs';
test('source availability, schema changes and extraction warnings stay distinct',()=>{
 const result=value=>({status:0,stdout:JSON.stringify(value)});
 assert.equal(interpret(result({status:'passed',warnings:['Blank ward identifier']})).status,'passed');
 assert.equal(interpret(result({status:'failed',httpStatus:403,reason:'Rejected'})).status,'blocked');
 assert.equal(interpret(result({status:'failed',reason:'Missing field schema'})).status,'changed');
 assert.equal(interpret(result({status:'passed',metadata:{missingRequestedFields:['parcel_id']}})).status,'changed');
 assert.equal(interpret({status:1,stdout:''}).status,'changed');
 assert.equal(interpret({error:Error('timeout')}).status,'unavailable');
});
