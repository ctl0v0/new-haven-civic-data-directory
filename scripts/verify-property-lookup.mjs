import {createHash} from 'node:crypto';
const layer='https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0';
const fields=['objectid','parcel_id','account_number','property_address','total_assessed_parcel_value_x','total_assessed_land_value','total_assessed_bldg_value'];
async function query(where){
 const url=new URL(layer+'/query');
 for(const [key,value] of Object.entries({f:'json',where,outFields:fields.join(','),returnGeometry:'false',resultRecordCount:'10'}))url.searchParams.set(key,value);
 const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('HTTP '+response.status);
 const data=await response.json();
 if(data.error)throw Error('API query error '+data.error.code);
 if(!Array.isArray(data.features))throw Error('Missing features response');
 if(data.exceededTransferLimit)throw Error('Address query returned too many rows');
 return {url:url.toString(),records:data.features.map(f=>f.attributes)};
}
const sqlValue=value=>typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const result={name:'Known public-address property lookup',checkedAt:new Date().toISOString(),input:'New Haven City Hall: 165 Church Street',scope:'Address filter and parcel/account repeat lookup; no geometry, joins, valuation-date or browser comparison'};
try{
 const initial=await query("UPPER(property_address) LIKE '165%CHURCH%'");
 result.addressQuery={url:initial.url,rowsReturned:initial.records.length};
 if(initial.records.length!==1)throw Error('Address filter did not return exactly one row');
 const record=initial.records[0];
 if(!/^165\s+CHURCH(?:\s|$)/i.test(String(record.property_address).trim()))throw Error('Returned address does not match the public-address input');
 const missing=fields.filter(field=>!Object.hasOwn(record,field));
 if(missing.length)throw Error('Missing expected fields: '+missing.join(','));
 result.identifiers={parcelPresent:record.parcel_id!=null&&String(record.parcel_id).trim()!=='',accountPresent:record.account_number!=null&&String(record.account_number).trim()!==''};
 if(!result.identifiers.parcelPresent||!result.identifiers.accountPresent)throw Error('Required identifier fields are empty');
 result.repeatLookups=[];
 for(const field of ['parcel_id','account_number']){
  const repeat=await query(field+' = '+sqlValue(record[field]));
  const same=repeat.records.length===1&&repeat.records[0].objectid===record.objectid&&fields.every(name=>repeat.records[0][name]===record[name]);
  result.repeatLookups.push({field,rowsReturned:repeat.records.length,sameRecordAndSelectedValues:same});
  if(!same)throw Error('Identifier lookup did not reproduce the same selected record fields');
 }
 result.assessmentFields=fields.filter(f=>f.startsWith('total_assessed')).map(field=>({field,present:true,isNull:record[field]===null,isNonnegativeNumber:typeof record[field]==='number'&&Number.isFinite(record[field])&&record[field]>=0}));
 result.warnings=['Assessment valuation date, current tax implications, reuse rights and Vision browser comparison remain unverified. One address does not prove general address matching or identifier uniqueness.'];
 result.recordFingerprint=createHash('sha256').update(JSON.stringify(fields.map(field=>[field,record[field]]))).digest('hex');
 result.status='passed';
}catch(error){result.status='failed';result.error=error.message;process.exitCode=1;}
console.log(JSON.stringify(result));
