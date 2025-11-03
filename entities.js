// entities.js
// Contains classes for Targets, Missile, Battery, Explosion and some utilities.
// Expose to global scope: Target, Missile, Battery, Explosion, Util

class Util {
  // Haversine distance in meters
  static haversine(aLatLnt, bLatLng){
    const R = 6371000;
    const toRad = (x)=>x*Math.PI/180;
    const dLat = toRad(bLatLng[0]-aLatLnt[0]);
    const dLon = toRad(bLatLng[1]-aLatLnt[1]);
    const lat1 = toRad(aLatLnt[0]), lat2 = toRad(bLatLng[0]);
    const aa = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 2*R*Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
  }
  // move a latlng by meters at heading degrees
  static moveLatLng(latlng, meters, heading){
    const ang = heading * Math.PI/180;
    const dx = meters * Math.cos(ang);
    const dy = meters * Math.sin(ang);
    // approx convert
    const dlon = dx / 111320;
    const dlat = (dy / 111320) / Math.cos(latlng[0]*Math.PI/180);
    return [latlng[0] + dlat, latlng[1] + dlon];
  }
  static clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
  static rand(a,b){ return a + Math.random()*(b-a); }
  static uuid(){ return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2); }
}

class BaseEntity {
  constructor(type, latlng){
    this.id = Util.uuid();
    this.type = type;
    this.latlng = [latlng[0], latlng[1]];
    this.created = Date.now();
  }
}

class Target extends BaseEntity {
  // types: plane, drone, cruise
  constructor(kind, latlng, heading, speed){
    super('target', latlng);
    this.kind = kind;
    this.heading = heading; // deg
    this.speed = speed; // m/s
    this.hp = (kind==='plane')?3:1;
    this.dead = false;
    this.tags = {};
  }
  step(dt){
    // small AI behavior
    if (this.kind === 'drone' && Math.random() < 0.02) this.heading += Util.rand(-60,60);
    if (this.kind === 'plane' && Math.random() < 0.004) this.heading += Util.rand(-20,20);
    // update position
    const meters = this.speed * dt;
    this.latlng = Util.moveLatLng(this.latlng, meters, this.heading);
  }
}

class Missile extends BaseEntity {
  // seeker missile targeted at a target id
  constructor(latlng, targetId, speed=600, ttl=30){
    super('missile', latlng);
    this.targetId = targetId;
    this.speed = speed;
    this.ttl = ttl;
    this.dead = false;
  }
  step(dt, getTarget){
    const target = getTarget(this.targetId);
    if (!target){ this.ttl = -1; return; }
    // compute heading toward target in latlng space
    const dx = (target.latlng[1] - this.latlng[1]);
    const dy = (target.latlng[0] - this.latlng[0]);
    const heading = Math.atan2(dx, dy); // note: lon,x then lat,y
    // move step
    const move = Math.min(this.speed * dt, Util.haversine(this.latlng, target.latlng));
    const moveX = move * Math.sin(heading);
    const moveY = move * Math.cos(heading);
    this.latlng[1] += moveX/111320;
    this.latlng[0] += (moveY/111320) * (1/Math.cos(this.latlng[0]*Math.PI/180));
    this.ttl -= dt;
    if (this.ttl <= 0) this.ttl = -1;
  }
}

class Explosion extends BaseEntity {
  constructor(latlng, radius=200){
    super('explosion', latlng);
    this.t = 0; this.duration = 2; this.radius = radius;
  }
  step(dt){ this.t += dt; }
  alive(){ return this.t < this.duration; }
}

class Battery extends BaseEntity {
  constructor(latlng){
    super('battery', latlng);
    this.range = 20000; // meters
    this.reload = 4; // seconds
    this.lastFire = -9999;
    this.level = 1;
    this.auto = true;
  }
  canFire(now){
    return (now - this.lastFire) >= this.reload;
  }
  fire(now){
    this.lastFire = now;
  }
  upgrade(){
    this.level++;
    this.range *= 1.25;
    this.reload = Math.max(1.2, this.reload * 0.85);
  }
}

window.Util = Util;
window.Target = Target;
window.Missile = Missile;
window.Explosion = Explosion;
window.Battery = Battery;
