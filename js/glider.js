"use strict";
// Fyzika kluzáku: polára, energetická výměna rychlost<->výška, kroužení, vlek, přistání.
class Glider {
  constructor(world) {
    this.world = world;
    this.x = 60;
    this.h = world.elevAt(60) + 0.6;
    this.v = 0;                 // vzdušná rychlost [m/s]
    this.mode = "tow";          // tow | free | circle | done
    this.towT = 0;
    this.pitch = 0;             // -1 přitaženo ... +1 potlačeno
    this.climb = 0;             // skutečná vertikální rychlost
    this.vario = 0;             // TE vário (tlumené)
    this.avgClimb = 0;          // 20s průměrovač
    this.buffet = false;
    this.stallT = 0;            // probíhající přetažení
    this.circleX = 0;
    this.circlePhase = 0;
    this.nudge = 0;
    this.airmass = 0;
    this.result = null;         // {kind, text, ok}
    this.mc = 1.0;              // MacCready — auto podle posledního stoupáku
    this.lastClimbAvg = 0;
    this.climbSamples = [];
    // statistiky
    this.stats = { maxAlt: 0, bestClimb: 0, thermals: 0, releaseAlt: 0, hardBuffets: 0 };
    this._wasCirclingClimb = false;
    this.trail = [];
    this._trailT = 0;
  }

  polarSink(v) {
    const d = v - CFG.polarV0;
    return CFG.polarA * d * d + CFG.polarS0;
  }

  // doporučená přeskoková rychlost (MacCready + netto)
  speedToFly() {
    const wa = Math.min(this.airmass, 1.5);
    const num = CFG.polarS0 + this.mc - wa;
    const v2 = CFG.polarV0 * CFG.polarV0 + Math.max(num, 0.05) / CFG.polarA;
    return U.clamp(Math.sqrt(v2), CFG.polarV0, CFG.vNe);
  }

  agl() { return this.h - this.world.elevAt(this.x); }

  update(dt, input, tDay, dayH, events) {
    const W = this.world;
    if (this.mode === "done") return;

    this.airmass = W.airmass(this.x, this.h, tDay, dayH);
    let climb = 0;

    if (this.mode === "tow") {
      // --- aerovlek (skriptovaný) ---
      this.towT += dt;
      if (this.towT < CFG.towRollTime) {
        // rozjezd po zemi
        const f = this.towT / CFG.towRollTime;
        this.v = CFG.towSpeed * f * f;
        this.x += this.v * dt;
        this.h = W.elevAt(this.x) + 0.6;
        this.vario = 0;
      } else {
        this.v = CFG.towSpeed;
        this.x += this.v * dt;
        climb = CFG.towClimb + Math.max(this.airmass, -0.5) * 0.55;
        this.h += climb * dt;
        // vlečná neletí do kopce — drž bezpečnou výšku nad terénem
        this.h = Math.max(this.h, W.elevAt(this.x) + 12);
        const agl = this.agl();
        // TE vário ukazuje vzduch — v tom je ta hra: vypnout ve stoupáku
        this._setVario(this.airmass + CFG.towClimb, dt);
        if (input.action || agl >= CFG.towAutoRelease) {
          this.release(events, agl >= CFG.towAutoRelease);
        }
      }
      this.climb = climb;
      this._trailPush(dt);
      return;
    }

    if (this.mode === "circle") {
      // --- kroužení ---
      this.pitch = 0;
      this.buffet = false;
      this.circlePhase += dt * Math.PI * 2 / CFG.circlePeriod;
      this.circleX += input.nudge * CFG.circleNudge * dt;
      this.x = this.circleX;
      this.v += (CFG.circleSpeed - this.v) * Math.min(dt * 1.6, 1);
      this.airmass = W.airmass(this.x, this.h, tDay, dayH);
      climb = this.airmass - CFG.circleSink;
      this.h += climb * dt;
      this._setVario(climb, dt);
      this._sampleClimb(climb, dt);

      if (input.action) this.exitCircle(events);
      if (this.agl() <= 1) { this._touchdown(events, true); return; }
    } else {
      // --- klouzavý let ---
      this.pitch = input.pitch;
      let acc = input.pitch * CFG.pitchAccel;

      // přetažení
      if (this.stallT > 0) {
        this.stallT -= dt;
        acc = 2.6;                        // nos dolů, nabírá rychlost
        this.h -= (CFG.stallDrop / 1.4) * dt;
      } else {
        if (this.v >= CFG.vNe - 0.5 && acc > 0) acc = 0;
      }

      const vOld = this.v;
      this.v = U.clamp(this.v + acc * dt, CFG.vStall - 1.2, CFG.vNe + 4);
      const dvdt = (this.v - vOld) / dt;

      // energetická výměna + polára + vzduch
      climb = this.airmass - this.polarSink(this.v) - (this.v * dvdt) / CFG.G;
      if (this.stallT > 0) climb = Math.min(climb, -6);
      this.h += climb * dt;
      this.x += this.v * dt;

      // pád
      this.buffet = this.stallT <= 0 && this.v < CFG.vBuffet;
      if (this.stallT <= 0 && this.v < CFG.vStall && input.pitch < -0.15) {
        this.stallT = 1.6;
        events.push({ type: "stall" });
      }
      // překročení VNE
      if (this.v > CFG.vNe) {
        events.push({ type: "overspeed" });
        if (this.v > CFG.vNe * 1.05) { this._crash(events, "vne"); return; }
      }

      this._setVario(this.airmass - this.polarSink(this.v), dt);
      this._sampleClimb(climb, dt);

      if (input.action) this.enterCircle(events);
      if (this.agl() <= 0.5) { this._touchdown(events, false); return; }
    }

    this.climb = climb;
    this.stats.maxAlt = Math.max(this.stats.maxAlt, this.h);
    this._trailPush(dt);
  }

