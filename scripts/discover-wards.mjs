import {mkdir,writeFile} from 'node:fs/promises';
const urls=[
'https://gis.newhavenct.gov/server/rest/services/Hosted?f=pjson',
'https://www.newhavenct.gov/government/departments-divisions/engineering/maps',
'https://maps.newhavenct.gov/?appid=03c5c7b828b54fa6a55dd47c7f6906f6&edit=true',
'https://www.arcgis.com/sharing/rest/content/items/dc70274a5b44425c93e461dffaf91c06?f=json',
'https://www.arcgis.com/sharing/rest/content/items/dc70274a5b44425c93e461dffaf91c06/data?f=json',
'https://services6.arcgis.com/AWSPcxcHO7OnZlnu/ArcGIS/rest/services/New_Haven_Wards/FeatureServer/0?f=pjson'
];
await mkdir('verification',{recursive:true});
for(let i=0;i<urls.length;i++){try{
 const r=await fetch(urls[i],{signal:AbortSignal.timeout(30000)});const t=await r.text();
 await writeFile('verification/ward-discovery-'+i+'.txt',t);
 let data;try{data=JSON.parse(t);}catch{}
 console.log(JSON.stringify({url:urls[i],status:r.status,data:data?data:undefined,links:data?undefined:[...t.matchAll(/href=["']([^"']+)["']/gi)].map(x=>x[1]).filter(x=>/ward|arcgis|map/i.test(x)).slice(0,100)}));
}catch(e){console.log(JSON.stringify({url:urls[i],error:e.message}));}}
