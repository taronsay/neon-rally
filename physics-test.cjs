const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let time=1000;
const code=fs.readFileSync(__dirname+'/server.js','utf8').replace(/^import .*;\n/gm,'').split('const server=http.createServer')[0];
const ctx={process:{env:{}},Date:{now:()=>time},randomUUID:()=>String(Math.random()),WebSocket:{OPEN:1},setTimeout:()=>({unref(){}}),console};vm.createContext(ctx);vm.runInContext(code+'\nglobalThis.api={tick,hit,point,resetServe,contact,compensateStrike};',ctx);const {tick,hit,point,resetServe,contact,compensateStrike}=ctx.api;
function room(){return {status:'playing',score:[0,0],server:0,players:[null,null],slots:[null,null],paddles:[{},{}],ready:[true,true],round:0};}
let r=room();resetServe(r);r.paddles[1].x=50;r.paddles[1].tx=50;r.armed=true;r.paddles[0].tx=0;r.paddles[0].ty=-85;
for(let n=0;n<30;n++)tick(r);assert.equal(r.ball.phase,'flight','serve launches on a fresh armed stroke');
let bounced=false;for(let n=0;n<240&&r.status==='playing';n++){tick(r);if(r.ball.bounces===1)bounced=true;}assert(bounced,'serve lands on opponent table');assert.equal(r.score[0],1,'missed return awards server');assert.equal(r.status,'intermission');
for(let n=0;n<500;n++)tick(r);assert.equal(r.score[0],1,'pause cannot repeatedly score');time+=1801;tick(r);assert.equal(r.ball.phase,'serve');assert.equal(r.armed,false,'new round requires new click');for(let n=0;n<100;n++)tick(r);assert.equal(r.score[0],1);
r=room();resetServe(r);Object.assign(r.ball,{phase:'flight',last:0,bounces:0,x:0,y:0.1,z:2,vx:0,vy:100,vz:0});r.ball.y=-.1;tick(r);assert.equal(r.score[1],1,'net fault awards opponent');
r=room();resetServe(r);r.score=[8,8];point(r,0,'test');assert.equal(r.status,'intermission');time+=1801;tick(r);point(r,1,'test');assert.equal(r.status,'intermission');time+=1801;tick(r);point(r,0,'test');time+=1801;tick(r);point(r,0,'test');assert.equal(r.status,'finished','win by two beyond nine');
console.log('PASS: serve trajectory, landing, missed return, round lock, click reset, net, deuce');
function wallRoom(y,walls=0){const r=room();resetServe(r);r.paddles[0].x=r.paddles[0].tx=50;r.paddles[1].x=r.paddles[1].tx=50;Object.assign(r.ball,{phase:'flight',x:34.4,y,z:20,vx:100,vy:30,vz:0,last:0,bounces:0,walls,spin:.5,cooldown:1});return r;}
r=wallRoom(40);tick(r);assert.equal(r.score[1],0);assert(r.ball.vx<0);assert.equal(r.ball.walls,1);
r=wallRoom(-40);tick(r);assert.equal(r.score[1],1,'own-side wall is a fault');
r=wallRoom(40,1);tick(r);assert.equal(r.score[1],1,'second wall is a fault');
r=wallRoom(40);r.ball.z=45;tick(r);assert(r.ball.vx>0,'ball above wall does not ricochet');
r=room();resetServe(r);r.armed=true;Object.assign(r.paddles[0],{x:-30,tx:30,y:-88,ty:-88});tick(r);assert.equal(r.ball.phase,'flight','fast stroke cannot tunnel');assert(Math.abs(r.ball.spin)>.9,'sideways stroke produces spin');
const straight=room(),curved=room();resetServe(straight);resetServe(curved);for(const q of [straight,curved]){Object.assign(q.ball,{phase:'flight',x:0,y:20,z:25,vx:0,vy:100,vz:30,last:0,bounces:0,cooldown:1,spin:0});}curved.ball.spin=1;for(let n=0;n<20;n++){tick(straight);tick(curved);}assert(curved.ball.x>straight.ball.x+.5,'spin curves flight');
console.log('PASS: legal wall, own-side fault, second wall fault, wall height, swept stroke, spin trajectory');
assert(contact({x:0,y:84.8,ox:0,oy:84.8},{x:0,y:100,z:40},{x:0,y:100,z:40},1),'collision matches the visible projected ball on top side');
assert(contact({x:0,y:-84.8,ox:0,oy:-84.8},{x:0,y:-100,z:40},{x:0,y:-100,z:40},0),'collision matches bottom projection');
assert(!contact({x:0,y:122.8,ox:0,oy:122.8},{x:0,y:100,z:60},{x:0,y:100,z:60},0),'height outside playable reach is rejected');
r=room();resetServe(r);r.lagGrace=true;Object.assign(r.ball,{phase:'pending',shot:3,last:0,bounces:2,x:0,y:110,z:2});r.pendingPoint={winner:0,msg:'Соперник не вернул мяч',until:time+100};Object.assign(r.paddles[1],{x:0,y:70.5,tx:0,ty:70.5});r.history=[{t:time-80,b:{...r.ball,phase:'flight',bounces:1,x:0,y:80,z:25},paddles:[{x:0,y:-105},{x:0,y:70.5}]}];
compensateStrike(r,1,{round:r.round,shot:3,strokeX:120});assert.equal(r.ball.last,1,'recent delayed strike is accepted');assert.equal(r.ball.phase,'flight');assert.equal(r.pendingPoint,null);assert.equal(r.ball.shot,4);compensateStrike(r,1,{round:r.round,shot:3,strokeX:120});assert.equal(r.ball.shot,4,'late duplicate cannot hit twice');
r=room();resetServe(r);r.lagGrace=true;Object.assign(r.ball,{phase:'flight',shot:3,last:0,bounces:1,x:50,y:100,z:20});Object.assign(r.paddles[1],{x:0,y:70.5,tx:0,ty:70.5});r.history=[{t:time-180,b:{...r.ball,x:0,y:80,z:25},paddles:[{},{}]}];compensateStrike(r,1,{round:r.round,shot:3,strokeX:100});assert.equal(r.ball.last,0,'old history is not accepted');
r=room();resetServe(r);r.lagGrace=true;r.ball.phase='flight';r.ball.bounces=1;point(r,0,'Соперник не вернул мяч');assert.equal(r.score[0],0,'network grace postpones missed-return score');time+=101;tick(r);assert.equal(r.score[0],1);assert.equal(r.status,'intermission');
console.log('PASS: both projected collision views, high ball reach, delayed return, duplicate rejection, stale history rejection, grace expiry');