  release(events, auto) {
    if (this.mode !== "tow") return;
    this.mode = "free";
    this.v = CFG.towSpeed;
    this.stats.releaseAlt = Math.round(this.agl());
    events.push({ type: "release", auto });
  }

  enterCircle(events) {
    if (this.mode !== "free" || this.stallT > 0) return;
    if (this.v > U.ms(160)) { events.push({ type: "tooFastCircle" }); return; }
    this.mode = "circle";
    this.circleX = this.x;
    this.circlePhase = 0;
    this.climbSamples = [];
    this._circleStartH = this.h;
    events.push({ type: "circleStart" });
  }

  exitCircle(events) {
    if (this.mode !== "circle") return;
    this.mode = "free";
    this.v = CFG.circleSpeed;
    const gained = this.h - this._circleStartH;
    if (gained > 60) {
      this.stats.thermals++;
      // auto-MacCready podle posledního dosaženého stoupání
      if (this.avgClimb > 0.3) this.mc = U.clamp(this.avgClimb, 0.5, 4);
    }
    events.push({ type: "circleEnd", gained });
  }

  _setVario(val, dt) {
    this.vario += (val - this.vario) * Math.min(dt * 4.5, 1);
  }

  _sampleClimb(climb, dt) {
    this.climbSamples.push({ c: climb, dt });
    let tot = 0;
    for (const s of this.climbSamples) tot += s.dt;
    while (tot > 20 && this.climbSamples.length > 1) tot -= this.climbSamples.shift().dt;
    let sum = 0;
    for (const s of this.climbSamples) sum += s.c * s.dt;
    this.avgClimb = tot > 0.5 ? sum / tot : 0;
    this.stats.bestClimb = Math.max(this.stats.bestClimb, tot > 8 ? this.avgClimb : 0);
  }

  _trailPush(dt) {
    this._trailT += dt;
    if (this._trailT < 0.3) return;
    this._trailT = 0;
    this.trail.push({ x: this.displayX(), h: this.h });
    if (this.trail.length > 400) this.trail.shift();
  }

  // vizuální x včetně kruhu
  displayX() {
    if (this.mode === "circle") return this.circleX + Math.sin(this.circlePhase) * CFG.circleRadiusVis;
    return this.x;
  }
  facing() { // 1 = doprava, -1 = doleva (v kruhu)
    if (this.mode === "circle") return Math.cos(this.circlePhase) >= 0 ? 1 : -1;
    return 1;
  }

  _touchdown(events, circling) {
    const W = this.world;
    const seg = W.segAt(this.x);
    const type = seg ? seg.type : "field";
    const sink = -this.climb;
    let kind, ok = false;

    if (circling) {
      kind = "spiral";
    } else if (this.stallT > 0) {
      kind = "stallCrash";
    } else if (type === "forest") {
      kind = "forest";
    } else if (type === "village") {
      kind = "village";
    } else if (type === "lake") {
      kind = "lake";
    } else if (sink > CFG.landMaxSink) {
      kind = "hard";
    } else if (type === "airfield") {
      if (this.v <= CFG.landMaxVApt) { kind = "airfield"; ok = true; }
      else kind = "fast";
    } else { // field / meadow
      if (this.v <= CFG.landMaxVField) { kind = "outlanding"; ok = true; }
      else kind = "fast";
    }

    this.mode = "done";
    this.h = W.elevAt(this.x) + 0.4;
    this.result = { kind, ok, type };
    events.push({ type: "landed", kind, ok });
  }

  _crash(events, kind) {
    this.mode = "done";
    this.result = { kind, ok: false };
    events.push({ type: "landed", kind, ok: false });
  }
}
