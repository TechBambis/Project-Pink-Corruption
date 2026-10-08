// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {z} from 'zod';
import {ApproximatePlaceSchema,type ApproximatePlace} from '../safety/access';

export const IP_LOCATION_PROVIDER={name:'GeoJS',url:'https://get.geojs.io/v1/ip/geo.json',privacy:'https://www.geojs.io/privacy/'};
const responseSchema=z.object({city:z.string().min(1).max(100),region:z.string().max(100).optional(),country:z.string().min(1).max(100)});

/** The local backend's outbound public IP is looked up. IP/coordinates never enter the saved record. */
export async function approximateIpLocation(signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<ApproximatePlace>{
 const response=await fetcher(IP_LOCATION_PROVIDER.url,{method:'GET',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),headers:{Accept:'application/json'}});
 if(!response.ok||!response.body)throw Error('The IP location service is unavailable. Try again later.');
 const limit=16*1024,reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
 try{
  while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>limit)throw Error('The IP location response was too large.');chunks.push(item.value);}
  signal.throwIfAborted();
  const place=responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  return ApproximatePlaceSchema.parse({city:place.city,...(place.region?{region:place.region}:{}),country:place.country,source:'geojs-ip',checkedAt:new Date().toISOString()});
 }finally{await reader.cancel().catch(()=>{});}
}
