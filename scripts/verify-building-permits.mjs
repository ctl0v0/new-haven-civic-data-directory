import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const service='https://services5.municity5.com/M5Services/M5Service.svc';
const sample={parcelId:13397,printKey:'241 0234 00200',address:'155 TEMPLE ST',latitude:41.30570527,longitude:-72.92722431};
const maxBytes=10_000_000;
const maxRecords=500;
const groups={
 Permit:['Permit_ID','PermitNo','PermitType','PermStatus','PermitDate'],
 Application:['Application_ID','ApplicationNumber','PermitApplicationType','PermitApplicationStatus','ApplicationDate'],
 License:['License_ID','LicenseNumber','LicenseType','Status','Date','ExpirationDate'],
 Certificate:['Certificate_ID','CertificateNumber','CertificateType','CertificateDate']
};
export const warnings=[
 'One commercial parcel is tested. Other addresses, ambiguous matches, citywide coverage, complete property history and bulk access remain unverified.',
 'Group counts precede de-duplication. Applications, permits, licenses and certificates have different meanings; dates and statuses do not establish current validity, completed work or permission to operate.',
 'Vendor API support, request limits, refresh responsibility, costs and reuse terms remain unconfirmed. Inspection details, documents and interactive portal search are not tested.',
 'Only counts, selected field names, matching checks and a content fingerprint are reported. Raw records, descriptions, contacts, owners and mailing details are not published; matches remain at parcel or building scope.'
];
class CheckFailure extends Error {
 constructor(message,failureType='changed',httpStatus){super(message);this.failureType=failureType;this.httpStatus=httpStatus;}
}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>String(value??'').trim().replace(/\s+/g,' ').toUpperCase();
const identifier=value=>(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)||(typeof value==='string'&&/^[1-9]\d*$/.test(value));

async function request(path,params,fetcher){
 const url=new URL(service+path);
 for(const [key,value]of Object.entries(params||{}))url.searchParams.set(key,value);
 let response;
 try{response=await fetcher(url,{headers:{Accept:'application/json',SourceId:'2'},signal:AbortSignal.timeout(20000)});}
 catch{throw new CheckFailure('Permit source request could not finish.','unavailable');}
 if(!response.ok)throw new CheckFailure('Permit source returned HTTP '+response.status,[401,403,429].includes(response.status)?'blocked':'unavailable',response.status);
 let body='';
 try{
  if(Number(response.headers.get('content-length'))>maxBytes)throw new CheckFailure('Permit response exceeds the validation size limit.');
  const reader=response.body?.getReader();
  if(!reader)throw new CheckFailure('Permit response has no JSON body.');
  const decoder=new TextDecoder();let bytes=0;
  while(true){
   const {value,done}=await reader.read();if(done)break;
   bytes+=value.byteLength;
   if(bytes>maxBytes){await reader.cancel();throw new CheckFailure('Permit response exceeds the validation size limit.');}
   body+=decoder.decode(value,{stream:true});
  }
  body+=decoder.decode();
 }catch(error){if(error instanceof CheckFailure)throw error;throw new CheckFailure('Permit source response could not finish.','unavailable');}
 let data;
 try{data=JSON.parse(body);}catch{throw new CheckFailure('Permit source returned an unexpected JSON format.');}
 if(!object(data)||data.error||data.success==='failure')throw new CheckFailure('Permit source returned an unexpected response schema.');
 return {url:url.toString(),data};
}
function parcelIdentity(value){
 if(!object(value)||!identifier(value.Parcel_ID))throw new CheckFailure('Parcel identifier field is missing or invalid.');
 if(Number(value.Parcel_ID)!==sample.parcelId||text(value.PrintKey)!==sample.printKey||text(value.LegalAddress)!==sample.address)throw new CheckFailure('Parcel identity fields differ from the documented sample.');
 return [Number(value.Parcel_ID),text(value.PrintKey),text(value.LegalAddress)];
}

