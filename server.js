import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 8080);
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const WIDTH = 160, HEIGHT = 90, R = 1.85, PAD = 5, SPEED = 89;
const DT = 1 / 60;
const clients = new Map();
const rooms = new Map();
const sockRoom = new Map();
const json = (ws, data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const now = () => Date.now();
const other = i => 1 - i;
const sign = i => i === 0 ? 1 : -1;
const safeName = s => String(s || 'Игрок').trim().slice(0, 18).replace(/[<>]/g, '') || 'Игрок';
const names = r => r.players.map((p,i) => p?.name || r.slots[i]?.name || null);
const members = r => r.players.filter(Boolean);
function lobby() {
  const tables = [...rooms.values()].filter(r => r.status !== 'finished').map(r => ({ id:r.id, host:r.players[0]?.name || 'Игрок', count:members(r).length, status:r.status }));
  for (const ws of clients.keys()) json(ws, { type:'lobby', tables });
}
function broadcast(r, obj) { for (const p of members(r)) json(p.ws, obj); }
function state(r) { return { type:'state', id:r.id, status:r.status, players:names(r), ready:r.ready, deadline:r.deadline, countdown:r.countdown, score:r.score, server:r.server, paddles:r.paddles.map(p => ({x:p.x,y:p.y})), ball:r.ball, msg:r.msg, winner:r.winner }; }
function sendState(r) { broadcast(r, state(r)); }
function assign(r, index, ws, name, token) { r.players[index] = { ws, name }; r.slots[index]={name,token}; sockRoom.set(ws, r.id); json(ws, { type:'joined', id:r.id, side:index }); }
function createRoom(ws, name, token) {
  if (sockRoom.has(ws)) leave(ws);
  const id = randomUUID().slice(0,8).toUpperCase();
  const r = { id, players:[null,null], slots:[null,null], ready:[false,false], status:'waiting', deadline:0, countdown:0, score:[0,0], server:0, winner:null, msg:'Ожидание соперника', paddles:[{x:0,y:-24,vx:0,vy:0,tx:0,ty:-24},{x:0,y:24,vx:0,vy:0,tx:0,ty:24}], ball:{x:0,y:-36,vx:0,vy:0,phase:'serve',wall:0,contactHalf:0}, graceUntil:0, disconnected:-1 };
  rooms.set(id,r); assign(r,0,ws,name,token); sendState(r); lobby();
}
function joinRoom(ws, name, roomId, token) {
  if (sockRoom.has(ws)) leave(ws);
  const r = rooms.get(String(roomId || '').toUpperCase());
  if (!r || r.players[1] || r.status !== 'waiting') return json(ws,{type:'error',message:'Этот стол уже занят или недоступен'});
  assign(r,1,ws,name,token); r.ready=[false,false]; r.deadline=now()+10000; r.status='ready'; r.msg='Оба игрока должны нажать «Готов»'; sendState(r); lobby();
}
function resetServe(r) {r.ball={x:0,y:r.server===0 ? -68:68,vx:0,vy:0,phase:'serve',wall:0,contactHalf:r.server}; r.paddles[0].x=0;r.paddles[0].y=-49;r.paddles[0].tx=0;r.paddles[0].ty=-49;r.paddles[1].x=0;r.paddles[1].y=49;r.paddles[1].tx=0;r.paddles[1].ty=49; }
function start(r) {r.status='playing';r.deadline=0;r.ready=[true,true];r.score=[0,0];r.server=0;r.msg='Подача нижнего игрока';resetServe(r);sendState(r);lobby();}
function kickUnready(r) {
  const bad=r.ready.findIndex(v => !v);
  if(bad<0) return start(r);
  const gone=r.players[bad];if(gone){ sockRoom.delete(gone.ws);json(gone.ws,{type:'kicked',message:'Вы не нажали «Готов» за 10 секунд'}); }
  r.players[bad]=null;r.slots[bad]=null;
  if (bad===0 && r.players[1]) {r.players[0]=r.players[1];r.players[1]=null;r.slots[0]=r.slots[1];r.slots[1]=null;sockRoom.set(r.players[0].ws,r.id);json(r.players[0].ws,{type:'joined',id:r.id,side:0});}
  r.status='waiting';r.deadline=0;r.ready=[false,false];r.msg='Ожидание соперника';r.slots=[r.players[0] ? r.slots[0] : null,null];if(!members(r).length) rooms.delete(r.id);else sendState(r);lobby();
}
function finish(r,winner,msg) {r.status='finished';r.winner=winner;r.msg=msg;r.deadline=0;sendState(r);lobby();setTimeout(()=>{if(rooms.get(r.id)===r)rooms.delete(r.id);},60000).unref();}
function point(r, winner, msg) {
  r.score[winner]++;r.server=winner;r.msg=msg;
  if (r.score[winner]>=9 && r.score[winner]-r.score[other(winner)]>=2) return finish(r,winner,`Победил ${r.players[winner]?.name || 'игрок'}! ${msg}`);
  resetServe(r);
}
function hit(r, i, serving) {
  const b=r.ball,p=r.paddles[i];
  const dir=sign(i); // bottom shoots positive Y, top shoots negative Y
  // Moving sideways changes shot direction; a forward-directed stroke increases speed.
  const movementX=clamp(p.vx/65,-0.9,0.9);
  const movementY=clamp(p.vy*dir/75,-0.35,0.4);
  const offset=clamp((b.x-p.x)/PAD,-1,1);
  const nx=clamp(movementX*0.70+offset*0.55,-0.87,0.87);
  const base=serving?67:clamp(Math.hypot(b.vx,b.vy)*1.035+2,68,105);
  b.vx=nx*base;
  b.vy=dir*Math.sqrt(Math.max(1,base*base-b.vx*b.vx))*(1+Math.max(0,movementY)*0.16);
  b.phase='flight';b.wall=0;b.contactHalf=i;
  b.y=p.y+dir*(PAD+R+0.4);
  r.msg=serving?'Подача!':'Розыгрыш';
}
function tick(r) {
  if (r.status==='ready') {if(now()>=r.deadline) kickUnready(r);return;}
  if(r.status==='paused') {if(now()>=r.graceUntil)finish(r,other(r.disconnected),'Соперник отключился: техническая победа');return;}
  if(r.status!=='playing')return;
  for(let i=0;i<2;i++) {
    const p=r.paddles[i], dx=p.tx-p.x,dy=p.ty-p.y,dist=Math.hypot(dx,dy);
    const step=Math.min(SPEED*DT,dist);const ox=p.x,oy=p.y;
    if(dist>0.0001) {p.x+=dx/dist*step;p.y+=dy/dist*step;}
    p.vx=(p.x-ox)/DT;p.vy=(p.y-oy)/DT;
  }
  const b=r.ball;
  if(b.phase==='serve') {
    const i=r.server,p=r.paddles[i];
    if(Math.hypot(b.x-p.x,b.y-p.y)<=R+PAD && Math.hypot(p.vx,p.vy)>9) hit(r,i,true);
    return;
  }
  // Substeps avoid tunneling even at high velocity.
  for(let sub=0;sub<3;sub++) {
    const dt=DT/3,oldY=b.y;
    b.x+=b.vx*dt;b.y+=b.vy*dt;
    if(b.x < -WIDTH/2+R || b.x > WIDTH/2-R) {
      b.x=clamp(b.x,-WIDTH/2+R,WIDTH/2-R);b.vx*=-1;b.wall++;
      if((b.y<0?0:1)===b.contactHalf)return point(r,other(b.contactHalf),'Фол: отскок от борта на своей половине');
      if(b.wall>1) return point(r,other(b.contactHalf),'Фол: больше одного отскока от бокового борта');
    }
    // The two end lines are goals, not reflective walls.
    if(b.y< -HEIGHT/2-R) return point(r,1,'Очко: мяч вышел за нижнюю линию');
    if(b.y> HEIGHT/2+R) return point(r,0,'Очко: мяч вышел за верхнюю линию');
    const half=b.y<0?0:1;
    for(let i=0;i<2;i++) {
      const p=r.paddles[i];if(half!==i)continue;
      const d=Math.hypot(b.x-p.x,b.y-p.y);
      if(d<R+PAD) {
        // A player cannot touch the ball twice without it crossing the center line.
        if(b.contactHalf===i) return point(r,other(i),'Фол: двойное касание на своей половине');
        hit(r,i,false);return;
      }
    }
  }
}
function leave(ws) {
  const id=sockRoom.get(ws);if(!id)return;
  sockRoom.delete(ws);const r=rooms.get(id);if(!r)return;
  const i=r.players.findIndex(p=>p?.ws===ws);if(i<0)return;
  r.players[i]=null;
  if(r.status==='playing'){r.status='paused';r.disconnected=i;r.graceUntil=now()+15000;r.msg='Соперник отключился. Пауза до 15 секунд';sendState(r);}
  else if(r.status==='paused'){sendState(r);}
  else {
    if(i===0&&r.players[1]){r.players[0]=r.players[1];r.players[1]=null;json(r.players[0].ws,{type:'joined',id:r.id,side:0});}
    r.status='waiting';r.deadline=0;r.ready=[false,false];r.msg='Ожидание соперника';r.slots=[r.players[0] ? r.slots[0] : null,null];
    if(!members(r).length)rooms.delete(id);else sendState(r);
  }
  lobby();
}
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify({name:'Neon Rally WS',online:true,tables:rooms.size}));});
const wss=new WebSocketServer({ server, verifyClient: info => !ORIGINS.length || ORIGINS.includes(info.origin) });
wss.on('connection',ws=>{
  clients.set(ws,{name:'Игрок',lastInput:0});json(ws,{type:'hello'});lobby();
  ws.on('message',raw=>{
    if(raw.length>2048)return;let m;try{m=JSON.parse(raw.toString())}catch{return};
    const c=clients.get(ws);if(!c)return;
    if(m.type==='list')return lobby();
    if(m.type==='create')return createRoom(ws,safeName(m.name),String(m.token||''));
    if(m.type==='join')return joinRoom(ws,safeName(m.name),m.id,String(m.token||''));
    if(m.type==='resume'){const r=rooms.get(String(m.id||'').toUpperCase());const i=r?.slots.findIndex((slot,j)=>slot?.token && slot.token===m.token && !r.players[j]);if(i===undefined||i<0||!r||r.status!=='paused'||now()>=r.graceUntil||i!==r.disconnected)return json(ws,{type:'resume_failed'});r.players[i]={ws,name:r.slots[i].name};sockRoom.set(ws,r.id);r.status='playing';r.disconnected=-1;r.msg='Соперник вернулся';json(ws,{type:'joined',id:r.id,side:i});sendState(r);lobby();return;}
    if(m.type==='leave')return leave(ws);
    const r=rooms.get(sockRoom.get(ws));if(!r)return;
    const i=r.players.findIndex(p=>p?.ws===ws);if(i<0)return;
    if(m.type==='ready'&&r.status==='ready') {r.ready[i]=true;if(r.ready.every(Boolean))start(r);else sendState(r);return;}
    if(m.type==='move'&&r.status==='playing') {
      if(now()-c.lastInput<12)return;c.lastInput=now();
      if(!Number.isFinite(m.x)||!Number.isFinite(m.y))return;
      const p=r.paddles[i];p.tx=clamp(m.x,-WIDTH/2+PAD,WIDTH/2-PAD);
      p.ty=i===0?clamp(m.y,-HEIGHT/2+PAD,-PAD):clamp(m.y,PAD,HEIGHT/2-PAD);
    }
  });
  ws.on('close',()=>{leave(ws);clients.delete(ws);lobby();});
  ws.on('error',()=>{});
});
let accumulator=0;let prev=performance.now();setInterval(()=>{
 const t=performance.now();accumulator=Math.min(accumulator+(t-prev)/1000,0.1);prev=t;
 while(accumulator>=DT){for(const r of [...rooms.values()])tick(r);accumulator-=DT;}
 for(const r of rooms.values())if(r.status!=='waiting')sendState(r);
},1000/30);
server.listen(PORT,'0.0.0.0',()=>console.log(`Neon Rally server listening on ${PORT}`));
