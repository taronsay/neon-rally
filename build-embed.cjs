// Regenerate the shared prediction kernel after editing server physics.
const fs=require('node:fs'),path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
function extract(name){const start=server.indexOf('function '+name+'('),brace=server.indexOf('{',start);let d=1,j=brace+1;for(;d;j++){if(server[j]==='{')d++;if(server[j]==='}')d--;}return server.slice(start,j);}
const kernel=`// BEGIN SHARED PHYSICS: same collision/flight functions as server.js.
const predictor=(()=>{
 const WIDTH=W,HEIGHT=H,WALL_HEIGHT=32,DT=1/120;
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),other=i=>1-i,sign=i=>i===0?1:-1;
 const now=()=>Date.now()+clockOffset,randomUUID=uid,names=r=>r.players;
 const sendState=()=>{},lobby=()=>{},kickUnready=()=>{};
 function finish(r,winner,msg){r.status='finished';r.winner=winner;r.msg=msg;}
${['resetServe','point','effect','hit','contact','tick'].map(extract).join('\n')}
return {tick};})();
// END SHARED PHYSICS`;
const file=path.join(__dirname,'embed.html'),text=fs.readFileSync(file,'utf8');fs.writeFileSync(file,text.replace(/\/\/ BEGIN SHARED PHYSICS[\s\S]*?\/\/ END SHARED PHYSICS/,kernel));
