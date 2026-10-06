const services = [
  {name:'City parcel and assessment API',url:'https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0',fields:['objectid','parcel_id','account_number','property_address','nh_ward','use_code','total_land_area_acres','year_building_built','units_commercial','units_residential','units_condo','total_assessed_parcel_value_x','total_assessed_land_value','total_assessed_bldg_value','sale_date','price']},
  {name:'City zoning API',url:'https://gis.newhavenct.gov/server/rest/services/Hosted/Zoning_(View)/FeatureServer/0',fields:['zone_code','district_category','districts']},
  {name:'City address-point API',url:'https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Addresses_Authoritative_view/FeatureServer/0',fields:['objectid','house_number','street_name','full_street_name','neighborhood','zip','display_x','display_y']}
];
async function request(url) {
  const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('HTTP '+response.status);
  const data=await response.json();
  if(data.error)throw new Error('ArcGIS error '+data.error.code+': '+data.error.message);
  return data;
}
let failed=false;
for(const service of services) {
  const result={name:service.name,url:service.url,checkedAt:new Date().toISOString()};
  try {
    const metadataUrl=new URL(service.url);metadataUrl.searchParams.set('f','pjson');
    const metadata=await request(metadataUrl);
    if(!Array.isArray(metadata.fields))throw new Error('Missing field schema');
    const names=new Set(metadata.fields.map(field=>field.name));
    const matched=service.fields.filter(field=>names.has(field));
    result.metadata={name:metadata.name,type:metadata.type,geometryType:metadata.geometryType,maxRecordCount:metadata.maxRecordCount,supportedQueryFormats:metadata.supportedQueryFormats,supportsPagination:metadata.advancedQueryCapabilities?.supportsPagination,spatialReference:metadata.extent?.spatialReference,lastEditDate:metadata.editingInfo?.lastEditDate,requestedFields:metadata.fields.filter(field=>matched.includes(field.name)).map(({name,type,alias})=>({name,type,alias})),missingRequestedFields:service.fields.filter(field=>!names.has(field))};
    if(!matched.length)throw new Error('None of the expected fields are present');
    const query=new URL(service.url+'/query');
    for(const [key,value]of Object.entries({f:'json',where:'1=1',outFields:matched.join(','),returnGeometry:'false',resultRecordCount:'1'}))query.searchParams.set(key,value);
    const data=await request(query);
    if(!Array.isArray(data.features))throw new Error('Missing features response');
    result.query={url:query.toString(),rowsReturned:data.features.length,returnedFields:data.features.length?Object.keys(data.features[0].attributes||{}):[],note:'No attribute values are logged. One-record query does not verify completeness or data accuracy.'};
    result.status=data.features.length?'passed':'empty';
    if(!data.features.length)failed=true;
  } catch(error) {result.status='failed';result.error=error.message;failed=true;}
  console.log(JSON.stringify(result));
}
if(failed)process.exitCode=1;
