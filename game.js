// game.js
// Main orchestrator: initializes Leaflet map, overlay canvas, game loop, UI, spawn system, auto-PVO and more.
window.addEventListener('DOMContentLoaded', () => {
  // сюда вставь весь код меню
});
// --- Map & overlay setup ---
const map = L.map('map', { zoomControl: true }).setView([50.45, 30.52], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(map);

const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');

function resizeOverlay(){
  const r = document.getElementById('map').getBoundingClientRect();
  overlay.width = Math.floor(r.width);
  overlay.height = Math.floor(r.height);
  overlay.style.left = r.left + 'px';
  overlay.style.top = r.top + 'px';
}
window.addEventListener('resize', resizeOverlay);
map.on('move', ()=>{}); map.on('zoom', ()=>{ resizeOverlay(); });

setTimeout(resizeOverlay, 80);

// helpers: convert latlng to pixel on overlay
function latLngToOverlay(latlng){
  const p = map.latLngToContainerPoint(L.latLng(latlng[0], latlng[1]));
  return { x: p.x, y: p.y };
}
function overlayToLatLng(x,y){
  const latlng = map.containerPointToLatLng(L.point(x, y));
  return [latlng.lat, latlng.lng];
}

// --- Game state ---
let entities = {
  targets: [],
  missiles: [],
  explosions: [],
  batteries: []
};
let running = false, paused = false;
let score = 0, funds = 300;
let startTS = null;
let spawnInterval = 1800; // ms

// UI refs
const logEl = document.getElementById('log');
const scoreEl = document.getElementById('score');
const fundsEl = document.getElementById('money');
const timeEl = document.getElementById('time');
const toggleAutoBtn = document.getElementById('toggleAuto');

function log(msg){
  const t = new Date().toLocaleTimeString();
  logEl.innerText = `${t} — ${msg}\n` + logEl.innerText;
}

// --- Spawning ---
function randomPointAround(center, maxMeters){
  const angle = Math.random()*Math.PI*2;
  const dist = Math.random()*maxMeters;
  const dx = (dist/111320) * Math.cos(angle);
  const dy = (dist/111320) * Math.sin(angle) / Math.cos(center[0]*Math.PI/180);
  return [center[0] + dy, center[1] + dx];
}
function spawn(type){
  const center = map.getCenter();
  if (type === 'plane'){
    const p = randomPointAround([center.lat, center.lng], 35000);
    entities.targets.push(new Target('plane', p, Util.rand(0,360), Util.rand(140,220)));
  } else if (type === 'drone'){
    const p = randomPointAround([center.lat, center.lng], 20000);
    entities.targets.push(new Target('drone', p, Util.rand(0,360), Util.rand(20,80)));
  } else if (type === 'cruise'){
    const p = randomPointAround([center.lat, center.lng], 45000);
    entities.targets.push(new Target('cruise', p, Util.rand(0,360), Util.rand(300,700)));
  }
}

// UI spawn buttons
document.getElementById('spawnPlane').addEventListener('click', ()=>{ spawn('plane'); log('Spawned plane'); });
document.getElementById('spawnDrone').addEventListener('click', ()=>{ spawn('drone'); log('Spawned drone'); });
document.getElementById('spawnCruise').addEventListener('click', ()=>{ spawn('cruise'); log('Spawned cruise missile'); });

// --- Batteries (player assets) ---
function buildBatteryAtCenter(){
  if (funds < 100){ log('Not enough funds'); return; }
  funds -= 100; fundsEl.innerText = 'Funds: ' + funds;
  const c = map.getCenter();
  const b = new Battery([c.lat, c.lng]);
  entities.batteries.push(b);
  log('Battery constructed at center');
}
document.getElementById('buildBattery').addEventListener('click', buildBatteryAtCenter);

document.getElementById('upgradeRadar').addEventListener('click', ()=>{
  if (funds < 200 || entities.batteries.length===0){ log('Not enough funds or no batteries'); return; }
  funds -= 200; fundsEl.innerText = 'Funds: ' + funds;
  entities.batteries.forEach(b=>b.upgrade());
  log('Batteries upgraded');
});

let autoPVO = false;
toggleAutoBtn.addEventListener('click', ()=>{
  autoPVO = !autoPVO;
  toggleAutoBtn.innerText = `Auto-PVO: ${autoPVO ? 'ON' : 'OFF'}`;
  log('Auto-PVO ' + (autoPVO ? 'enabled' : 'disabled'));
});

// --- Map click to fire missile manually from nearest battery or center ---
overlay.addEventListener('click', (ev)=>{
  const rect = overlay.getBoundingClientRect();
  const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  // choose nearest battery to screen center, else center
  let source = entities.batteries.length ? entities.batteries[0] : { latlng: [map.getCenter().lat, map.getCenter().lng] };
  // find nearest target to clicked point
  const latlngClicked = overlayToLatLng(x,y);
  if (entities.targets.length === 0){ log('No targets'); return; }
  let closest = null, dmin = Infinity;
  for (let t of entities.targets){
    const d = Util.haversine(t.latlng, latlngClicked);
    if (d < dmin){ dmin = d; closest = t; }
  }
  if (closest && dmin < 80000){
    entities.missiles.push(new Missile(source.latlng, closest.id, 900, 35));
    log(`Manual missile launched at ${closest.kind} (${Math.round(dmin)}m)`);
  } else log('No valid target in range');
});

// --- Auto PVO logic: batteries will pick highest priority target in range ---
function autoshoot(nowSec){
  if (!autoPVO) return;
  for (let b of entities.batteries){
    // find targets in range
    const candidates = entities.targets.filter(t => Util.haversine(t.latlng, b.latlng) <= b.range);
    if (candidates.length === 0) continue;
    if (!b.canFire(nowSec)) continue;
    // choose priority: cruise > plane > drone
    candidates.sort((a,bT)=>{
      const score = (t)=> t.kind==='cruise'?3:(t.kind==='plane'?2:1);
      return score(bT) - score(a);
    });
    const target = candidates[0];
    entities.missiles.push(new Missile(b.latlng, target.id, 800 + b.level*80, 30));
    b.fire(nowSec);
    log(`Battery auto-fired at ${target.kind}`);
  }
}

// --- Simulation tick ---
function getTargetById(id){
  return entities.targets.find(t=>t.id===id);
}

function tick(dt){
  // update targets
  for (let t of entities.targets){ t.step(dt); }
  // update missiles
  for (let m of entities.missiles){ m.step(dt, getTargetById); }
  // collisions: missile close to target -> explosion + damage
  for (let m of entities.missiles){
    const tgt = getTargetById(m.targetId);
    if (!tgt) continue;
    const dist = Util.haversine(m.latlng, tgt.latlng);
    if (dist < 250){ // hit threshold meters
      entities.explosions.push(new Explosion(tgt.latlng, 300));
      log(`★ Hit: ${tgt.kind}`);
      score += (tgt.kind==='drone'?5:(tgt.kind==='plane'?20:40));
      funds += (tgt.kind==='drone'?3:(tgt.kind==='plane'?12:25));
      scoreEl.innerText = 'Score: ' + score;
      fundsEl.innerText = 'Funds: ' + funds;
      // damage
      tgt.hp -= 1;
      if (tgt.hp <= 0){
        // remove target
        entities.targets = entities.targets.filter(x=>x.id !== tgt.id);
      }
      // remove missile
      m.ttl = -1;
    }
  }
  // clean dead missiles
  entities.missiles = entities.missiles.filter(m=>m.ttl > 0);
  // explode timed-out missiles into duds
  // explosions step & cleanup
  for (let e of entities.explosions) e.step(dt);
  entities.explosions = entities.explosions.filter(e=>e.alive());
  // simple boundary: remove targets far outside radius of interest (>120km)
  const center = [map.getCenter().lat, map.getCenter().lng];
  entities.targets = entities.targets.filter(t => Util.haversine(t.latlng, center) < 120000);
}

// --- Rendering ---
let sweep = 0;
function render(){
  ctx.clearRect(0,0,overlay.width,overlay.height);
  const centerLatLng = [map.getCenter().lat, map.getCenter().lng];
  const centerPx = latLngToOverlay(centerLatLng);

  // rings
  const rings = [5000, 20000, 50000];
  ctx.save(); ctx.globalAlpha = 0.25;
  for (let i=0;i<rings.length;i++){
    const latShift = centerLatLng[0] + (rings[i]/111320);
    const p = latLngToOverlay([latShift, centerLatLng[1]]);
    const rpx = Math.abs(p.y - centerPx.y);
    ctx.strokeStyle = ['rgba(0,255,0,0.3)','rgba(0,200,255,0.25)','rgba(0,120,255,0.2)'][i];
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(centerPx.x, centerPx.y, rpx, 0, Math.PI*2); ctx.stroke();
  }
  ctx.restore();

  // sweep
  sweep += 1.2; if (sweep >= 360) sweep -= 360;
  ctx.save();
  ctx.translate(centerPx.x, centerPx.y);
  ctx.beginPath();
  const a = (sweep - 8) * Math.PI/180, b = (sweep + 8) * Math.PI/180;
  const maxR = Math.max(overlay.width, overlay.height) * 1.5;
  ctx.moveTo(0,0); ctx.arc(0,0, maxR, -a, -b, true); ctx.closePath();
  ctx.fillStyle = 'rgba(0,255,0,0.04)'; ctx.fill();
  ctx.restore();

  // draw batteries
  for (let b of entities.batteries){
    const p = latLngToOverlay(b.latlng);
    ctx.fillStyle = 'rgba(0,255,120,0.9)'; ctx.beginPath(); ctx.rect(p.x-8,p.y-8,16,16); ctx.fill();
    ctx.strokeStyle = 'rgba(0,255,120,0.25)'; ctx.beginPath(); ctx.arc(p.x,p.y, (Util.haversine(b.latlng, centerLatLng)/1) * 0 + 40, 0, Math.PI*2); ctx.stroke();
  }

  // draw targets
  for (let t of entities.targets){
    const p = latLngToOverlay(t.latlng);
    // skip if offscreen
    if (p.x < -50 || p.x > overlay.width+50 || p.y < -50 || p.y > overlay.height+50) continue;
    if (t.kind === 'plane'){
      ctx.fillStyle = 'rgba(255,200,0,0.9)'; ctx.beginPath(); ctx.ellipse(p.x,p.y,12,6, t.heading*Math.PI/180, 0, Math.PI*2); ctx.fill();
    } else if (t.kind === 'drone'){
      ctx.fillStyle = 'rgba(255,50,150,0.95)'; ctx.beginPath(); ctx.arc(p.x,p.y,6,0,Math.PI*2); ctx.fill();
    } else if (t.kind === 'cruise'){
      ctx.fillStyle = 'rgba(255,90,90,0.95)'; ctx.beginPath(); ctx.moveTo(p.x,p.y-8); ctx.lineTo(p.x+5,p.y+8); ctx.lineTo(p.x-5,p.y+8); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(p.x+10,p.y-10,90,18);
    ctx.fillStyle = '#bfffbf'; ctx.font = '12px monospace';
    ctx.fillText(`${t.kind} | ${Math.round(t.speed)} m/s`, p.x+12, p.y+4);
  }

  // missiles
  for (let m of entities.missiles){
    const p = latLngToOverlay(m.latlng);
    ctx.fillStyle = 'rgba(255,255,120,0.95)'; ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill();
  }

  // explosions
  for (let e of entities.explosions){
    const p = latLngToOverlay(e.latlng);
    const r = 30 * (1 + e.t);
    ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2);
    ctx.fillStyle = `rgba(255,120,0,${Math.max(0,0.6 - 0.2*e.t)})`; ctx.fill();
  }

  // center crosshair
  ctx.strokeStyle = 'rgba(0,255,0,0.25)'; ctx.beginPath(); ctx.moveTo(centerPx.x-10, centerPx.y); ctx.lineTo(centerPx.x+10, centerPx.y); ctx.moveTo(centerPx.x, centerPx.y-10); ctx.lineTo(centerPx.x, centerPx.y+10); ctx.stroke();
}

// --- Game loop ---
let lastTime = performance.now();
let accumulator = 0;
let spawnHandle = null;

function loop(now){
  const dt = (now - lastTime)/1000; lastTime = now;
  if (running && !paused){
    // fixed-step simulation with dt limit
    const step = Math.min(dt, 0.05);
    tick(step);
    // autopilot
    autoshoot((Date.now()/1000));
    accumulator += step;
  }
  render();
  // update time
  if (running){
    const elapsed = Math.floor((Date.now() - startTS) / 1000);
    timeEl.innerText = 'Time: ' + elapsed + 's';
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- Controls ---
document.getElementById('startBtn').addEventListener('click', ()=>{
  if (running) return;
  running = true; paused = false; startTS = Date.now(); score = 0; funds = 300;
  scoreEl.innerText = 'Score: 0'; fundsEl.innerText = 'Funds: 300'; timeEl.innerText = 'Time: 0s';
  log('Simulation started');
  // periodic spawn
  spawnHandle = setInterval(()=>{ spawnRandomWave(); }, spawnInterval);
});

document.getElementById('pauseBtn').addEventListener('click', ()=>{
  paused = !paused;
  document.getElementById('pauseBtn').innerText = paused ? 'Resume' : 'Pause';
  log(paused ? 'Paused' : 'Resumed');
});

document.getElementById('resetBtn').addEventListener('click', ()=>{
  running = false; paused = false; clearInterval(spawnHandle); spawnHandle = null;
  entities.targets = []; entities.missiles = []; entities.explosions = []; entities.batteries = [];
  score = 0; funds = 300;
  scoreEl.innerText = 'Score: 0'; fundsEl.innerText = 'Funds: 300'; timeEl.innerText = 'Time: 0s';
  log('Reset');
});

// random wave spawner
function spawnRandomWave(){
  const center = map.getCenter();
  const r = Math.random();
  if (r < 0.4) spawn('drone');
  else if (r < 0.85) spawn('plane');
  else spawn('cruise');
  // occasionally spawn groups
  if (Math.random() < 0.12){
    const count = Math.floor(Util.rand(2,5));
    for (let i=0;i<count;i++) spawn('drone');
  }
}

// --- init demo battery ---
entities.batteries.push(new Battery([map.getCenter().lat, map.getCenter().lng]));
log('Ready. Click map to manually fire from center battery. Build more batteries to expand defense.');

// --- initial entities demo ---
entities.targets.push(new Target('plane', [50.6, 30.4], 180, 160));
entities.targets.push(new Target('drone', [50.52, 30.7], 90, 40));

// === МЕНЮ ===
window.addEventListener('DOMContentLoaded', () => {
  const menu = document.getElementById('menu');
  const menuMain = document.querySelector('.menu-content');
  const options = document.getElementById('options');
  const about = document.getElementById('about');

  const playBtn = document.getElementById('playBtn');
  const optionsBtn = document.getElementById('optionsBtn');
  const aboutBtn = document.getElementById('aboutBtn');
  const back1 = document.getElementById('backBtn1');
  const back2 = document.getElementById('backBtn2');

  playBtn.addEventListener('click', () => {
    console.log('Play clicked');
    menu.style.display = 'none';
    const startBtn = document.getElementById('startBtn');
    if (startBtn) startBtn.click();
    else console.warn('❗ Кнопка #startBtn не найдена!');
  });

  optionsBtn.addEventListener('click', () => {
    menuMain.classList.add('hidden');
    options.classList.remove('hidden');
  });

  aboutBtn.addEventListener('click', () => {
    menuMain.classList.add('hidden');
    about.classList.remove('hidden');
  });

  back1.addEventListener('click', () => {
    options.classList.add('hidden');
    menuMain.classList.remove('hidden');
  });

  back2.addEventListener('click', () => {
    about.classList.add('hidden');
    menuMain.classList.remove('hidden');
  });
});
