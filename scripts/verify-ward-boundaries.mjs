import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const layer='https://gis.newhavenct.gov/server/rest/services/Hosted/Wards_2022_(View)/FeatureServer/0';
const addresses='https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Addresses_Authoritative_view/FeatureServer/0';
async function request(url){
 const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error('HTTP '+r.status);
 const text=await r.text();if(text.length>12000000)throw Error('Boundary response exceeds validation size limit');
 let data;try{data=JSON.parse(text);}catch{throw Error('Expected JSON; received a non-data response');}
 if(data.error)throw Error('API error '+data.error.code);
 return data;
}
async function query(endpoint,parameters){
 const url=new URL(endpoint+'/query');for(const [k,v] of Object.entries({f:'json',where:'1=1',returnGeometry:'true',outSR:'4326',resultRecordCount:'100',...parameters}))url.searchParams.set(k,v);
 const data=await request(url);if(!Array.isArray(data.features)||data.exceededTransferLimit)throw Error('Missing or truncated features response');
 if((data.spatialReference?.latestWkid||data.spatialReference?.wkid)!==4326)throw Error('Unexpected geometry coordinate system');
 return {url:url.toString(),...data};
}
export function validPolygon(feature){
 const rings=feature.geometry?.rings;
 return Array.isArray(rings)&&rings.length>0&&rings.every(r=>Array.isArray(r)&&r.length>=4&&r.every(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>-73.1&&p[0]<-72.7&&p[1]>41.2&&p[1]<41.4)&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1]);
}
export function wardCoverage(features,field){
 const wards=features.map(f=>Number(f.attributes?.[field]));
 const unique=[...new Set(wards)].sort((a,b)=>a-b);
 if(features.length!==30||unique.length!==30||unique.some((v,i)=>v!==i+1))throw Error('Ward coverage must contain exactly one polygon record for each ward 1 through 30');
 if(!features.every(validPolygon))throw Error('Ward polygon rings or longitude/latitude coordinates failed validation');
 return unique;
}
export function containsPoint(rings,point){
 let inside=false;
 for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [xi,yi]=ring[i],[xj,yj]=ring[j];
  if(((yi>point.y)!==(yj>point.y))&&(point.x<(xj-xi)*(point.y-yi)/(yj-yi)+xi))inside=!inside;
 }
 return inside;
}
export async function main(){
 const result={name:'City ward polygons and City Hall lookup',url:layer+'?f=pjson'};
 try{
  const metadata=await request(result.url);
  console.log(JSON.stringify({name:'Ward layer field definitions',status:'passed',url:result.url,layerName:metadata.name,description:metadata.description,fields:metadata.fields,geometryType:metadata.geometryType,editingInfo:metadata.editingInfo,serviceItemId:metadata.serviceItemId}));
  if(metadata.geometryType!=='esriGeometryPolygon')throw Error('Ward layer is not polygon geometry');
  const field=metadata.fields?.find(f=>/^(wards?|ward_num|ward_number)$/i.test(f.name));
  if(!field)throw Error('Ward identifier field not found');
  result.metadata={requestedFields:[{name:field.name,type:field.type}],missingRequestedFields:[]};
  const all=await query(layer,{outFields:field.name});
  const wards=wardCoverage(all.features,field.name);
  result.rowsExtracted=all.features.length;result.uniqueWards=wards;result.exportedFields=[field.name,'geometry.rings'];result.query={rowsReturned:all.features.length,returnedFields:[field.name,'geometry.rings']};
  const am=await request(addresses+'?f=json');const hf=am.fields?.find(f=>f.name==='house_number');
  if(!hf)throw Error('Address house_number field is missing');
  const rows=await query(addresses,{where:'house_number = '+(hf.type==='esriFieldTypeString'?"'165'":'165')+" AND UPPER(street_name) LIKE 'CHURCH%'",outFields:'house_number,street_name'});
  if(!rows.features.length||!rows.features.every(f=>String(f.attributes.house_number).trim()==='165'&&/^CHURCH(?:\\s|$)/i.test(String(f.attributes.street_name).trim())))throw Error('City Hall address rows failed matching');
  const points=new Map(rows.features.map(f=>[JSON.stringify(f.geometry),f.geometry]));if(points.size!==1)throw Error('City Hall address rows have ambiguous locations');
  const point=points.values().next().value;
  if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))throw Error('Invalid City Hall point');
  const spatial=await query(layer,{geometry:JSON.stringify({...point,spatialReference:{wkid:4326}}),geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:field.name});
  if(spatial.features.length!==1||!spatial.features.every(validPolygon))throw Error('City Hall must intersect exactly one readable ward polygon');
  const independent=all.features.filter(f=>containsPoint(f.geometry.rings,point));
  const ward=Number(spatial.features[0].attributes[field.name]);
  if(independent.length!==1||Number(independent[0].attributes[field.name])!==ward)throw Error('Point-in-polygon check disagrees with API ward lookup');
  result.address={rowsReturned:rows.features.length,distinctLocations:points.size,normalizedAddressesMatchInput:true};
  result.knownLocation={label:'City Hall, 165 Church Street',ward,apiMatchesDownloadedPolygons:true,queryUrl:spatial.url};
  result.dataFingerprint=createHash('sha256').update(JSON.stringify(all.features.map(f=>({ward:Number(f.attributes[field.name]),rings:f.geometry.rings})).sort((a,b)=>a.ward-b.ward))).digest('hex');
  result.warnings=['The API layer is named Wards_2022. Its current legal boundary plan and effective date have not been confirmed; service edit dates do not establish boundary currency.','One public address was tested. Boundary-edge cases, other addresses, topology and reuse terms remain unverified. Representative names were not retrieved; use the separately checked roster.'];
  result.status='passed';
 }catch(e){result.status='failed';result.error=e.message;process.exitCode=1;}
 console.log(JSON.stringify(result));
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
