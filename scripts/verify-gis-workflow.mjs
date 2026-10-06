const base='https://gis.newhavenct.gov/server/rest/services/Hosted/';
const layers={
 address:base+'New_Haven_Addresses_Authoritative_view/FeatureServer/0',
 parcel:base+'New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0',
 zoning:base+'Zoning_(View)/FeatureServer/0'
};
async function request(url){
 const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('HTTP '+response.status);
 const data=await response.json();
 if(data.error)throw Error('API query error '+data.error.code);
 return data;
}
async function query(layer,parameters){
 const url=new URL(layer+'/query');
 for(const [key,value] of Object.entries({f:'json',where:'1=1',returnGeometry:'true',outSR:'4326',resultRecordCount:'10',...parameters}))url.searchParams.set(key,value);
 const data=await request(url);
 if(!Array.isArray(data.features))throw Error('Missing features response');
 if(data.exceededTransferLimit)throw Error('Query exceeded sample row limit for '+Object.keys(layers).find(key=>layers[key]===layer)+' ('+data.features.length+' rows returned)');
 if(![4326].includes(data.spatialReference?.latestWkid||data.spatialReference?.wkid))throw Error('Unexpected output geometry coordinate system');
 return {url:url.toString(),...data};
}
function validPoint(x,y){return Number.isFinite(x)&&Number.isFinite(y)&&x>-73.1&&x<-72.7&&y>41.2&&y<41.4;}
function polygon(feature){
 const rings=feature.geometry?.rings;
 return Array.isArray(rings)&&rings.length>0&&rings.every(r=>Array.isArray(r)&&r.length>=4&&r.every(p=>validPoint(p[0],p[1])));
}
const result={name:'Known address-to-parcel-to-zoning workflow',input:'New Haven City Hall: 165 Church Street',checkedAt:new Date().toISOString()};
try{
 const metadata=await request(layers.address+'?f=pjson');
 const house=metadata.fields?.find(f=>f.name==='house_number');
 if(!house)throw Error('Missing house_number field schema');
 const houseLiteral=house.type==='esriFieldTypeString'?"'165'":'165';
 const addresses=await query(layers.address,{where:'house_number = '+houseLiteral+" AND UPPER(street_name) LIKE 'CHURCH%'",outFields:'objectid,house_number,street_name,full_street_name',resultRecordCount:'100'});
 result.address={url:addresses.url,rowsReturned:addresses.features.length};
 if(!addresses.features.length)throw Error('Address filter returned no rows');
 const normalizedMatches=addresses.features.every(f=>String(f.attributes.house_number).trim()==='165'&&/^CHURCH(?:\s|$)/i.test(String(f.attributes.street_name).trim()));
 const locations=new Map(addresses.features.map(f=>[JSON.stringify(f.geometry),f.geometry]));
 result.address.normalizedAddressesMatchInput=normalizedMatches;
 result.address.distinctLocations=locations.size;
 if(!normalizedMatches)throw Error('Address field values do not match the requested public address');
 if(locations.size!==1)throw Error('Address rows identify '+locations.size+' distinct locations; matching requires investigation');
 const point=locations.values().next().value;
 if(!validPoint(point?.x,point?.y))throw Error('Address point is not valid New Haven longitude/latitude');
 const spatial={geometry:JSON.stringify({x:point.x,y:point.y,spatialReference:{wkid:4326}}),geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects'};
 const parcels=await query(layers.parcel,{...spatial,outFields:'objectid,parcel_id,account_number,property_address'});
 result.parcel={url:parcels.url,rowsReturned:parcels.features.length,validLongitudeLatitudePolygons:parcels.features.every(polygon)};
 if(parcels.features.length!==1)throw Error('Address point did not intersect exactly one parcel row');
 if(!result.parcel.validLongitudeLatitudePolygons)throw Error('Parcel geometry failed output-coordinate checks');
 const expected=await query(layers.parcel,{where:"UPPER(property_address) LIKE '165%CHURCH%'",outFields:'objectid,parcel_id,account_number,property_address'});
 result.parcel.matchesIndependentAddressLookup=expected.features.length===1&&expected.features[0].attributes.parcel_id===parcels.features[0].attributes.parcel_id&&expected.features[0].attributes.account_number===parcels.features[0].attributes.account_number;
 if(!result.parcel.matchesIndependentAddressLookup)throw Error('Spatial parcel does not match the independent address lookup identifiers');
 const zoning=await query(layers.zoning,{...spatial,outFields:'zone_code,district_category,districts'});
 result.zoning={url:zoning.url,rowsReturned:zoning.features.length,validLongitudeLatitudePolygons:zoning.features.every(polygon),requiredFieldsPresent:zoning.features.every(f=>['zone_code','district_category','districts'].every(key=>Object.hasOwn(f.attributes||{},key)))};
 if(!zoning.features.length)throw Error('No zoning rows intersected the tested point');
 if(!result.zoning.validLongitudeLatitudePolygons||!result.zoning.requiredFieldsPresent)throw Error('Zoning geometry or expected fields failed validation');
 result.warnings=['One public address was tested. Other address formats, multiple matches, overlays, boundaries, pagination and bulk workflows need separate checks. Zoning meanings, effective dates, reuse rights and source freshness are unconfirmed.'];
 result.status='passed';
}catch(error){result.status='failed';result.error=error.message;process.exitCode=1;}
console.log(JSON.stringify(result));
