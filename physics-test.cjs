const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let time=1000;
const code=fs.readFileSync(__dirname+'/server.js','utf8').replace(/^import .*;\n/gm,'').split('const server=http.createServer')[0];
const ctx={process:{env:{}},Date:{now:()=>time},randomUUID:()=>String(Math.random()),WebSocket:{OPEN:1},setTimeout:()=>({unref(){}}),console};vm.createContext(ctx);vm.runInContext(code+'\nglobalThis.api={tick,hit,point,resetServe};',ctx);const {tick,hit,point,resetServe}=ctx.api;
function room(){return {status:'playing',score:[0,0],server:0,players:[null,null],slots:[null,null],paddles:[{},{}],ready:[true,true],round:0};}
let r=room();resetServe(r);r.paddles[1].x=50;r.paddles[1].tx=50;r.armed=true;r.paddles[0].tx=0;r.paddles[0].ty=-85;
for(let n=0;n<30;n++)tick(r);assert.equal(r.ball.phase,'flight','serve launches on a fresh armed stroke');
let bounced=false;for(let n=0;n<240&&r.status==='playing';n++){tick(r);if(r.ball.bounces===1)bounced=true;}assert(bounced,'serve lands on opponent table');assert.equal(r.score[0],1,'missed return awards server');assert.equal(r.status,'intermission');
for(let n=0;n<500;n++)tick(r);assert.equal(r.score[0],1,'pause cannot repeatedly score');time+=1801;tick(r);assert.equal(r.ball.phase,'serve');assert.equal(r.armed,false,'new round requires new click');for(let n=0;n<100;n++)tick(r);assert.equal(r.score[0],1);
r=room();resetServe(r);Object.assign(r.ball,{phase:'flight',last:0,bounces:0,x:0,y:0.1,z:2,vx:0,vy:100,vz:0});r.ball.y=-.1;tick(r);assert.equal(r.score[1],1,'net fault awards opponent');
r=room();resetServe(r);r.score=[8,8];point(r,0,'test');assert.equal(r.status,'intermission');time+=1801;tick(r);point(r,1,'test');assert.equal(r.status,'intermission');time+=1801;tick(r);point(r,0,'test');time+=1801;tick(r);point(r,0,'test');assert.equal(r.status,'finished','win by two beyond nine');
console.log('PASS: serve trajectory, landing, missed return, round lock, click reset, net, deuce');
