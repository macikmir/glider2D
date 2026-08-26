"use strict";
// Vykreslování: obloha, mraky, terén, kluzák, HUD. Vše programaticky, bez assetů.
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.viewH = 700;        // výška záběru v metrech (plynule se mění)
    this.camBottom = 0;
    this.camLeft = 0;
    this.inited = false;
    this.padL = this.padR = this.padT = this.padB = 0;
    this.watchBox = null;   // {x,y,scale} — kam se vykreslily hodinky
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.readSafeArea();
  }

  // HUD kreslíme do canvasu, takže si insety musíme přečíst z pomocné sondy
  // v DOM — jinak by na iPhonu na šířku zalezl pod notch / home indicator.
  readSafeArea() {
    const probe = document.getElementById("safearea");
    if (!probe) return;
    const cs = getComputedStyle(probe);
    this.padT = parseFloat(cs.paddingTop) || 0;
    this.padR = parseFloat(cs.paddingRight) || 0;
    this.padB = parseFloat(cs.paddingBottom) || 0;
    this.padL = parseFloat(cs.paddingLeft) || 0;
  }

  // ---------- kamera ----------
  updateCamera(g, world, dt) {
    const agl = Math.max(g.h - world.elevAt(g.x), 0);
    const targetViewH = U.clamp(agl * CFG.camAglFactor + 260, CFG.camViewMin, CFG.camViewMax);
    const targetBottom = world.elevAt(g.x) - targetViewH * 0.08;
    if (!this.inited) { this.viewH = targetViewH; this.camBottom = targetBottom; this.inited = true; }
    const k = Math.min(dt * 1.6, 1);
    this.viewH += (targetViewH - this.viewH) * k;
    this.camBottom += (targetBottom - this.camBottom) * k;
    this.scale = this.H / this.viewH;
    const viewW = this.W / this.scale;
    this.camLeft = g.x - viewW * 0.30;
    this.viewW = viewW;
  }

  sx(x) { return (x - this.camLeft) * this.scale; }
  sy(h) { return this.H - (h - this.camBottom) * this.scale; }

  // ---------- hlavní kreslení ----------
  draw(S) {
    // S: {world, glider, tDay, dayH, msgs, towPlane, best, distance, muted, touchUI}
    this.updateCamera(S.glider, S.world, S.dt);

    this.drawSky(S);
    this.drawBackHills(S);
    this.drawClouds(S);
    this.drawTerrain(S);
    this.drawThermalDust(S);
    this.drawTrail(S);
    if (S.towPlane) this.drawTowPlane(S);
    this.drawGlider(S);
    this.drawHUD(S);
    this.drawWatch(S);
    this.drawMessages(S);
  }

  //! Simulátor hodinek vlevo nahoře, pod horním pruhem HUD. Měřítko se drží
  //! na 1:1, dokud se to vejde — je to 1bitový displej a půlpixely na něm
  //! vypadají jako chyba, která na zařízení není.
  drawWatch(S) {
    const w = S.watch;
    if (!w || !w.open) { this.watchBox = null; return; }

    const availH = this.H - this.padT - this.padB - 82;
    const availW = this.W - this.padL - 20;
    const scale = Math.max(0.5, Math.min(1, availH / w.DEV_H, availW / w.DEV_W));
    const x = this.padL + 10;
    const y = this.padT + 70;

    this.watchBox = { x, y, scale };
    w.blit(this.ctx, x, y, scale);
  }

  // ---------- obloha ----------
  drawSky(S) {
    const ctx = this.ctx;
    const eve = U.clamp01((S.dayH - 17.2) / 2.8);   // 0 den, 1 večer
    const top = this.mixColor([84, 154, 214], [42, 62, 118], eve);
    const mid = this.mixColor([132, 196, 238], [222, 132, 82], eve);
    const bot = this.mixColor([186, 226, 245], [252, 190, 116], eve);
    const grd = ctx.createLinearGradient(0, 0, 0, this.H);
    grd.addColorStop(0, top); grd.addColorStop(0.62, mid); grd.addColorStop(1, bot);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, this.W, this.H);

    // slunce putuje k obzoru
    const dayFrac = U.clamp01((S.dayH - CFG.dayStartH) / (CFG.dayEndH - CFG.dayStartH));
    const sunX = this.W * (0.72 - 0.45 * dayFrac);
    const sunY = this.H * (0.10 + 0.45 * dayFrac * dayFrac);
    const r = 26 + eve * 14;
    const sg = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, r * 3);
    sg.addColorStop(0, eve > 0.5 ? "rgba(255,190,90,0.95)" : "rgba(255,246,200,0.95)");
    sg.addColorStop(0.35, eve > 0.5 ? "rgba(255,150,60,0.5)" : "rgba(255,240,180,0.4)");
    sg.addColorStop(1, "rgba(255,240,180,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(sunX - r * 3, sunY - r * 3, r * 6, r * 6);
  }

  mixColor(a, b, t) {
    return `rgb(${Math.round(U.lerp(a[0], b[0], t))},${Math.round(U.lerp(a[1], b[1], t))},${Math.round(U.lerp(a[2], b[2], t))})`;
  }

  // ---------- vzdálené kopce (paralaxa) ----------
  drawBackHills(S) {
    const ctx = this.ctx;
    const eve = U.clamp01((S.dayH - 17.2) / 2.8);
    const layers = [
      { par: 0.18, amp: 260, base: 900, col: this.mixColor([150, 185, 215], [90, 90, 140], eve), seed: 91 },
      { par: 0.42, amp: 180, base: 620, col: this.mixColor([120, 165, 175], [110, 95, 120], eve), seed: 55 },
    ];
    for (const L of layers) {
      ctx.beginPath();
      ctx.moveTo(0, this.H);
      const step = Math.max(this.W / 90, 6);
      for (let px = 0; px <= this.W + step; px += step) {
        const wx = this.camLeft * L.par + px / this.scale;
        const hh = CFG.elev0 + L.base
          + L.amp * (0.6 * Math.sin(wx / 2600 + L.seed) + 0.4 * U.noise1(wx / 1400, L.seed));
        ctx.lineTo(px, this.sy(hh * 0.55 + this.camBottom * 0.45));
      }
      ctx.lineTo(this.W, this.H);
      ctx.closePath();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = L.col;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ---------- kumuly ----------
  drawClouds(S) {
    const ctx = this.ctx, world = S.world;
    const x0 = this.camLeft - 800, x1 = this.camLeft + this.viewW + 800;
    const ths = world.thermalsIn(x0, x1);
    const eve = U.clamp01((S.dayH - 17.2) / 2.8);

    for (const th of ths) {
      if (!th.cloud) continue;
      const life = world.lifeFactor(th, S.tDay) * world.dayFactor(S.dayH);
      if (life < 0.04) continue;
      // rozpadá se? (derivace životního cyklu)
      const dying = world.lifeFactor(th, S.tDay + 25) < world.lifeFactor(th, S.tDay) - 0.01;
      const cb = world.cloudbase(th.x, S.dayH);
      const size = th.r * (0.55 + life * 0.9) * (th.s / 3 + 0.55);
      const cx = this.sx(th.x), cy = this.sy(cb);
      if (cx < -400 || cx > this.W + 400) continue;

      const sPx = size * this.scale;
      const puffN = 6;
      ctx.save();
      const grey = dying ? 0.35 : 0.12;
      const bright = 255 - Math.round(70 * eve) - Math.round(45 * grey);
      // základna
      ctx.fillStyle = `rgba(${bright - 55},${bright - 45},${bright - 30},${0.55 * Math.min(life * 2, 1)})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, sPx * 1.15, Math.max(sPx * 0.16, 2), 0, 0, Math.PI * 2);
      ctx.fill();
      // kopule
      ctx.fillStyle = `rgba(${bright},${bright},${bright},${0.88 * Math.min(life * 2, 1)})`;
      for (let i = 0; i < puffN; i++) {
        const hh = U.hash1(th.id * 57 + i * 13);
        const hx = (U.hash1(th.id * 91 + i * 7) - 0.5) * 2;
        const px = cx + hx * sPx * 0.95;
        const pr = sPx * (0.34 + hh * 0.3) * (1 - Math.abs(hx) * 0.35) * (dying ? 0.6 : 1);
        const py = cy - pr * (dying ? 0.35 : 0.72);
        if (pr < 1.5) continue;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ptáci ve silných stoupácích
      const sNow = world.thermalStrength(th, S.tDay, S.dayH);
      if (sNow > 2.4) {
        const bh = th.ground + (cb - th.ground) * 0.55;
        for (let i = 0; i < 3; i++) {
          const a = S.tDay * 0.10 + i * 2.1 + th.id;
          const bx = this.sx(th.x + Math.sin(a) * th.r * 0.5);
          const by = this.sy(bh + Math.cos(a * 0.7) * 40 + i * 30);
          if (by < 0 || by > this.H) continue;
          ctx.strokeStyle = "rgba(30,30,40,0.7)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(bx - 4, by); ctx.quadraticCurveTo(bx - 1, by - 3, bx, by);
          ctx.quadraticCurveTo(bx + 1, by - 3, bx + 4, by);
          ctx.stroke();
        }
      }
    }

    // dekorativní pozadí — cirry
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    for (let i = 0; i < 5; i++) {
      const wx = this.camLeft * 0.3 + i * 900 + U.hash1(i * 77) * 700;
      const px = ((wx % (this.W + 600)) + this.W + 600) % (this.W + 600) - 300;
      const py = this.H * (0.06 + 0.05 * U.hash1(i * 13));
      ctx.beginPath();
      ctx.ellipse(px, py, 90 + 60 * U.hash1(i * 31), 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- terén ----------
  drawTerrain(S) {
    const ctx = this.ctx, world = S.world;
    const x0 = this.camLeft - 50, x1 = this.camLeft + this.viewW + 50;
    const eve = U.clamp01((S.dayH - 17.2) / 2.8);

    // silueta terénu
    const step = Math.max(2 / this.scale, 8);
    ctx.beginPath();
    ctx.moveTo(-10, this.H + 10);
    for (let x = x0; x <= x1 + step; x += step) {
      ctx.lineTo(this.sx(x), this.sy(world.elevAt(x)));
    }
    ctx.lineTo(this.W + 10, this.H + 10);
    ctx.closePath();
    const gTop = this.mixColor([116, 168, 74], [86, 108, 62], eve);
    const gBot = this.mixColor([66, 110, 48], [42, 62, 40], eve);
    const grd = ctx.createLinearGradient(0, this.sy(this.camBottom + this.viewH * 0.5), 0, this.H);
    grd.addColorStop(0, gTop); grd.addColorStop(1, gBot);
    ctx.fillStyle = grd;
    ctx.fill();

    // krajinné segmenty
    const segs = world.segsIn(x0, x1);
    for (const seg of segs) this.drawSeg(S, seg, eve);

    // obrys povrchu
    ctx.strokeStyle = "rgba(40,70,30,0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = x0; x <= x1 + step; x += step) {
      const px = this.sx(x), py = this.sy(world.elevAt(x));
      if (x === x0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  drawSeg(S, seg, eve) {
    const ctx = this.ctx, world = S.world;
    const a = Math.max(seg.x0, this.camLeft - 60);
    const b = Math.min(seg.x1, this.camLeft + this.viewW + 60);
    if (b <= a) return;
    const detail = this.scale > 0.16; // blízký zoom => detaily

    const band = (color, thick) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(thick * this.scale, 3);
      ctx.beginPath();
      const st = Math.max(4 / this.scale, 12);
      for (let x = a; x <= b + st; x += st) {
        const xx = Math.min(x, b);
        const px = this.sx(xx), py = this.sy(world.elevAt(xx)) + ctx.lineWidth * 0.4;
        if (x === a) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };

    switch (seg.type) {
      case "field": {
        band(seg.var < 0.5 ? this.mixColor([212, 186, 92], [160, 130, 70], eve)
                           : this.mixColor([150, 190, 88], [104, 128, 66], eve), 14);
        break;
      }
      case "meadow": {
        band(this.mixColor([148, 205, 110], [100, 140, 80], eve), 12);
        break;
      }
      case "forest": {
        if (detail) {
          ctx.fillStyle = this.mixColor([38, 92, 44], [26, 56, 34], eve);
          const sp = 16;
          for (let x = Math.ceil(a / sp) * sp; x < b; x += sp) {
            const hgt = 11 + U.hash1(Math.round(x)) * 7;
            const px = this.sx(x), py = this.sy(world.elevAt(x));
            const hp = hgt * this.scale, wp = hp * 0.55;
            ctx.beginPath();
            ctx.moveTo(px, py - hp);
            ctx.lineTo(px - wp, py);
            ctx.lineTo(px + wp, py);
            ctx.closePath();
            ctx.fill();
          }
        } else {
          band(this.mixColor([34, 84, 40], [24, 52, 32], eve), 22);
        }
        break;
      }
      case "village": {
        band(this.mixColor([172, 162, 140], [110, 100, 92], eve), 8);
        const sp = 34;
        for (let x = Math.ceil((a + 10) / sp) * sp; x < b - 10; x += sp) {
          const px = this.sx(x), py = this.sy(world.elevAt(x));
          const s = Math.max(this.scale * 9, 2.5);
          ctx.fillStyle = this.mixColor([235, 230, 220], [160, 150, 145], eve);
          ctx.fillRect(px - s * 0.7, py - s, s * 1.4, s);
          ctx.fillStyle = this.mixColor([182, 68, 44], [110, 45, 35], eve);
          ctx.beginPath();
          ctx.moveTo(px - s * 0.9, py - s);
          ctx.lineTo(px, py - s * 1.8);
          ctx.lineTo(px + s * 0.9, py - s);
          ctx.closePath();
          ctx.fill();
        }
        // kostel uprostřed
        if (seg.var < 0.5) {
          const cx = (seg.x0 + seg.x1) / 2;
          if (cx > a && cx < b) {
            const px = this.sx(cx), py = this.sy(world.elevAt(cx));
            const s = Math.max(this.scale * 9, 2.5);
            ctx.fillStyle = this.mixColor([240, 236, 226], [165, 155, 150], eve);
            ctx.fillRect(px - s * 0.4, py - s * 3.1, s * 0.8, s * 3.1);
            ctx.fillStyle = this.mixColor([60, 60, 70], [40, 40, 50], eve);
            ctx.beginPath();
            ctx.moveTo(px - s * 0.55, py - s * 3.1);
            ctx.lineTo(px, py - s * 4.2);
            ctx.lineTo(px + s * 0.55, py - s * 3.1);
            ctx.closePath(); ctx.fill();
          }
        }
        break;
      }
      case "lake": {
        ctx.fillStyle = this.mixColor([70, 140, 200], [60, 85, 140], eve);
        ctx.beginPath();
        const st = Math.max(6 / this.scale, 14);
        ctx.moveTo(this.sx(a), this.sy(world.elevAt(a)));
        for (let x = a; x <= b + st; x += st) {
          const xx = Math.min(x, b);
          ctx.lineTo(this.sx(xx), this.sy(world.elevAt(xx)) + 1);
        }
        for (let x = b; x >= a - st; x -= st) {
          const xx = Math.max(x, a);
          ctx.lineTo(this.sx(xx), this.sy(world.elevAt(xx)) + Math.max(10 * this.scale, 5));
        }
        ctx.closePath();
        ctx.fill();
        // odlesk
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(this.sx(a + (b - a) * 0.2), this.sy(world.elevAt((a + b) / 2)) + 3);
        ctx.lineTo(this.sx(a + (b - a) * 0.6), this.sy(world.elevAt((a + b) / 2)) + 3);
        ctx.stroke();
        break;
      }
      case "airfield": {
        band(this.mixColor([200, 210, 170], [140, 142, 120], eve), 10);
        // značení dráhy
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = Math.max(this.scale * 1.6, 1.5);
        ctx.setLineDash([Math.max(this.scale * 14, 6), Math.max(this.scale * 10, 5)]);
        ctx.beginPath();
        const st = Math.max(6 / this.scale, 14);
        for (let x = a + 30; x <= b - 30; x += st) {
          const px = this.sx(x), py = this.sy(world.elevAt(x)) - 1;
          if (x === a + 30) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // hangár + rukáv
        const hx = seg.x0 + 90;
        if (hx > a && hx < b) {
          const px = this.sx(hx), py = this.sy(world.elevAt(hx));
          const s = Math.max(this.scale * 12, 4);
          ctx.fillStyle = this.mixColor([200, 90, 60], [130, 65, 50], eve);
          ctx.beginPath();
          ctx.moveTo(px - s, py);
          ctx.lineTo(px - s, py - s * 0.7);
          ctx.quadraticCurveTo(px, py - s * 1.5, px + s, py - s * 0.7);
          ctx.lineTo(px + s, py);
          ctx.closePath(); ctx.fill();
        }
        const wx = seg.x1 - 80;
        if (wx > a && wx < b) {
          const px = this.sx(wx), py = this.sy(world.elevAt(wx));
          const s = Math.max(this.scale * 8, 4);
          ctx.strokeStyle = "#ddd"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - s * 1.6); ctx.stroke();
          ctx.fillStyle = "#e8542a";
          ctx.beginPath();
          ctx.moveTo(px, py - s * 1.6);
          ctx.lineTo(px + s * 0.9, py - s * 1.45);
          ctx.lineTo(px, py - s * 1.3);
          ctx.closePath(); ctx.fill();
        }
        break;
      }
    }
  }

  // ---------- náznak proudění (jemný) ----------
  drawThermalDust(S) {
    const ctx = this.ctx, world = S.world;
    const ths = world.thermalsIn(this.camLeft, this.camLeft + this.viewW);
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth = 1.5;
    for (const th of ths) {
      const sNow = world.thermalStrength(th, S.tDay, S.dayH);
      if (sNow < 1.1) continue;
      const cb = world.cloudbase(th.x, S.dayH);
      for (let i = 0; i < 7; i++) {
        const h1 = U.hash1(th.id * 131 + i * 17);
        const frac = ((S.tDay * (0.010 + 0.006 * h1) + h1) % 1);
        const hh = th.ground + 60 + frac * (cb - th.ground - 120);
        const px = this.sx(th.x + (U.hash1(th.id * 7 + i * 29) - 0.5) * th.r * 1.1);
        const py = this.sy(hh);
        if (py < -20 || py > this.H + 20) continue;
        ctx.beginPath();
        ctx.moveTo(px, py + 5);
        ctx.lineTo(px, py - 5);
        ctx.stroke();
      }
    }
  }

  // ---------- stopa letu ----------
  drawTrail(S) {
    const tr = S.glider.trail;
    if (tr.length < 2) return;
    const ctx = this.ctx;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < tr.length; i++) {
      const px = this.sx(tr[i].x), py = this.sy(tr[i].h);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.stroke();
  }

  // ---------- vlečná ----------
  drawTowPlane(S) {
    const tp = S.towPlane, ctx = this.ctx, g = S.glider;
    const px = this.sx(tp.x), py = this.sy(tp.h);
    const size = Math.max(11 * this.scale, 22);

    if (tp.roped) {
      ctx.strokeStyle = "rgba(240,240,240,0.8)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(this.sx(g.displayX()) + size * 0.4, this.sy(g.h));
      ctx.lineTo(px - size * 0.55, py + size * 0.05);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-tp.pitchVis || 0);
    // trup
    ctx.fillStyle = "#d8b23a";
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.55, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    // křídlo
    ctx.strokeStyle = "#b3901f"; ctx.lineWidth = Math.max(size * 0.08, 2);
    ctx.beginPath(); ctx.moveTo(-size * 0.05, 0); ctx.lineTo(-size * 0.28, -size * 0.28); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-size * 0.05, 0); ctx.lineTo(-size * 0.22, size * 0.16); ctx.stroke();
    // ocas
    ctx.beginPath(); ctx.moveTo(-size * 0.5, 0); ctx.lineTo(-size * 0.62, -size * 0.22); ctx.stroke();
    // vrtule
    ctx.strokeStyle = "rgba(120,120,120,0.8)";
    ctx.beginPath(); ctx.moveTo(size * 0.58, -size * 0.2); ctx.lineTo(size * 0.58, size * 0.2); ctx.stroke();
    ctx.restore();
  }

  // ---------- kluzák ----------
  drawGlider(S) {
    const g = S.glider, ctx = this.ctx;
    const px = this.sx(g.displayX()), py = this.sy(g.h);
    const size = Math.max(15 * this.scale, 30);   // délka trupu v px
    const face = g.facing();

    let ang = 0;
    if (g.mode !== "done") {
      const glideAng = Math.atan2(-(g.climb || 0), Math.max(g.v, 8));
      ang = U.clamp(glideAng * 1.2, -0.5, 0.6) + (g.pitch || 0) * 0.10;
      if (g.stallT > 0) ang = 0.7;
    }

    ctx.save();
    ctx.translate(px, py);
    ctx.scale(face, 1);
    ctx.rotate(ang);

    // trup
    ctx.fillStyle = "#f4f6f8";
    ctx.strokeStyle = "#9aa4ad";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.5, size * 0.065, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // kabina
    ctx.fillStyle = "#3f6f9f";
    ctx.beginPath();
    ctx.ellipse(size * 0.18, -size * 0.035, size * 0.11, size * 0.05, -0.15, 0, Math.PI * 2);
    ctx.fill();
    // křídlo (štíhlé, mírně vzepětí)
    ctx.strokeStyle = "#e8ebee";
    ctx.lineWidth = Math.max(size * 0.045, 2);
    ctx.beginPath();
    ctx.moveTo(size * 0.02, -size * 0.02);
    ctx.lineTo(-size * 0.42, -size * 0.16);
    ctx.stroke();
    ctx.strokeStyle = "#c9ced4";
    ctx.beginPath();
    ctx.moveTo(size * 0.02, 0);
    ctx.lineTo(-size * 0.30, size * 0.10);
    ctx.stroke();
    // T-ocas
    ctx.strokeStyle = "#e8ebee";
    ctx.lineWidth = Math.max(size * 0.04, 1.6);
    ctx.beginPath();
    ctx.moveTo(-size * 0.46, 0);
    ctx.lineTo(-size * 0.5, -size * 0.14);
    ctx.lineTo(-size * 0.58, -size * 0.16);
    ctx.stroke();
    ctx.restore();

    // třepání při přetažení
    if (g.buffet && g.mode !== "done") {
      ctx.strokeStyle = "rgba(255,80,60,0.6)";
      ctx.lineWidth = 2;
      const sh = Math.sin(performance.now() / 28) * 3;
      ctx.beginPath();
      ctx.arc(px + sh, py, size * 0.75, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---------- HUD ----------
  chip(x, y, w, h, r) {
    const ctx = this.ctx;
    r = r || 9;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);   // chybí do iOS Safari 16
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = "rgba(8,28,48,0.55)";
    ctx.fill();
  }

  drawHUD(S) {
    const ctx = this.ctx, g = S.glider;
    const L = this.padL, R = this.W - this.padR;       // bezpečné okraje
    const T = this.padT, B = this.H - this.padB;
    const midX = (L + R) / 2;
    const warnY = T + (B - T) * 0.30;
    ctx.textBaseline = "middle";

    // --- čas + síla dne (vlevo nahoře) ---
    this.chip(L + 12, T + 12, 128, 40);
    ctx.fillStyle = "#fff";
    ctx.font = "700 19px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(U.fmtTime(S.dayH), L + 24, T + 32);
    const dayF = S.world.dayFactor(S.dayH);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = dayF > (i + 0.5) / 4 ? "#ffd24a" : "rgba(255,255,255,0.22)";
      ctx.beginPath();
      ctx.arc(L + 96 + i * 11, T + 32, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- vzdálenost (střed nahoře) ---
    this.chip(midX - 86, T + 12, 172, 46);
    ctx.fillStyle = "#ffd24a";
    ctx.font = "800 26px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(S.distance.toFixed(1) + " km", midX, T + 33);
    if (S.best > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "600 11px system-ui";
      ctx.fillText("rekord " + S.best.toFixed(1) + " km", midX, T + 50);
    }

    // --- výška (vpravo nahoře) ---
    const agl = Math.round(g.agl());
    this.chip(R - 152, T + 12, 140, 52);
    ctx.textAlign = "right";
    ctx.fillStyle = agl < CFG.lowAltWarn && g.mode !== "tow" ? "#ff9060" : "#fff";
    ctx.font = "800 24px system-ui";
    ctx.fillText(agl + " m", R - 26, T + 32);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "600 11px system-ui";
    ctx.fillText(Math.round(g.h) + " m MSL", R - 26, T + 52);

    // --- rychlost (dole uprostřed) ---
    const spd = Math.round(U.kmh(g.v));
    this.chip(midX - 74, B - 78, 148, 62);
    ctx.textAlign = "center";
    ctx.fillStyle = g.v > CFG.vNe - 3 ? "#ff5544" : (g.buffet ? "#ffb020" : "#fff");
    ctx.font = "800 34px system-ui";
    ctx.fillText(String(spd), midX, B - 50);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "600 11px system-ui";
    ctx.fillText("km/h", midX, B - 26);

    // MacCready doporučení
    if (g.mode === "free" && g.agl() > 280) {
      const stf = g.speedToFly();
      const diff = stf - g.v;
      if (Math.abs(diff) > 2.2) {
        ctx.font = "800 13px system-ui";
        if (diff > 0) {
          ctx.fillStyle = "#7fd0ff";
          ctx.fillText("ZRYCHLI ▲ " + Math.round(U.kmh(stf)), midX, B - 92);
        } else {
          ctx.fillStyle = "#a5f0a5";
          ctx.fillText("ZPOMAL ▼ " + Math.round(U.kmh(stf)), midX, B - 92);
        }
      }
    }

    // --- vário (svisle vpravo) ---
    this.drawVario(S);

    // --- varování ---
    ctx.textAlign = "center";
    if (g.buffet) {
      ctx.fillStyle = "rgba(255,60,40," + (0.6 + 0.4 * Math.sin(performance.now() / 90)) + ")";
      ctx.font = "800 22px system-ui";
      ctx.fillText("PŘETAŽENÍ!", midX, warnY);
    } else if (g.v > CFG.vNe - 2 && g.mode === "free") {
      ctx.fillStyle = "rgba(255,60,40," + (0.6 + 0.4 * Math.sin(performance.now() / 90)) + ")";
      ctx.font = "800 22px system-ui";
      ctx.fillText("VNE!", midX, warnY);
    } else if (g.mode !== "tow" && g.mode !== "done" && agl < CFG.lowAltWarn) {
      const seg = S.world.segAt(g.x);
      const landable = S.world.isLandable(seg.type);
      ctx.fillStyle = landable ? "rgba(255,210,80,0.85)" : "rgba(255,90,50,0.9)";
      ctx.font = "800 16px system-ui";
      ctx.fillText(landable ? "NÍZKO — pod tebou se dá přistát" : "NÍZKO — najdi pole!", midX, warnY);
    }

    // --- nápověda při vleku ---
    if (g.mode === "tow" && g.towT > CFG.towRollTime + 2) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "700 15px system-ui";
      ctx.fillText("MEZERNÍK / ⟳ — vypnout (ideálně ve stoupáku!)", midX, T + (B - T) * 0.22);
    }

    // ztlumeno
    if (S.muted) {
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "700 13px system-ui";
      ctx.fillText("🔇", L + 20, B - 20);
    }
  }

  drawVario(S) {
    const ctx = this.ctx, g = S.glider;
    // svislý pruh mezi horními chipy a dotykovým tlačítkem ⟳ — na telefonu
    // na šířku by se jinak spodek stupnice (⌀ a MC) schoval pod tlačítko
    const bandTop = this.padT + 66;
    const bandBot = this.H - this.padB - (S.touchUI ? 104 : 12);
    const gh = Math.max(70, Math.min(this.H * 0.36, 260, bandBot - bandTop - 88));
    const gx = this.W - this.padR - 46;
    const gy = (bandTop + bandBot) / 2 - 10;   // chip sahá 10 px pod střed
    this.chip(gx - 26, gy - gh / 2 - 34, 66, gh + 88, 12);

    // stupnice ±5
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.textAlign = "left";
    ctx.font = "600 9px system-ui";
    for (let m = -5; m <= 5; m++) {
      const y = gy - (m / 5) * gh / 2;
      ctx.beginPath();
      ctx.moveTo(gx - 12, y); ctx.lineTo(gx - (m % 5 === 0 || m === 0 ? 2 : 6), y);
      ctx.stroke();
      if (m % 5 === 0 && m !== 0) {
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillText(String(Math.abs(m)), gx + 2, y);
      }
    }
    // nulová linka
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath(); ctx.moveTo(gx - 14, gy); ctx.lineTo(gx + 10, gy); ctx.stroke();

    // sloupec
    const val = U.clamp(g.vario, -5, 5);
    const vh = (val / 5) * gh / 2;
    ctx.fillStyle = val >= 0 ? "rgba(90,230,110,0.9)" : "rgba(255,110,70,0.9)";
    ctx.fillRect(gx - 11, Math.min(gy, gy - vh), 9, Math.abs(vh) || 1);

    // digitální hodnoty
    ctx.textAlign = "center";
    ctx.fillStyle = val >= 0 ? "#7cf09a" : "#ffa080";
    ctx.font = "800 16px system-ui";
    ctx.fillText((val >= 0 ? "+" : "") + val.toFixed(1), gx - 4, gy - gh / 2 - 16);
    // průměrovač
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "600 11px system-ui";
    ctx.fillText("⌀ " + g.avgClimb.toFixed(1), gx - 4, gy + gh / 2 + 16);
    ctx.fillStyle = "rgba(255,210,80,0.9)";
    ctx.fillText("MC " + g.mc.toFixed(1), gx - 4, gy + gh / 2 + 34);
  }

  // ---------- zprávy ----------
  drawMessages(S) {
    const ctx = this.ctx;
    const now = performance.now() / 1000;
    const midX = (this.padL + this.W - this.padR) / 2;
    let y = this.padT + (this.H - this.padT - this.padB) * 0.38;
    ctx.textAlign = "center";
    for (const m of S.msgs) {
      const left = m.until - now;
      if (left <= 0) continue;
      const alpha = Math.min(left / 0.5, 1) * Math.min((now - m.t0) / 0.15, 1);
      ctx.globalAlpha = alpha;
      ctx.font = (m.big ? "800 24px" : "700 17px") + " system-ui";
      const w = ctx.measureText(m.text).width + 36;
      this.chip(midX - w / 2, y - 16, w, 34, 17);
      ctx.fillStyle = m.color || "#fff";
      ctx.fillText(m.text, midX, y + 1);
      ctx.globalAlpha = 1;
      y += 42;
    }
  }
}
