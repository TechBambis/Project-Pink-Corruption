// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

type Point=[number,number,number];
interface Face {points:[Point,Point,Point];normal:Point;normals:[Point,Point,Point];center:Point}
const cross=(a:Point,b:Point):Point=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const subtract=(a:Point,b:Point):Point=>a.map((v,i)=>v-b[i]) as Point;
/** Original closed, rounded heart surface: its narrow profile has real thickness. */
const mesh:Face[]=(()=>{
 const faces:Face[]=[],segments=48,rings=10;
 const vertex=(r:number,a:number,side:number):Point=>[16*Math.sin(a)**3*r,(2-(13*Math.cos(a)-5*Math.cos(2*a)-2*Math.cos(3*a)-Math.cos(4*a)))*r,side*6*Math.sqrt(Math.max(0,1-r*r))];
 const face=(points:[Point,Point,Point],side:number)=>{let normal=cross(subtract(points[1],points[0]),subtract(points[2],points[0]));if(normal[2]*side<0)normal=normal.map(v=>-v) as Point;const length=Math.hypot(...normal);if(length<1e-8)return;normal=normal.map(v=>v/length) as Point;faces.push({points,normal,normals:[normal,normal,normal],center:points[0].map((_,i)=>points.reduce((n,p)=>n+p[i],0)/3) as Point});};
 for(const side of [-1,1])for(let r=0;r<rings;r++)for(let a=0;a<segments;a++){
  const p=vertex(r/rings,a/segments*2*Math.PI,side),q=vertex((r+1)/rings,a/segments*2*Math.PI,side),s=vertex((r+1)/rings,(a+1)/segments*2*Math.PI,side),t=vertex(r/rings,(a+1)/segments*2*Math.PI,side);
  face([p,q,s],side);face([p,s,t],side);
 }
 // Shared surface normals remove triangle facets, including the closed rim.
 const key=(p:Point)=>p.map(v=>v.toFixed(5)).join(',');
 const sums=new Map<string,Point>();
 for(const f of faces)for(const p of f.points){const k=key(p),sum=sums.get(k)??[0,0,0];for(let i=0;i<3;i++)sum[i]+=f.normal[i];sums.set(k,sum);}
 for(const f of faces)f.normals=f.points.map(p=>{const n=sums.get(key(p))!,length=Math.hypot(...n);return n.map(v=>v/length) as Point;}) as [Point,Point,Point];
 return faces;
})();
/** Session/output-clock geometry; reduced motion holds the broad front view. */
export function heartProjection(atMs:number,periodMs=5660,reduced=false){
 const angle=reduced?0:atMs/periodMs*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);
 const rotate=([x,y,z]:Point):Point=>[x*c+z*s,y,-x*s+z*c];
 return mesh.map(f=>({...f,points:f.points.map(rotate) as [Point,Point,Point],normal:rotate(f.normal),normals:f.normals.map(rotate) as [Point,Point,Point],center:rotate(f.center)})).filter(f=>f.normal[2]>0).sort((a,b)=>a.center[2]-b.center[2]);
}
interface Raster {pixels:ImageData;depth:Float32Array}
const rasters=new WeakMap<CanvasRenderingContext2D,Raster>();
/** Smooth surface lighting in one small raster; no frame timers or flat-face gradients. */
export function drawHeart(context:CanvasRenderingContext2D,atMs:number,periodMs:number,reduced:boolean){
 const {width,height}=context.canvas;
 let raster=rasters.get(context);if(!raster||raster.pixels.width!==width||raster.pixels.height!==height){raster={pixels:context.createImageData(width,height),depth:new Float32Array(width*height)};rasters.set(context,raster);}
 const pixels=raster.pixels.data,depth=raster.depth;pixels.fill(0);depth.fill(-Infinity);
 const scale=Math.min(width,height)/42;
 for(const face of heartProjection(atMs,periodMs,reduced)){
  const projected=face.points.map(([x,y,z])=>{const perspective=80/(80-z);return [width/2+x*scale*perspective,height*.46+y*scale*perspective,z];});
  const [a,b,c]=projected,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)continue;
  const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),x1=Math.min(width-1,Math.ceil(Math.max(a[0],b[0],c[0]))),y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),y1=Math.min(height-1,Math.ceil(Math.max(a[1],b[1],c[1])));
  const [na,nb,nc]=face.normals;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const u=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/den,v=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/den,w=1-u-v;if(u<-.0001||v<-.0001||w<-.0001)continue;
   const index=y*width+x,z=u*a[2]+v*b[2]+w*c[2];if(z<depth[index])continue;depth[index]=z;
   let nx=u*na[0]+v*nb[0]+w*nc[0],ny=u*na[1]+v*nb[1]+w*nc[1],nz=u*na[2]+v*nb[2]+w*nc[2];const length=Math.hypot(nx,ny,nz);nx/=length;ny/=length;nz/=length;
   const diffuse=Math.max(0,nx*-.36+ny*-.46+nz*.81),shine=Math.max(0,nx*-.18+ny*-.24+nz*.954)**48;
   const shade=.58+.4*diffuse,offset=index*4;pixels[offset]=Math.min(255,231*shade+shine*145);pixels[offset+1]=Math.min(255,90*shade+shine*175);pixels[offset+2]=Math.min(255,157*shade+shine*155);pixels[offset+3]=255;
  }
 }
 context.putImageData(raster.pixels,0,0);
}
