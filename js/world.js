"use strict";
// Svět: terén (segmenty krajiny), termické stoupáky a klesáky, vzduchová hmota.
class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.rand = U.rng(this.seed);
    this.segs = [];        // {x0,x1,type,flat} — souvislé pokrytí od -400
    this.thermals = [];    // {x,r,s,cloud,period,phase,ground,id,street}
    this.sinkers = [];     // {x,r,s}
    this.genX = -400;      // kam až je vygenerováno
    this.nextThermalX = 900 + this.rand() * 600;
    this.nextSinkerX = 2600 + this.rand() * 2000;
    this.nextAirfieldX = 26000 + this.rand() * 9000;
    this.thermalId = 0;

    // startovní letiště
    this._pushSeg(-400, 750, "airfield");
    this.genX = 750;
    this.ensure(6000);
  }

  _rawElev(x) {
    return CFG.elev0
      + 85 * Math.sin(x / 3900 + 1.3)
      + 48 * Math.sin(x / 1370 + 4.1)
      + 22 * Math.sin(x / 490 + 0.7)
      + 30 * U.noise1(x / 800, this.seed + 7);
  }

  _pushSeg(x0, x1, type) {
    const seg = { x0, x1, type };
    if (type === "airfield") seg.flat = this._rawElev((x0 + x1) / 2);
    seg.var = this.rand(); // vizuální varianta
    this.segs.push(seg);
  }

  ensure(x) {
    while (this.genX < x + 4000) this._genMore();
  }

  _genMore() {
    const r = this.rand;
    let pos = this.genX;

    // vložit letiště?
    if (pos >= this.nextAirfieldX) {
      this._pushSeg(pos, pos + 650, "airfield");
      this.genX = pos + 650;
      this.nextAirfieldX = pos + 26000 + r() * 12000;
      return;
    }

    // běžná krajina
    const prev = this.segs[this.segs.length - 1].type;
    let type, w = r();
    if (w < 0.42) type = "field";
    else if (w < 0.68) type = "forest";
    else if (w < 0.80) type = "village";
    else if (w < 0.88) type = "lake";
    else type = "meadow";
    if ((type === "lake" || type === "village") && type === prev) type = "field";

    let len;
    switch (type) {
      case "field":   len = 450 + r() * 1100; break;
      case "meadow":  len = 350 + r() * 700;  break;
      case "forest":  len = 450 + r() * 1500; break;
      case "village": len = 300 + r() * 450;  break;
      case "lake":    len = 400 + r() * 700;  break;
    }
    this._pushSeg(pos, pos + len, type);
    this.genX = pos + len;

    // termika v novém úseku
    while (this.nextThermalX < this.genX) {
      this._spawnThermal(this.nextThermalX);
      this.nextThermalX += 1250 + r() * 2300;
    }
    while (this.nextSinkerX < this.genX) {
      this.sinkers.push({ x: this.nextSinkerX, r: 420 + r() * 550, s: -(1.0 + r() * 1.8) });
      this.nextSinkerX += 2800 + r() * 3600;
    }
  }

  // hledání jen v už vygenerovaných segmentech (bez ensure — jinak rekurze při generování)
  _segLocal(x) {
    const a = this.segs;
    let lo = 0, hi = a.length - 1;
    if (x >= a[hi].x1 || x < a[0].x0) return null;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid].x1 <= x) lo = mid + 1; else hi = mid;
    }
    return a[lo];
  }

  _spawnThermal(x, mul) {
    const r = this.rand;
    const seg = this._segLocal(x);
    if (seg && seg.type === "lake" && r() < 0.65) return; // nad vodou to nešlape
    let s = (3.0 + 4.0 * Math.pow(r(), 1.3)) * (mul || 1);
    if (seg && (seg.type === "village" || seg.type === "field")) s *= 1.1;
    if (seg && seg.type === "lake") s *= 0.5;
    s = Math.min(s, 7);
    const th = {
      id: this.thermalId++,
      x, r: 160 + r() * 240,
      s,
      cloud: r() < 0.82,
      // životní cyklus musí běžet v reálném tempu hráče (2–5 minut skutečného
      // času), i když denní hodiny běží 30× rychleji — jinak stoupák umře
      // dřív, než se v něm dá vytočit výška
      period: (130 + r() * 170) * CFG.daySpeed,
      phase: r(),
      ground: this._rawElev(x),
    };
    this.thermals.push(th);
    // občas "mraková ulice" — pár stoupáků za sebou
    if (!mul && r() < 0.13) {
      this._spawnThermal(x + 550 + r() * 350, 0.85);
      this._spawnThermal(x + 1150 + r() * 500, 0.75);
    }
  }

  segAt(x) {
    this.ensure(x);
    return this._segLocal(x) || this.segs[this.segs.length - 1];
  }

  elevAt(x) {
    const e = this._rawElev(x);
    const seg = this.segAt(x);
    if (seg && seg.type === "airfield") {
      // plynulé zarovnání plochy
      const edge = Math.min(x - seg.x0, seg.x1 - x);
      return U.lerp(e, seg.flat, U.smoothstep(edge / 120));
    }
    return e;
  }

  // 0..1 síla dne (denní chod termiky), h = denní hodina
  dayFactor(h) {
    return U.clamp(1.2 * Math.sin(Math.PI * (h - 11.4) / 8.0), 0, 1);
  }

  cloudbase(x, h) {
    const frac = U.clamp01((h - CFG.dayStartH) / (CFG.dayEndH - CFG.dayStartH));
    return CFG.cloudbase0 + CFG.cloudbaseRise * frac + 140 * Math.sin(x / 9300 + 2);
  }

  // životní cyklus stoupáku 0..1 (tDay = denní čas v sekundách)
  lifeFactor(th, tDay) {
    const u = ((tDay / th.period) + th.phase) % 1;
    if (u < 0.15) return U.smoothstep(u / 0.15);
    if (u < 0.70) return 1;
    if (u < 0.95) return 1 - U.smoothstep((u - 0.70) / 0.25);
    return 0;
  }

  // celková síla stoupáku v daném čase (bez výškového profilu)
  thermalStrength(th, tDay, dayH) {
    return th.s * this.lifeFactor(th, tDay) * this.dayFactor(dayH);
  }

  // vertikální rychlost vzduchu v bodě
  airmass(x, h, tDay, dayH) {
    // pozadí: mezi stoupáky vzduch většinou klesá
    let w = -0.45 + 0.4 * U.noise1(x / 1600 + tDay * 0.006, this.seed + 31);

    const cb = this.cloudbase(x, dayH);

    // stoupáky (jen okolí — pole je seřazené podle x)
    const ths = this.thermals;
    for (let i = 0; i < ths.length; i++) {
      const th = ths[i];
      // jádro pomalu putuje a fouká v poryvech — centrování je živá práce
      const wander = 45 * U.noise1(tDay * 0.018 + th.id * 3.7, this.seed + 57);
      const dx = x - th.x - wander;
      if (x - th.x < -2500) break; // pole je řazené podle x (ulice mohou být mírně přeházené)
      if (Math.abs(dx) > th.r * 3.2) continue;
      let sNow = this.thermalStrength(th, tDay, dayH);
      sNow *= 1 + 0.22 * U.noise1(tDay * 0.13, th.id * 29 + 5);
      if (sNow <= 0.02) continue;
      const top = cb - (th.cloud ? 0 : 230);
      const up = U.clamp01((h - th.ground - 20) / 200);          // rozběh nad zemí
      const down = 1 - U.clamp01((h - (top - 140)) / 240);       // zánik u základny
      if (up <= 0 || down <= 0) continue;
      const g = Math.exp(-(dx * dx) / (th.r * th.r));
      w += sNow * g * up * down;
      // kompenzující klesání kolem jádra
      const dxo = Math.abs(dx) - th.r * 1.9;
      if (dxo > 0 && dxo < th.r * 1.4) {
        w -= sNow * 0.18 * Math.exp(-(dxo * dxo) / (th.r * th.r * 0.5)) * up;
      }
    }

    // klesáky
    const sks = this.sinkers;
    for (let i = 0; i < sks.length; i++) {
      const sk = sks[i];
      const dx = x - sk.x;
      if (dx < -3000) break;
      if (Math.abs(dx) > sk.r * 2.5) continue;
      w += sk.s * Math.exp(-(dx * dx) / (sk.r * sk.r)) * U.clamp01((h - this._rawElev(sk.x)) / 250);
    }

    // nad základnou už nic nenese
    if (h > cb) w = Math.min(w, -0.3);
    return w;
  }

  // stoupáky pro vykreslení mraků v okně
  thermalsIn(x0, x1) {
    this.ensure(x1);
    return this.thermals.filter(t => t.x >= x0 && t.x <= x1);
  }

  segsIn(x0, x1) {
    this.ensure(x1);
    return this.segs.filter(s => s.x1 >= x0 && s.x0 <= x1);
  }

  isLandable(type) { return type === "airfield" || type === "field" || type === "meadow"; }
}
