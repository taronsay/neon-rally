import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.env.PORT || 8080);
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const WIDTH = 72, HEIGHT = 144, R = 1.5, PAD = 8, WALL_HEIGHT = 32;
const DT = 1 / 120;
const clients = new Map();
const rooms = new Map();
const sockRoom = new Map();
const json = (ws, data) => { if (ws?.readyState === WebSocket.OPEN && !(data.type==='state'&&ws.bufferedAmount>64000)) ws.send(JSON.stringify(data)); };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const now = () => Date.now();
const other = i => 1 - i;
const sign = i => i === 0 ? 1 : -1;
const safeName = s => String(s || 'Игрок').trim().slice(0, 18).replace(/[<>]/g, '') || 'Игрок';
const names = r => r.players.map((p,i) => p?.name || r.slots[i]?.name || null);
const members = r => r.players.filter(Boolean);
function lobby() {
  const tables = [...rooms.values()].filter(r => r.status !== 'finished').map(r => ({ id:r.id, host:names(r).join(' vs '), score:r.score, count:members(r).length, status:r.status }));
  for (const ws of clients.keys()) json(ws, { type:'lobby', tables });
}
function broadcast(r, obj) { for (const p of members(r)) json(p.ws, obj); }
function state(r) { return { type:'state', id:r.id, status:r.status, players:names(r), ready:r.ready, deadline:r.deadline, countdown:r.countdown, score:r.score, server:r.server, paddles:r.paddles.map(p => ({x:p.x,y:p.y,tx:p.tx,ty:p.ty,vx:p.vx,vy:p.vy})), ball:r.ball, msg:r.msg, winner:r.winner, round:r.round||0, effect:r.effect||null, serverTime:now(), graceUntil:r.graceUntil }; }
function sendState(r) { broadcast(r, state(r)); }
function assign(r, index, ws, name, token) { r.players[index] = { ws, name }; r.slots[index]={name,token}; sockRoom.set(ws, r.id); json(ws, { type:'joined', id:r.id, side:index }); }
function createRoom(ws, name, token) {
  if (sockRoom.has(ws)) leave(ws);
  const id = randomUUID().slice(0,8).toUpperCase();
  const r = { id, players:[null,null], slots:[null,null], ready:[false,false], status:'waiting', deadline:0, countdown:0, score:[0,0], server:0, winner:null, msg:'Ожидание соперника', paddles:[{x:0,y:-46,vx:0,vy:0,tx:0,ty:-46},{x:0,y:46,vx:0,vy:0,tx:0,ty:46}], ball:{x:0,y:-59,vx:0,vy:0,phase:'serve',wall:0,contactHalf:0}, graceUntil:0, disconnected:-1 };
  r.lagGrace=true;rooms.set(id,r); assign(r,0,ws,name,token); sendState(r); lobby();
}
function joinRoom(ws, name, roomId, token) {
  if (sockRoom.has(ws)) leave(ws);
  const r = rooms.get(String(roomId || '').toUpperCase());
  if (!r || r.players[1] || r.status !== 'waiting') return json(ws,{type:'error',message:'Этот стол уже занят или недоступен'});
  assign(r,1,ws,name,token); r.ready=[false,false]; r.deadline=now()+10000; r.status='ready'; r.msg='Оба игрока должны нажать «Готов»'; sendState(r); lobby();
}
function resetServe(r) {
 r.round=(r.round||0)+1;r.armed=false;r.effect=null;r.history=[];r.pendingPoint=null;
 r.ball={x:0,y:r.server===0?-88:88,z:10,vx:0,vy:0,vz:0,phase:'serve',last:r.server,bounces:0,walls:0,spin:0,shot:0};
 for(let i=0;i<2;i++){const p=r.paddles[i];Object.assign(p,{x:0,y:i===0?-102:102,tx:0,ty:i===0?-102:102,vx:0,vy:0});}
}
function start(r) {r.status='playing';r.deadline=0;r.ready=[true,true];r.score=[0,0];r.server=0;r.msg='Подача нижнего игрока';resetServe(r);sendState(r);lobby();}
function kickUnready(r) {
  if(!r.ready.some(Boolean)){for(const p of members(r)){sockRoom.delete(p.ws);json(p.ws,{type:'kicked',message:'Готовность не подтверждена'});}rooms.delete(r.id);lobby();return;}
  const bad=r.ready.findIndex(v => !v);
  if(bad<0) return start(r);
  const gone=r.players[bad];if(gone){ sockRoom.delete(gone.ws);json(gone.ws,{type:'kicked',message:'Вы не нажали «Готов» за 10 секунд'}); }
  r.players[bad]=null;r.slots[bad]=null;
  if (bad===0 && r.players[1]) {r.players[0]=r.players[1];r.players[1]=null;r.slots[0]=r.slots[1];r.slots[1]=null;sockRoom.set(r.players[0].ws,r.id);json(r.players[0].ws,{type:'joined',id:r.id,side:0});}
  r.status='waiting';r.deadline=0;r.ready=[false,false];r.msg='Ожидание соперника';r.slots=[r.players[0] ? r.slots[0] : null,null];if(!members(r).length) rooms.delete(r.id);else sendState(r);lobby();
}
function finish(r,winner,msg) {r.status='finished';r.winner=winner;r.msg=msg;r.deadline=0;sendState(r);lobby();setTimeout(()=>{if(rooms.get(r.id)===r)rooms.delete(r.id);},60000).unref();}
function point(r,winner,msg) {
 if(r.status!=='playing'||r.ball.phase==='dead')return;
 // Short grace window accepts a legitimate return already in flight over the network.
 if(r.lagGrace&&!r.resolvingPoint&&['Соперник не вернул мяч','Два отскока на половине соперника','Мяч вышел из игровой зоны'].includes(msg)&&r.ball.bounces>=1){
  r.pendingPoint={winner,msg,until:now()+100};r.ball.phase='pending';return;
 }
 r.ball.phase='dead';r.score[winner]++;r.server=winner;r.msg=msg;
 r.ball.vx=r.ball.vy=r.ball.vz=0;r.armed=false;
 if(r.score[winner]>=9&&r.score[winner]-r.score[other(winner)]>=2)return finish(r,winner,`Победил ${names(r)[winner]}!`);
 r.status='intermission';r.deadline=now()+1800;sendState(r);lobby();
}
function effect(r,kind,b){r.effect={id:randomUUID(),kind,x:b.x,y:b.y,z:b.z};}
function hit(r,i,serving) {
 const b=r.ball,p=r.paddles[i],dir=sign(i);
 const aim=clamp(p.vx*.055+(b.x-p.x)*2.5,-25,25);
 const targetY=dir*(serving?38:48), targetX=clamp(b.x+aim,-31,31);
 const duration=clamp(Math.abs(targetY-b.y)/195,.38,.95);
 b.vx=(targetX-b.x)/duration;b.vy=(targetY-b.y)/duration;
 b.z=10;b.vz=(R-b.z+150*duration*duration)/duration;
 b.shot=(b.shot||0)+1;r.pendingPoint=null;b.spin=clamp(p.vx*dir/450,-1,1);b.last=i;b.bounces=0;b.walls=0;b.phase='flight';b.cooldown=.10;r.armed=false;
 effect(r,'hit',b);r.msg=serving?'Подача':'Розыгрыш';
}
// Swept relative motion prevents fast cursor strokes jumping through the ball.
function contact(p,b,old=b,i=0){
 // Use the same projected position seen by this player. The racket automatically
 // meets the incoming height; there is no separate height control in this game.
 const by=old.y+sign(i)*old.z*.38,ey=b.y+sign(i)*b.z*.38;
 const ax=(old.x-(p.ox??p.x))/(PAD+R),ay=(by-(p.oy??p.y))/(PAD*1.13+R);
 const dx=(b.x-p.x)/(PAD+R)-ax,dy=(ey-p.y)/(PAD*1.13+R)-ay;
 const t=clamp(-(ax*dx+ay*dy)/(dx*dx+dy*dy||1),0,1);
 const z=old.z+(b.z-old.z)*t;
 return z>=R&&z<=55&&Math.hypot(ax+dx*t,ay+dy*t)<=1;
}
function tick(r) {
 if(r.status==='ready'){if(now()>=r.deadline)kickUnready(r);return;}
 if(r.status==='paused'){if(now()>=r.graceUntil)finish(r,other(r.disconnected),'Соперник отключился');return;}
 if(r.status==='intermission'){if(now()>=r.deadline){resetServe(r);r.status='playing';r.deadline=0;r.msg='Кликни, затем коснись мяча ракеткой';sendState(r);lobby();}return;}
 if(r.status!=='playing')return;
 for(const p of r.paddles){p.ox=p.x;p.oy=p.y;p.x=p.tx;p.y=p.ty;p.vx=clamp((p.x-p.ox)/DT,-450,450);p.vy=clamp((p.y-p.oy)/DT,-450,450);}
 const b=r.ball;
 if(r.pendingPoint){if(now()>=r.pendingPoint.until){const q=r.pendingPoint;r.pendingPoint=null;r.resolvingPoint=true;point(r,q.winner,q.msg);r.resolvingPoint=false;}return;}
 if(r.lagGrace&&b.phase==='flight'){
  r.history??=[];r.history.push({t:now(),round:r.round,b:{...b},paddles:r.paddles.map(p=>({x:p.x,y:p.y}))});while(r.history.length&&now()-r.history[0].t>160)r.history.shift();
 }
 if(b.phase==='serve'){const p=r.paddles[r.server];if(r.armed&&contact(p,b,b,r.server)&&Math.hypot(p.vx,p.vy)>5)hit(r,r.server,true);return;}
 if(b.phase!=='flight')return;
 const old={x:b.x,y:b.y,z:b.z};b.cooldown=Math.max(0,(b.cooldown||0)-DT);
 // Side spin applies a bounded sideways Magnus acceleration.
 const spin=b.spin||0, speed=Math.hypot(b.vx,b.vy)||1;
 b.vx+=spin*65*(b.vy/speed)*DT;b.vy-=spin*65*(b.vx/speed)*DT;b.spin=spin*Math.exp(-.12*DT);
 b.x+=b.vx*DT;b.y+=b.vy*DT;b.z+=b.vz*DT-150*DT*DT;b.vz-=300*DT;
 if(old.y*b.y<=0&&old.y!==b.y){const t=-old.y/(b.y-old.y),z=old.z+(b.z-old.z)*t;if(z<R+6)return point(r,other(b.last),'Мяч попал в сетку');}
 // A wall exists only beside the tabletop, not in the run-up area.
 const limit=WIDTH/2-R;
 if(Math.abs(b.y)<=HEIGHT/2 && b.z<=WALL_HEIGHT+R && Math.abs(b.x)>=limit && ((b.x>0&&b.vx>0)||(b.x<0&&b.vx<0))){
  const half=b.y<0?0:1;b.walls=(b.walls||0)+1;
  if(half===b.last)return point(r,other(b.last),'Фол: рикошет на своей половине');
  if(b.walls>1)return point(r,other(b.last),'Фол: второй рикошет от стены');
  b.x=Math.sign(b.x)*limit;b.vx*=-.94;b.spin*=-.75;effect(r,'wall',b);
 }
 const receiver=other(b.last),p=r.paddles[receiver];
 if(b.cooldown===0&&contact(p,b,old,receiver)){
  if(b.bounces!==1)return point(r,b.last,'Удар до отскока: фол');
  hit(r,receiver,false);return;
 }
 if(b.z<=R&&b.vz<0){
  const onTable=Math.abs(b.x)<=WIDTH/2&&Math.abs(b.y)<=HEIGHT/2;
  if(!onTable)return point(r,b.bounces===1?b.last:other(b.last),b.bounces===1?'Соперник не вернул мяч':'Мяч вне стола');
  const half=b.y<0?0:1;
  if(half===b.last)return point(r,other(b.last),'Мяч коснулся своей половины');
  b.bounces++;if(b.bounces>1)return point(r,b.last,'Два отскока на половине соперника');
  b.z=R;b.vz=Math.abs(b.vz)*.87;b.vx+=(b.spin||0)*sign(b.last)*22;effect(r,'bounce',b);
 }
 if(Math.abs(b.x)>80||Math.abs(b.y)>140)return point(r,b.bounces===1?b.last:other(b.last),'Мяч вышел из игровой зоны');
}
function leave(ws) {
  const id=sockRoom.get(ws);if(!id)return;
  sockRoom.delete(ws);const r=rooms.get(id);if(!r)return;
  const i=r.players.findIndex(p=>p?.ws===ws);if(i<0)return;
  r.players[i]=null;
  if(['playing','intermission'].includes(r.status)){r.previousStatus=r.status;r.pauseRemaining=Math.max(0,r.deadline-now());r.status='paused';r.disconnected=i;r.graceUntil=now()+15000;r.msg='Соперник отключился. Пауза до 15 секунд';sendState(r);}
  else if(r.status==='paused'){sendState(r);}
  else {
    if(i===0&&r.players[1]){r.players[0]=r.players[1];r.players[1]=null;r.slots[0]=r.slots[1];r.slots[1]=null;json(r.players[0].ws,{type:'joined',id:r.id,side:0});}
    r.status='waiting';r.deadline=0;r.ready=[false,false];r.msg='Ожидание соперника';r.slots=[r.players[0] ? r.slots[0] : null,null];
    if(!members(r).length)rooms.delete(id);else sendState(r);
  }
  lobby();
}
function compensateStrike(r,i,m){
 const b=r.ball;
 if(r.status!=='playing'||!['flight','pending'].includes(b.phase)||b.last===i||m.round!==r.round||m.shot!==b.shot)return;
 const p=r.paddles[i],samples=[{t:now(),b},...(r.history||[])].filter(q=>now()-q.t<=140&&q.b.shot===b.shot&&q.b.last!==i&&q.b.bounces===1);
 const sample=samples.find(q=>contact({x:p.tx,y:p.ty,ox:q.paddles?.[i]?.x??p.x,oy:q.paddles?.[i]?.y??p.y},q.b,q.b,i));
 if(!sample)return;
 Object.assign(b,sample.b);p.x=p.tx;p.y=p.ty;
 p.vx=clamp(Number(m.strokeX)||0,-450,450);hit(r,i,false);sendState(r);
}
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/play'||pathname==='/play/'){
   const html=(await readFile(new URL('./embed.html',import.meta.url),'utf8')).replace("const WS_URL = 'wss://YOUR-SERVER-DOMAIN.example';","const WS_URL = (location.protocol==='https:'?'wss://':'ws://')+location.host;").replace("import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';","import * as THREE from '/three.module.js';");
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Neon Rally · LAN</title><style>body{margin:0;background:#020a1b}</style>'+html);return;
  }
  if(pathname==='/three.module.js'||pathname==='/three.core.js'){
   const file=pathname.slice(1);res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(new URL('./node_modules/three/build/'+file,import.meta.url)));return;
  }
  res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify({name:'Neon Rally WS',online:true,tables:rooms.size}));
 }catch{res.writeHead(500,{'Content-Type':'text/plain'});res.end('Run npm install, then npm start.');}
});
const wss=new WebSocketServer({ maxPayload:2048, server, verifyClient: info => !ORIGINS.length || ORIGINS.includes(info.origin) });
wss.on('connection',ws=>{
  ws._socket?.setNoDelay(true);
  clients.set(ws,{name:'Игрок',lastInput:0});json(ws,{type:'hello'});lobby();
  ws.on('message',raw=>{
    if(raw.length>2048)return;let m;try{m=JSON.parse(raw.toString())}catch{return};
    const c=clients.get(ws);if(!c)return;
    if(m.type==='ping')return json(ws,{type:'pong',sent:m.sent,serverTime:now()});
    if(m.type==='list')return lobby();
    if(m.type==='create')return createRoom(ws,safeName(m.name),String(m.token||''));
    if(m.type==='join')return joinRoom(ws,safeName(m.name),m.id,String(m.token||''));
    if(m.type==='resume'){const r=rooms.get(String(m.id||'').toUpperCase());const i=r?.slots.findIndex((slot,j)=>slot?.token && slot.token===m.token && !r.players[j]);if(i===undefined||i<0||!r||r.status!=='paused'||now()>=r.graceUntil||i!==r.disconnected)return json(ws,{type:'resume_failed'});r.players[i]={ws,name:r.slots[i].name};sockRoom.set(ws,r.id);r.status=r.previousStatus||'playing';if(r.status==='intermission')r.deadline=now()+r.pauseRemaining;r.disconnected=-1;r.msg='Соперник вернулся';json(ws,{type:'joined',id:r.id,side:i});sendState(r);lobby();return;}
    if(m.type==='leave')return leave(ws);
    const r=rooms.get(sockRoom.get(ws));if(!r)return;
    const i=r.players.findIndex(p=>p?.ws===ws);if(i<0)return;
    if(m.type==='ready'&&r.status==='ready') {r.ready[i]=true;if(r.ready.every(Boolean))start(r);else sendState(r);return;}
    if(m.type==='serve'&&r.status==='playing'&&r.ball.phase==='serve'&&r.server===i){r.armed=true;return;}
    if(m.type==='move'&&r.status==='playing') {
      c.lastInput=now();
      if(!Number.isFinite(m.x)||!Number.isFinite(m.y))return;
      const p=r.paddles[i];p.tx=clamp(m.x,-58,58);
      p.ty=i===0?clamp(m.y,-112,-PAD):clamp(m.y,PAD,112);
      if(m.strike)compensateStrike(r,i,m);
    }
  });
  ws.on('close',()=>{leave(ws);clients.delete(ws);lobby();});
  ws.on('error',()=>{});
});
let accumulator=0;let prev=performance.now(),lastBroadcast=0;setInterval(()=>{
 const t=performance.now();accumulator=Math.min(accumulator+(t-prev)/1000,0.1);prev=t;
 while(accumulator>=DT){for(const r of [...rooms.values()])tick(r);accumulator-=DT;}
 if(t-lastBroadcast>=1000/60){lastBroadcast=t;for(const r of rooms.values())if(r.status!=='waiting')sendState(r);}
},1000/120);
setInterval(lobby,1000).unref();
server.listen(PORT,'0.0.0.0',()=>{console.log(`Neon Rally server listening on ${PORT}\nLocal: http://localhost:${PORT}/play`);try{for(const list of Object.values(networkInterfaces()))for(const nic of list||[])if(nic.family==='IPv4'&&!nic.internal)console.log(`LAN: http://${nic.address}:${PORT}/play`);}catch{console.log('LAN: open http://YOUR_LOCAL_IP:'+PORT+'/play');}});