export async function verifyBuildingPermits({fetcher=fetch,checkedAt=new Date().toISOString()}={}){
 const result={name:'New Haven permit parcel and related-record lookup',checkedAt,scope:'One commercial parcel: PrintKey and point identity, four related-record groups and selected fields; no raw records or contact details',warnings};
 try{
  const initial=await request('/GetM5Data',{
   Customer:'NewHavenCityCT',entity:'Parcel',entity_id:'',fieldtype:'text',mapid:'',mapobject:'',module:'',numrecs:'5',operator:'=',pid:'',searchfield:'PrintKey',section:'',value:sample.printKey
  },fetcher);
  result.url=initial.url;
  if(Number(initial.data.total)!==1||!Array.isArray(initial.data.rows)||initial.data.rows.length!==1)throw new CheckFailure('PrintKey search must return exactly one parcel row.');
  const identity=parcelIdentity(initial.data.rows[0]);
  result.parcel={rowsReturned:1,requiredFieldsPresent:true};
  result.identifiers={parcelPresent:true};
  const point=await request('/Mobile/SelectParcel',{customer:'NewHavenCityCT',latitude:sample.latitude,longitude:sample.longitude},fetcher);
  const rows=Object.hasOwn(point.data,'rows')?point.data.rows:[point.data];
  if(!Array.isArray(rows)||rows.length!==1||(Object.hasOwn(point.data,'total')&&Number(point.data.total)!==1))throw new CheckFailure('Point search must return exactly one parcel row.');
  if(JSON.stringify(parcelIdentity(rows[0]))!==JSON.stringify(identity))throw new CheckFailure('Point and PrintKey parcel identity fields disagree.');
  result.repeatLookups=[{field:'PrintKey and confirmed point',rowsReturned:1,sameRecordAndSelectedValues:true}];
  const children=await request('/Customer/NewHavenCityCT/Parcel/'+sample.parcelId+'/Children',null,fetcher);
  result.recordGroups=[];
  result.metadata={requestedFields:[],missingRequestedFields:[]};
  const fingerprints=[];
  for(const [kind,fields]of Object.entries(groups)){
   const records=children.data[kind];
   if(!Array.isArray(records)||!records.length||records.length>maxRecords)throw new CheckFailure(kind+' record group is missing, empty or exceeds the sample record limit.');
   if(records.some(row=>!object(row)))throw new CheckFailure(kind+' record group contains an invalid row.');
   const missing=fields.filter(field=>!records.some(row=>Object.hasOwn(row,field)));
   result.metadata.missingRequestedFields.push(...missing.map(field=>kind+'.'+field));
   if(missing.length)throw new CheckFailure(kind+' record group is missing expected fields.');
   const ids=records.map(row=>row[fields[0]]);
   if(ids.some(id=>!identifier(id))||new Set(ids.map(String)).size!==ids.length)throw new CheckFailure(kind+' record identifiers are missing, invalid or duplicated.');
   if(records.some(row=>fields.some(field=>row[field]!=null&&!['string','number','boolean'].includes(typeof row[field]))))throw new CheckFailure(kind+' selected fields have an unexpected value schema.');
   result.recordGroups.push({kind,rowsReturned:records.length,returnedFields:fields});
   result.metadata.requestedFields.push(...fields.map(field=>({name:kind+'.'+field,type:'observed JSON field'})));
   fingerprints.push([kind,records.map(row=>JSON.stringify(fields.map(field=>[field,row[field]??null]))).sort()]);
  }
  result.recordFingerprint=createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex');
  result.status='passed';
 }catch(error){
  result.status='failed';
  result.failureType=error instanceof CheckFailure?error.failureType:'unavailable';
  result.error=error instanceof CheckFailure?error.message:'Permit check could not finish.';
  if(error instanceof CheckFailure&&error.httpStatus)result.httpStatus=error.httpStatus;
 }
 return result;
}
async function main(){
 const result=await verifyBuildingPermits();
 console.log(JSON.stringify(result));
 if(result.status!=='passed')process.exitCode=1;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
