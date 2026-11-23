import * as T from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
const $=id=>document.getElementById(id), rad=Math.PI/180, R=1737400;
const palettes={topographic:['#352264','#2c70b5','#56b997','#f3d86a'],moonlight:['#155d70','#409b9b','#b9d5c3','#f0ead2'],lunar:['#163d64','#2b929d','#e5c68f','#fff5dd'],thermal:['#301248','#b53d63','#f6a35b','#fff0bc'],ice:['#152d5d','#4b8db','#a9d7de','#f4ffff']};
const centerLon=348.8*rad,centerLat=-43.25*rad;
const U=[Math.cos(centerLat)*Math.cos(centerLon),Math.cos(centerLat)*Math.sin(centerLon),Math.sin(centerLat)];
const E=[-Math.sin(centerLon),Math.cos(centerLon),0],N=[-Math.sin(centerLat)*Math.cos(centerLon),-Math.sin(centerLat)*Math.sin(centerLon),Math.cos(centerLat)];
function lunar(lon,lat,h=0,scale=1){const a=lon*rad,b=lat*rad,r=R+h*scale,v=[r*Math.cos(b)*Math.cos(a)-R*U[0],r*Math.cos(b)*Math.sin(a)-R*U[1],r*Math.sin(b)-R*U[2]];return [v[0]*E[0]+v[1]*E[1]+v[2]*E[2],v[0]*U[0]+v[1]*U[1]+v[2]*U[2],-(v[0]*N[0]+v[1]*N[1]+v[2]*N[2])];}
function section(poly,x){const hits=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if((a[0]<=x&&b[0]>x)||(b[0]<=x&&a[0]>x))hits.push(a[1]+(x-a[0])/(b[0]-a[0])*(b[1]-a[1]));}hits.sort((a,b)=>a-b);const out=[];for(let i=0;i+1<hits.length;i+=2)out.push([hits[i],hits[i+1]]);return out;}
async function getJSON(name){const r=await fetch('data/'+name);if(!r.ok)throw Error(name+': '+r.status);return r.json();}
async function main(){
 const [dem,meta]=await Promise.all([getJSON('terrain.json'),getJSON('metadata.json')]);
 const renderer=new T.WebGLRenderer({canvas:$('scene'),antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#07151a');renderer.outputColorSpace=T.SRGBColorSpace;
 const scene=new T.Scene();scene.fog=new T.Fog('#07151a',230000,450000);
 const camera=new T.OrthographicCamera(-1,1,1,-1,100,800000),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.screenSpacePanning=true;controls.minZoom=.55;controls.maxZoom=24;controls.autoRotateSpeed=.65;controls.maxDistance=600000;
 scene.add(new T.HemisphereLight('#e5ece7','#283e40',.9));const sun=new T.DirectionalLight('#eee8d2',1.75);sun.position.set(-65000,120000,55000);scene.add(sun);
 function home(){controls.target.set(0,-7000,0);camera.position.set(100000,145000,108000);camera.zoom=1;camera.updateProjectionMatrix();controls.update();}
 function resize(){const aspect=innerWidth/innerHeight,span=Math.max(155000,155000/aspect);camera.top=span/2;camera.bottom=-span/2;camera.right=span*aspect/2;camera.left=-camera.right;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);}
 home();resize();addEventListener('resize',resize);$('home').onclick=home;
 $('zoomIn').onclick=()=>{camera.zoom=Math.min(24,camera.zoom*1.35);camera.updateProjectionMatrix();};$('zoomOut').onclick=()=>{camera.zoom=Math.max(.55,camera.zoom/1.35);camera.updateProjectionMatrix();};
 const w=dem.cols,h=dem.rows,heights=dem.heights_m,geom=new T.BufferGeometry(),pos=new Float32Array(w*h*3),colors=new Float32Array(w*h*3),uvs=new Float32Array(w*h*2),indices=[];
 const neutralRamps=['#273b42','#5a6a69','#a4a9a0','#dbd8c6'],initialRamps=palettes.topographic.map(c=>new T.Color(c));
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){
  const k=j*w+i,z=heights[k],lon=(dem.col0+i+.5)/64,lat=90-(dem.row0+j+.5)/64;
  const p=lunar(lon,lat,z??0,6);pos.set(p,k*3);const t=T.MathUtils.clamp(((z??-4000)+4000)/6000,0,.999999)*3,ii=Math.floor(t),col=initialRamps[ii].clone().lerp(initialRamps[ii+1],t-ii);colors.set([col.r,col.g,col.b],k*3);
  uvs[k*2]=(i+.5)/w;uvs[k*2+1]=1-(j+.5)/h;
  if(i+1<w&&j+1<h){const b=k+1,c=k+w,d=c+1;if(z!==null&&heights[b]!==null&&heights[c]!==null)indices.push(k,c,b);if(heights[b]!==null&&heights[c]!==null&&heights[d]!==null)indices.push(b,c,d);}
 }
 geom.setAttribute('position',new T.BufferAttribute(pos,3));geom.setAttribute('color',new T.BufferAttribute(colors,3));geom.setAttribute('uv',new T.BufferAttribute(uvs,2));geom.setIndex(indices);geom.computeVertexNormals();
 const mesh=new T.Mesh(geom,new T.MeshStandardMaterial({vertexColors:true,roughness:1,side:T.DoubleSide}));scene.add(mesh);
 const opticalMat=new T.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,side:T.DoubleSide});
 const opticalMesh=new T.Mesh(geom,opticalMat);opticalMesh.visible=false;opticalMesh.renderOrder=-1;scene.add(opticalMesh);
 let opticalReady=false,opticalFocusSaved=null;
 new T.TextureLoader().load('data/optical_tycho.png',texture=>{texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());opticalMat.map=texture;opticalMat.needsUpdate=true;opticalReady=true;$('opticalFocus').disabled=false;$('opticalFocus').textContent='Inspect LROC image';$('opticalHint').textContent='Drag Surface transition to compare DEM colors and LROC pixels.';controlsUpdate();},undefined,e=>{$('error').textContent='Optical mosaic unavailable: '+(e?.message??'download error');$('opticalHint').textContent='Optical image failed to load.';});
 const chunks=new Map(),loading=new Set(),queue=[],passMap=new Map(),passSegments=new Map(),traceStats={total:0,maxGap:0,maxDistance:0};let passList=[],activeLoads=0,manifest=null,totalLoaded=0,timeMin=Infinity,timeMax=-Infinity,sampleStep=16,activeTrailPid=null,activeTrailTimes=[];
 function positionChunk(chunk,scale){
  for(let i=0;i<chunk.count;i++){const v=lunar(chunk.lon[i],chunk.lat[i],chunk.height[i],scale);chunk.positions.set(v,i*3);}
  for(const [step,level] of Object.entries(chunk.levels)){
   if(+step>1)for(let i=0;i<level.indices.length;i++)level.positions.set(chunk.positions.subarray(level.indices[i]*3,level.indices[i]*3+3),i*3);
   level.geometry.attributes.position.needsUpdate=true;
  }
  chunk.xSorted=Array.from({length:chunk.count},(_,i)=>chunk.positions[i*3]).sort((a,b)=>a-b);
  if(chunk.trace)for(let i=0;i<chunk.trace.pairs.length/2;i++){
   const a=chunk.trace.pairs[i*2]*3,b=chunk.trace.pairs[i*2+1]*3,o=i*6;
   chunk.trace.positions.set(chunk.positions.subarray(a,a+3),o);
   chunk.trace.positions.set(chunk.positions.subarray(b,b+3),o+3);
   chunk.trace.positions[o+1]+=24;chunk.trace.positions[o+4]+=24;
  }
  if(chunk.trace)chunk.trace.geometry.attributes.position.needsUpdate=true;
 }
 const uniforms={pointSize:{value:3},sampleStep:{value:16},colorMin:{value:-4000},colorMax:{value:2000},rangeMin:{value:-4000},rangeMax:{value:2000},curtain:{value:0},threshold:{value:-1e9},glow:{value:1},pointOpacity:{value:1},stops:{value:palettes.topographic.map(s=>new T.Color(s))}};
 const vert=`attribute float height;varying float vHeight,vX;uniform float pointSize;void main(){vHeight=height;vX=position.x;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=pointSize;}`;
 const frag=`varying float vHeight,vX;uniform float colorMin,colorMax,rangeMin,rangeMax,curtain,threshold,glow,pointOpacity;uniform vec3 stops[4];uniform float halo;void main(){if(vHeight<rangeMin||vHeight>rangeMax||curtain>.5&&vX>threshold)discard;float d=length(gl_PointCoord*2.-1.);if(d>1.)discard;float t=clamp((vHeight-colorMin)/max(1.,colorMax-colorMin),0.,1.)*3.;int i=min(2,int(floor(t)));vec3 c=mix(stops[i],stops[i+1],t-float(i));float edge=curtain>.5?exp(-abs(vX-threshold)/1700.):0.;if(halo>.5){float a=glow*pointOpacity*(.08+.15*edge)*exp(-3.*d*d);gl_FragColor=vec4(c,a);}else{float a=pointOpacity*smoothstep(1.,.55,d);c=mix(c,vec3(.85,1.,1.),.36*edge);gl_FragColor=vec4(c,a);}}`;
 const haloMat=new T.ShaderMaterial({uniforms:{...uniforms,pointSize:{value:11},halo:{value:1}},vertexShader:vert,fragmentShader:frag,transparent:true,depthWrite:false,depthTest:false,blending:T.AdditiveBlending});
 const coreMat=new T.ShaderMaterial({uniforms:{...uniforms,halo:{value:0}},vertexShader:vert,fragmentShader:frag,transparent:true,depthWrite:false,depthTest:false});
 const traceUniforms={cutDay:{value:0},cutSec:{value:0},pulseEnabled:{value:0}};
 const traceMat=new T.ShaderMaterial({uniforms:traceUniforms,transparent:true,depthWrite:false,depthTest:false,blending:T.AdditiveBlending,
  vertexShader:'attribute float tDay,tSec;varying float age;uniform float cutDay,cutSec;void main(){age=(cutDay-tDay)*86400.+cutSec-tSec;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:'varying float age;uniform float pulseEnabled;void main(){if(age<0.)discard;float pulse=pulseEnabled*exp(-age/24.);vec3 color=mix(vec3(.11,.50,.48),vec3(.76,1.,.85),pulse);gl_FragColor=vec4(color,.04+.56*pulse);}'});
 const activeDashGeom=new T.BufferGeometry(),activeDotGeom=new T.BufferGeometry();activeDashGeom.setDrawRange(0,0);activeDotGeom.setDrawRange(0,0);
 const activeDash=new T.LineSegments(activeDashGeom,new T.LineBasicMaterial({color:'#79dfb7',transparent:true,opacity:.3,depthWrite:false,depthTest:true,blending:T.NormalBlending}));activeDash.frustumCulled=false;scene.add(activeDash);
 const activeDotMat=new T.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:T.NormalBlending,vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=9.;}',fragmentShader:'void main(){float d=length(gl_PointCoord*2.-1.);if(d>1.)discard;gl_FragColor=vec4(.42,.95,.68,.35*exp(-4.*d*d));}'});
 const activeDots=new T.Points(activeDotGeom,activeDotMat);activeDots.frustumCulled=false;scene.add(activeDots);
 function lowerBound(values,target){let lo=0,hi=values.length;while(lo<hi){const mid=(lo+hi)>>1;if(values[mid]<=target)lo=mid+1;else hi=mid;}return lo;}
 function rebuildActiveTrail(pid){
  activeTrailPid=pid;const segments=pid?[...(passSegments.get(pid)||[])].sort((a,b)=>a.time-b.time):[];
  activeTrailTimes=Float64Array.from(segments,s=>s.time);
  const dash=new Float32Array(segments.length*6),dots=new Float32Array(segments.length*3);
  for(let i=0;i<segments.length;i++){
   const s=segments[i],a=s.chunk.positions.subarray(s.from*3,s.from*3+3),b=s.chunk.positions.subarray(s.to*3,s.to*3+3);
   for(let k=0;k<3;k++){dash[i*6+k]=a[k]*.82+b[k]*.18;dash[i*6+3+k]=a[k]*.18+b[k]*.82;dots[i*3+k]=b[k];}
   dash[i*6+1]+=65;dash[i*6+4]+=65;dots[i*3+1]+=65;
  }
  activeDashGeom.setAttribute('position',new T.BufferAttribute(dash,3));activeDotGeom.setAttribute('position',new T.BufferAttribute(dots,3));
  activeDashGeom.setDrawRange(0,0);activeDotGeom.setDrawRange(0,0);
 }
 function shotHash(i){let x=Math.imul(i^(i>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return (x^(x>>>16))>>>0;}
 function buildTrace(chunk){
  const previous=new Map(),pairs=[],times=[];
  for(let i=0;i<chunk.count;i++){
   const key=chunk.product[i]*8+chunk.detector[i],j=previous.get(key);previous.set(key,i);
   if(j===undefined)continue;
   const dt=chunk.times[i]-chunk.times[j];if(dt<=0||dt>.045)continue;
   const dn=(chunk.lat[i]-chunk.lat[j])*rad*R,de=(chunk.lon[i]-chunk.lon[j])*rad*R*Math.cos(chunk.lat[i]*rad);
   const distance=Math.hypot(dn,de);if(distance>200)continue;
   const hashed=shotHash(i),pid=chunk.entry.products[chunk.product[i]];
   if(hashed%4===0){if(!passSegments.has(pid))passSegments.set(pid,[]);passSegments.get(pid).push({chunk,from:j,to:i,time:chunk.times[i]});}
   if(hashed%8!==0)continue;
   pairs.push(j,i);times.push(chunk.times[i]);traceStats.total++;traceStats.maxGap=Math.max(traceStats.maxGap,dt);traceStats.maxDistance=Math.max(traceStats.maxDistance,distance);
  }
  const positions=new Float32Array(pairs.length*3),day=new Float32Array(pairs.length),sec=new Float32Array(pairs.length);
  for(let i=0;i<times.length;i++){const d=Math.floor(times[i]/86400),s=times[i]-d*86400;day[2*i]=day[2*i+1]=d;sec[2*i]=sec[2*i+1]=s;}
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));geometry.setAttribute('tDay',new T.BufferAttribute(day,1));geometry.setAttribute('tSec',new T.BufferAttribute(sec,1));geometry.setDrawRange(0,0);
  const line=new T.LineSegments(geometry,traceMat);line.frustumCulled=false;scene.add(line);
  chunk.trace={pairs:Uint32Array.from(pairs),times:Float64Array.from(times),positions,geometry,line};
  positionChunk(chunk,+$('vertical').value);
 }
 function addChunk(entry,buffer){
  const count=entry.counts.accepted;if(buffer.byteLength!==count*24)throw Error(`${entry.id}: binary size mismatch`);
  const view=new DataView(buffer),lon=new Float32Array(count),lat=new Float32Array(count),height=new Float32Array(count),times=new Float64Array(count),product=new Uint16Array(count),detector=new Uint8Array(count),positions=new Float32Array(count*3);
  for(let i=0;i<count;i++){
   const o=i*24;lon[i]=view.getFloat32(o,true);lat[i]=view.getFloat32(o+4,true);height[i]=view.getFloat32(o+8,true);times[i]=view.getUint32(o+12,true)+view.getUint32(o+16,true)/1e6;product[i]=view.getUint16(o+20,true);detector[i]=view.getUint8(o+22);
   const pid=entry.products[product[i]],pass=passMap.get(pid);if(pass){pass.min=Math.min(pass.min,times[i]);pass.max=Math.max(pass.max,times[i]);pass.count++;}else passMap.set(pid,{pid,min:times[i],max:times[i],count:1});
  }
  passList=[...passMap.values()].sort((a,b)=>a.min-b.min);
  const levels={};for(const step of [1,8,16]){
   const indices=step===1?null:Uint32Array.from({length:count},(_,i)=>i).filter(i=>shotHash(i)%step===0);
   const size=step===1?count:indices.length,pp=step===1?positions:new Float32Array(size*3),hh=step===1?height:new Float32Array(size);
   if(step!==1)for(let i=0;i<size;i++)hh[i]=height[indices[i]];
   const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(pp,3).setUsage(T.DynamicDrawUsage));geometry.setAttribute('height',new T.BufferAttribute(hh,1));
   const halo=new T.Points(geometry,haloMat),cloud=new T.Points(geometry,coreMat);halo.frustumCulled=false;cloud.frustumCulled=false;scene.add(halo,cloud);
   levels[step]={positions:pp,indices,geometry,halo,cloud};
  }
  const chunk={entry,count,lon,lat,height,times,product,detector,positions,levels,xSorted:[],trace:null};buildTrace(chunk);activeTrailPid=null;chunks.set(entry.id,chunk);totalLoaded+=count;
  if(count){timeMin=Math.min(timeMin,times[0]);timeMax=Math.max(timeMax,times[count-1]);}
  for(const [step,level] of Object.entries(levels))level.halo.visible=level.cloud.visible=$('points').checked&&+step===sampleStep;
  state.ready=true;updateReveal();updateStatus();
 }
 async function loadChunk(entry){loading.add(entry.id);activeLoads++;try{const r=await fetch('data/full/'+entry.binary);if(!r.ok)throw Error(`${entry.id}: HTTP ${r.status}`);addChunk(entry,await r.arrayBuffer());}catch(e){console.error(e);$('error').textContent=e.message;}finally{loading.delete(entry.id);activeLoads--;drain();}}
 function drain(){while(activeLoads<3&&queue.length){const entry=queue.shift();if(!chunks.has(entry.id)&&!loading.has(entry.id))loadChunk(entry);}}
 async function refreshManifest(){try{const r=await fetch('data/full/manifest.json?ts='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('Manifest unavailable');manifest=await r.json();for(const entry of manifest.chunks)if(!chunks.has(entry.id)&&!loading.has(entry.id)&&!queue.some(e=>e.id===entry.id))queue.push(entry);drain();updateStatus();}catch(e){if(!chunks.size){const pilot=await getJSON('shots.json');const products=[...new Set(pilot.map(p=>p.product_id))],ids=new Map(products.map((p,i)=>[p,i]));const buf=new ArrayBuffer(pilot.length*24),v=new DataView(buf),epoch=Date.parse('2009-01-01T00:00:00Z');for(let i=0;i<pilot.length;i++){const p=pilot[i],o=i*24,t=Date.parse(p.utc+'Z')-epoch;v.setFloat32(o,p.lon,true);v.setFloat32(o+4,p.lat,true);v.setFloat32(o+8,p.height_m,true);v.setUint32(o+12,Math.floor(t/1000),true);v.setUint32(o+16,Math.round(t%1000)*1000,true);v.setUint16(o+20,ids.get(p.product_id),true);v.setUint8(o+22,p.detector);v.setUint8(o+23,p.flag);}addChunk({id:'pilot',counts:{accepted:pilot.length},products,binary:'pilot'},buf);}}
 }
 function updateStatus(){const acquired=manifest?.counts?.accepted??totalLoaded,rejected=manifest?.counts?.rejected??meta.counts.rejected;$('status').textContent=`${totalLoaded.toLocaleString()} loaded / ${acquired.toLocaleString()} acquired · ${chunks.size}/${manifest?.total_jobs??1} batches · ${manifest?.complete?'complete':'acquiring'}`;$('counts').textContent=`${acquired.toLocaleString()} accepted · ${rejected.toLocaleString()} rejected · full acquired density`;}
 // Boundary polygon in the same Moon-fixed local tangent frame as the raster and shots.
 const [west,south,east,north]=meta.bounds,outline=[];const n=70;
 for(let i=0;i<n;i++)outline.push(lunar(west+(east-west)*i/(n-1),north)[0],lunar(west+(east-west)*i/(n-1),north)[2]);
 for(let i=1;i<n;i++)outline.push(lunar(east,north+(south-north)*i/(n-1))[0],lunar(east,north+(south-north)*i/(n-1))[2]);
 for(let i=1;i<n;i++)outline.push(lunar(east+(west-east)*i/(n-1),south)[0],lunar(east+(west-east)*i/(n-1),south)[2]);
 for(let i=1;i<n-1;i++)outline.push(lunar(west,south+(north-south)*i/(n-1))[0],lunar(west,south+(north-south)*i/(n-1))[2]);
 const poly=[];for(let i=0;i<outline.length;i+=2)poly.push([outline[i],outline[i+1]]);
 const minX=Math.min(...poly.map(p=>p[0])),maxX=Math.max(...poly.map(p=>p[0]));
 const cPos=new Float32Array(36000),cUv=new Float32Array(24000),cGeom=new T.BufferGeometry();cGeom.setAttribute('position',new T.BufferAttribute(cPos,3).setUsage(T.DynamicDrawUsage));cGeom.setAttribute('uv',new T.BufferAttribute(cUv,2).setUsage(T.DynamicDrawUsage));cGeom.setDrawRange(0,0);
 const cMat=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;void main(){float base=exp(-v.y*9.);float ribs=pow(.5+.5*sin(v.x*.003),25.);float a=(.055+.08*ribs)*(1.-v.y)+.25*base;gl_FragColor=vec4(.25,.92,1.,a);}'});
 const curtainMesh=new T.Mesh(cGeom,cMat);curtainMesh.frustumCulled=false;scene.add(curtainMesh);
 const beamPositions=new Float32Array(5*6),beamGeometry=new T.BufferGeometry();beamGeometry.setAttribute('position',new T.BufferAttribute(beamPositions,3).setUsage(T.DynamicDrawUsage));beamGeometry.setDrawRange(0,0);
 const beamLine=new T.LineSegments(beamGeometry,new T.LineBasicMaterial({color:'#63dab1',transparent:true,opacity:.52,depthWrite:false,depthTest:true,blending:T.NormalBlending}));beamLine.frustumCulled=false;scene.add(beamLine);
 // These camera-facing light columns are anchored to measured detector footprints.
 // They visualize a pass; their length and glow are illustrative, not range data.
 const beamGlowMat=new T.ShaderMaterial({uniforms:{intensity:{value:1}},transparent:true,depthWrite:false,depthTest:true,side:T.DoubleSide,blending:T.NormalBlending,
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:'varying vec2 vUv;uniform float intensity;void main(){float x=(vUv.x-.5)*5.;float core=exp(-x*x*2.6);float haze=exp(-x*x*.48);float top=1.-smoothstep(.70,1.,vUv.y);float a=(.15*core+.08*haze)*(.42+.58*exp(-vUv.y*4.))*top*intensity;gl_FragColor=vec4(.38,1.,.75,a);}'});
 const beamGlows=Array.from({length:5},(_,i)=>{const mat=beamGlowMat.clone();mat.uniforms.intensity.value=1-i*.13;const m=new T.Mesh(new T.PlaneGeometry(900,7500),mat);m.visible=false;m.frustumCulled=false;scene.add(m);return m;});
 const headPositions=new Float32Array(5*3),headGeometry=new T.BufferGeometry();headGeometry.setAttribute('position',new T.BufferAttribute(headPositions,3).setUsage(T.DynamicDrawUsage));headGeometry.setDrawRange(0,0);
 const headMat=new T.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:T.AdditiveBlending,vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=20.;}',fragmentShader:'void main(){float d=length(gl_PointCoord*2.-1.);if(d>1.)discard;gl_FragColor=vec4(.62,1.,.77,.58*exp(-4.*d*d));}'});
 const heads=new T.Points(headGeometry,headMat);heads.frustumCulled=false;scene.add(heads);
 function groundY(x,z){
  const up=Math.sqrt(Math.max(0,R*R-x*x-z*z)),v=[U[0]*up+E[0]*x-N[0]*z,U[1]*up+E[1]*x-N[1]*z,U[2]*up+E[2]*x-N[2]*z];
  const lon=(Math.atan2(v[1],v[0])/rad+360)%360,lat=Math.asin(v[2]/R)/rad;
  const col=Math.round(lon*64-.5)-dem.col0,row=Math.round((90-lat)*64-.5)-dem.row0;
  const elev=heights[Math.max(0,Math.min(h-1,row))*w+Math.max(0,Math.min(w-1,col))]??0;
  return up-R+elev*(+$('vertical').value)+80;
 }
 function curtainGeometry(progress){const x=minX+(maxX-minX)*progress,segs=section(poly,x);let p=0,u=0;const add=(z,y,v)=>{cPos[p++]=x;cPos[p++]=y;cPos[p++]=z;cUv[u++]=z;cUv[u++]=v;};for(const [a,b] of segs){const steps=Math.ceil((b-a)/700);for(let k=0;k<steps;k++){const za=a+(b-a)*k/steps,zb=a+(b-a)*(k+1)/steps,ya=groundY(x,za),yb=groundY(x,zb);add(za,ya,0);add(zb,yb,0);add(za,ya+14000,1);add(zb,yb,0);add(zb,yb+14000,1);add(za,ya+14000,1);}}cGeom.setDrawRange(0,p/3);cGeom.attributes.position.needsUpdate=true;cGeom.attributes.uv.needsUpdate=true;}
 const state={ready:false,progress:0,playing:false,direction:1,shown:0,traceVertices:0,passIndex:0};
 function selectedColors(){const cs=[0,1,2,3].map(i=>$('stop'+i).value);if($('reverse').checked)cs.reverse();return cs;}
 function updateTerrainColors(cs=selectedColors()){
  const stops=($('demHeatmap').checked?cs:neutralRamps).map(c=>new T.Color(c));
  const min=+$('colorMin').value,max=+$('colorMax').value,span=Math.max(1,max-min);
  for(let k=0;k<w*h;k++){
   const t=T.MathUtils.clamp(((heights[k]??min)-min)/span,0,.999999)*3,i=Math.floor(t),f=t-i,o=k*3;
   colors[o]=stops[i].r+(stops[i+1].r-stops[i].r)*f;
   colors[o+1]=stops[i].g+(stops[i+1].g-stops[i].g)*f;
   colors[o+2]=stops[i].b+(stops[i+1].b-stops[i].b)*f;
  }
  geom.attributes.color.needsUpdate=true;
 }
 function palette(){const selected=$('palette').value;if(selected!=='custom')palettes[selected].forEach((c,i)=>$('stop'+i).value=c);const cs=selectedColors();cs.forEach((c,i)=>uniforms.stops.value[i].set(c));$('ramp').style.background=`linear-gradient(90deg,${cs.join(',')})`;updateTerrainColors(cs);}
 function updateScale(){const scale=+$('vertical').value;$('verticalValue').textContent=scale+'×';for(let j=0;j<h;j++)for(let i=0;i<w;i++){const k=j*w+i,v=lunar((dem.col0+i+.5)/64,90-(dem.row0+j+.5)/64,heights[k]??0,scale);pos.set(v,k*3);}geom.attributes.position.needsUpdate=true;geom.computeVertexNormals();for(const chunk of chunks.values())positionChunk(chunk,scale);activeTrailPid=null;updateReveal();}
 function updateReveal(){
  const progress=state.progress,mode=$('mode').value,curtain=mode==='curtain',passes=mode==='passes';uniforms.curtain.value=curtain?1:0;uniforms.threshold.value=minX+(maxX-minX)*progress;
  curtainMesh.visible=curtain&&$('curtainGlow').checked&&progress>0&&progress<1;if(curtainMesh.visible)curtainGeometry(progress);
  let cut=timeMin+(timeMax-timeMin)*progress,activePass=null;
  if(passes&&passList.length){const q=Math.min(passList.length-1,Math.floor(progress*passList.length)),f=Math.min(1,progress*passList.length-q);activePass=passList[q];cut=progress>=1?timeMax+1:activePass.min+(activePass.max-activePass.min)*f;state.passIndex=q+1;}
  else state.passIndex=0;
  const day=Math.floor(cut/86400);traceUniforms.cutDay.value=Number.isFinite(day)?day:0;traceUniforms.cutSec.value=Number.isFinite(cut)?cut-day*86400:0;traceUniforms.pulseEnabled.value=progress>0&&progress<1?1:0;
  let count=0,last=null,traceVertices=0;
  for(const chunk of chunks.values()){
   const revealed=curtain?chunk.count:progress>=1?chunk.count:progress<=0?0:lowerBound(chunk.times,cut);
   for(const [step,level] of Object.entries(chunk.levels))level.geometry.setDrawRange(0,+step===1?revealed:lowerBound(level.indices,revealed-1));
   const segments=curtain||progress<=0?0:progress>=1?chunk.trace.times.length:lowerBound(chunk.trace.times,cut);
   chunk.trace.geometry.setDrawRange(0,segments*2);chunk.trace.line.visible=!curtain&&$('traces').checked;traceVertices+=segments*2;
   count+=curtain?lowerBound(chunk.xSorted,uniforms.threshold.value):revealed;
   if(!curtain&&revealed){const t=chunk.times[revealed-1];if(!last||t>last.time)last={time:t,product:chunk.entry.products[chunk.product[revealed-1]]};}
  }
  state.shown=count;state.traceVertices=traceVertices;
  const trailPid=passes&&progress<1?activePass?.pid:null;if(trailPid!==activeTrailPid)rebuildActiveTrail(trailPid);
  const trailCount=trailPid&&progress>0?lowerBound(activeTrailTimes,cut):0;
  activeDashGeom.setDrawRange(0,trailCount*2);activeDotGeom.setDrawRange(0,trailCount);
  activeDash.visible=activeDots.visible=!!trailPid&&$('traces').checked&&trailCount>0;state.activeTrailCount=trailCount;
  const pulse=passes&&progress>0&&progress<1&&$('traces').checked&&activePass;
  // Linger on earlier real shot positions within the active pass. No positions are interpolated.
  const beamShots=[],trailPositions=activeDotGeom.attributes.position?.array;
  if(pulse&&trailPositions)for(let i=trailCount-1;i>=0&&beamShots.length<5;i--){
   const p=[trailPositions[i*3],trailPositions[i*3+1]-65,trailPositions[i*3+2]];
   if(beamShots.every(q=>Math.hypot(p[0]-q[0],p[2]-q[2])>7000))beamShots.push(p);
  }
  let beamCount=0;for(const p of beamShots){
   const o=beamCount*6,b=beamCount*3;
   beamPositions.set([p[0],p[1]+7500,p[2],p[0],p[1]+35,p[2]],o);
   beamGlows[beamCount].position.set(p[0],p[1]+3750,p[2]);
   headPositions.set([p[0],p[1]+35,p[2]],b);beamCount++;
  }
  beamGeometry.setDrawRange(0,beamCount*2);headGeometry.setDrawRange(0,beamCount);beamGeometry.attributes.position.needsUpdate=true;headGeometry.attributes.position.needsUpdate=true;beamLine.visible=heads.visible=!!pulse&&beamCount>0;beamGlows.forEach((m,i)=>m.visible=!!pulse&&i<beamCount);
  $('countLabel').textContent=`${count.toLocaleString()} / ${totalLoaded.toLocaleString()} loaded shots`;
  $('modeHint').textContent=curtain?'Decorative spatial sweep; unrelated to acquisition time.':passes?'Real shots in UTC order; quiet time between pass products is compressed.':'Actual UTC spacing from archived shot timestamps.';
  $('effectiveSpeed').textContent=`Effective playback ${((+$('speed').value)*($('accelerate').checked?1+3*progress:1)).toFixed(1)}×`;
  const utc=Number.isFinite(cut)?new Date(Date.parse('2009-01-01T00:00:00Z')+cut*1000).toISOString().slice(0,19):'—';
  $('timeLabel').textContent=curtain?`Spatial reveal · ${Math.round(progress*100)}% · decorative sweep`:passes?`PDS pass ${state.passIndex}/${passList.length} · ${activePass?.pid.replace('_DAT','')??'—'} · ${utc} UTC`:`${utc} UTC${last?' · '+last.product.replace('_DAT',''):''}`;
  $('timeline').value=Math.round(progress*1000);
 }
 function updateSample(){const step=$('density').value==='full'||camera.zoom>=3?1:camera.zoom>=1.7?8:16;if(step!==sampleStep){sampleStep=step;for(const chunk of chunks.values())for(const [n,level] of Object.entries(chunk.levels))level.halo.visible=level.cloud.visible=$('points').checked&&+n===step;}const size=+$('pointSize').value*(step>1?.7:1);uniforms.pointSize.value=size;haloMat.uniforms.pointSize.value=size*3.7;$('sampling').textContent=step===1?'Full acquired density':`Overview: ~1 of ${step} shots displayed`;}
 function controlsUpdate(){
  const mix=+$('surfaceMix').value/100;
  mesh.visible=$('terrain').checked&&!$('pointsOnly').checked;
  opticalMesh.visible=mesh.visible&&opticalReady&&mix>0;
  opticalMat.opacity=mix;
  $('surfaceMix').disabled=!opticalReady;
  $('surfaceDemLabel').textContent=$('demHeatmap').checked?'DEM heatmap':'Neutral DEM';
  $('surfaceMixValue').textContent=mix===0?$('surfaceDemLabel').textContent:mix===1?'LROC optical':`${Math.round(mix*100)}% optical`;
  uniforms.pointOpacity.value=opticalMesh.visible?1-mix*(1-(+$('laserOverlay').value/100)):1;
  $('laserOverlayValue').textContent=$('laserOverlay').value+'%';$('laserOverlay').disabled=!opticalMesh.visible||!$('points').checked;
  for(const chunk of chunks.values())for(const [n,level] of Object.entries(chunk.levels))level.halo.visible=level.cloud.visible=$('points').checked&&+n===sampleStep;
  haloMat.uniforms.glow.value=$('curtainGlow').checked?1:0;
  uniforms.rangeMin.value=+$('minElevation').value;uniforms.rangeMax.value=+$('maxElevation').value;
  uniforms.colorMin.value=+$('colorMin').value;uniforms.colorMax.value=+$('colorMax').value;
  uniforms.pointSize.value=+$('pointSize').value;haloMat.uniforms.pointSize.value=+$('pointSize').value*3.7;
  $('pointSizeValue').textContent=$('pointSize').value+' px';$('legendMin').textContent=$('colorMin').value;$('legendMax').textContent=$('colorMax').value;
  updateTerrainColors();updateSample();updateReveal();
 }
 for(const id of ['terrain','demHeatmap','surfaceMix','laserOverlay','points','pointsOnly','traces','curtainGlow','mode','speed','accelerate','density','minElevation','maxElevation','pointSize','colorMin','colorMax'])$(id).addEventListener('input',controlsUpdate);
 $('opticalFocus').onclick=()=>{
  if(!opticalFocusSaved){
   opticalFocusSaved={terrain:$('terrain').checked,demHeatmap:$('demHeatmap').checked,surfaceMix:$('surfaceMix').value,points:$('points').checked,pointsOnly:$('pointsOnly').checked,traces:$('traces').checked};
   $('terrain').checked=true;$('surfaceMix').value=100;$('points').checked=false;$('pointsOnly').checked=false;$('traces').checked=false;
   $('opticalFocus').textContent='Restore laser layers';$('opticalHint').textContent='LROC image only · elevations still shape the surface.';
  }else{
   for(const [id,value] of Object.entries(opticalFocusSaved))if(id==='surfaceMix')$(id).value=value;else $(id).checked=value;
   opticalFocusSaved=null;$('opticalFocus').textContent='Inspect LROC image';$('opticalHint').textContent='Drag Surface transition to compare DEM colors and LROC pixels.';
  }
  controlsUpdate();
 };
 $('vertical').addEventListener('input',updateScale);$('trueScale').onclick=()=>{$('vertical').value=1;updateScale();};$('palette').onchange=palette;$('reverse').onchange=palette;for(let i=0;i<4;i++)$('stop'+i).oninput=()=>{$('palette').value='custom';palette();};
 $('timeline').oninput=()=>{state.progress=+$('timeline').value/1000;updateReveal();};$('showAll').onclick=()=>{state.playing=false;state.progress=1;updateReveal();$('play').textContent='▶';};
 $('play').onclick=()=>{if(state.progress>=1)state.progress=0;state.playing=!state.playing;$('play').textContent=state.playing?'❚❚':'▶';updateReveal();};
 $('autoOrbit').onchange=()=>controls.autoRotate=$('autoOrbit').checked;
 for(const [id,dir] of [['clockwise',1],['counterclockwise',-1]])$(id).onclick=()=>{state.direction=dir;controls.autoRotateSpeed=.65*dir;$('clockwise').setAttribute('aria-pressed',String(dir===1));$('counterclockwise').setAttribute('aria-pressed',String(dir===-1));};
 $('settings').onclick=()=>$('panel').classList.toggle('open');palette();controlsUpdate();refreshManifest();setInterval(refreshManifest,12000);
 window.moonState=()=>({ready:state.ready,progress:state.progress,mode:$('mode').value,shown:state.shown,loaded:totalLoaded,acquired:manifest?.counts?.accepted??totalLoaded,chunks:chunks.size,complete:manifest?.complete??false,sampleStep,passIndex:state.passIndex,passCount:passList.length,playbackRate:(+$('speed').value)*($('accelerate').checked?1+3*state.progress:1),traceVertices:state.traceVertices,activeTrailCount:state.activeTrailCount??0,traceStats:{...traceStats},tracesVisible:$('traces').checked&&$('mode').value!=='curtain',beamSegments:beamGeometry.drawRange.count/2,terrain:mesh.visible,demHeatmap:$('demHeatmap').checked,surfaceMix:+$('surfaceMix').value/100,optical:opticalMesh.visible,opticalReady,opticalFocus:!!opticalFocusSaved,opticalOpacity:opticalMat.opacity,pointOpacity:uniforms.pointOpacity.value,points:$('points').checked,scale:+$('vertical').value,palette:$('palette').value,reverse:$('reverse').checked,zoom:camera.zoom,position:camera.position.toArray(),target:controls.target.toArray(),curtain:curtainMesh.visible,curtainVertices:cGeom.drawRange.count});
 let previous=performance.now();function animate(now){const dt=Math.min(.1,(now-previous)/1000);previous=now;if(state.playing){const speed=+$('speed').value,accel=$('accelerate').checked?(1+3*state.progress):1;state.progress=Math.min(1,state.progress+dt*.018*speed*accel);updateReveal();if(state.progress>=1){state.playing=false;$('play').textContent='▶';}}controls.update();for(const m of beamGlows)if(m.visible)m.rotation.y=Math.atan2(camera.position.x-m.position.x,camera.position.z-m.position.z);updateSample();renderer.render(scene,camera);requestAnimationFrame(animate);}requestAnimationFrame(animate);
}
main().catch(e=>{$('error').textContent=e.message;console.error(e)});
