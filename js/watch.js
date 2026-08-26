"use strict";
// Simulátor hodinek Garmin Instinct 2 s aplikací GlideMate uvnitř TERMIKY.
//
// Proč to jde: hra zná výšku, rychlost, kurz i letiště s elevacemi, takže se
// dá appce podstrčit úplně všechno, co na zápěstí bere z čidel. A protože se
// v termice krouží, dostane zabrat i šipka, která se vztahuje ke kurzu.
//
// Čemu simulátor věřit lze a čemu ne:
//   ANO  rozvržení (konstanty jsou převzaté), matematika, chování tlačítek,
//        formátování a šířky sloupců, chování při zaokrouhlování
//   NE   přesné tvary písmen (fonty Instinctu nemáme — dopočítává se šířka
//        referenčních řetězců, viz gm_ui.js) a vzhled systémového Menu2
//
// Zeměpis: herní osa x je trať 070° z LKRK. Letiště leží na ní, takže hodinky
// souhlasí s tím, na co se v té hře dá doopravdy sednout. Šipka proto v přímém
// letu ukazuje nahoru/dolů — to je správně — a roztočí se, jakmile kroužíš.

const GM_ORIGIN_LAT_DEG = 50.0942;   // LKRK
const GM_ORIGIN_LON_DEG = 13.6889;
const GM_COURSE_DEG = 70;

// Dohled dopředu pro databázi. Herní letiště jsou 26–38 km od sebe, takže na
// čtyři řádky je potřeba vidět hodně daleko. Generování je seedované a čistě
// sekvenční, takže vynucení dopředu svět nijak nemění — jen ho udělá dřív.
const GM_LOOKAHEAD_M = 115000;

const WATCH_SCREEN = 176;

class WatchDevice {
  constructor() {
    this.screen = document.createElement("canvas");
    this.screen.width = WATCH_SCREEN;
    this.screen.height = WATCH_SCREEN;
    this.sctx = this.screen.getContext("2d", { willReadFrequently: true });
    this.dc = new GmDc(this.sctx, WATCH_SCREEN, WATCH_SCREEN);
    this.dc.calibrate();

    // Co vrací WatchUi.getSubscreen() na Instinctu 2.
    this.sub = { x: 113, y: 0, w: 62, h: 62 };

    this.ui = new GmUi();
    this.baro = new GmBaroModel();
    this.pos = new GmPositionModel();

    this.open = false;
    this.simGpsLost = false;      // jen simulátor: zkouška stavu „stará poloha"
    this._lostFor = 0;
    this._tickT = 0;
    this._rows = [];
    this._namedTo = 0;
    this._holdId = null;
    this._holdT = 0;
    this._holdFired = false;

    // Pouzdro v „přístrojových" pixelech; blit si to teprve zvětší.
    this.BX = 18; this.BY = 14;
    this.DEV_W = WATCH_SCREEN + 2 * this.BX;
    this.DEV_H = WATCH_SCREEN + 2 * this.BY;
    // Instinct 2: vlevo CTRL/UP/DOWN, vpravo GPS/SET.
    this.buttons = [
      { id: "SIM",  x: -4,  y: 34,  w: 24, h: 30, label: "SIM" },
      { id: "UP",   x: -4,  y: 82,  w: 24, h: 30, label: "UP" },
      { id: "DOWN", x: -4,  y: 126, w: 24, h: 30, label: "DN" },
      { id: "GPS",  x: this.DEV_W - 20, y: 56,  w: 24, h: 34, label: "GPS" },
      { id: "SET",  x: this.DEV_W - 20, y: 120, w: 24, h: 34, label: "SET" },
    ];
  }

  // ---------------------------------------------------------------- start ---
  start() {
    this.baro.loadSettings();
    this.ui.stack = [];
    const view = new GmAltView(this.baro, this.pos, this);
    this.ui.pushView(view, new GmAltDelegate(this.baro, this.pos, view, this));
  }

  // ------------------------------------------------------------- geografie ---
  //! Bod na trati ve vzdálenosti x od počátku [rad].
  //!
  //! Přesný sférický vzorec, ne plochá zem: s aproximací se po 50 km sever
  //! rozejde měřítko o čtvrt procenta, protože cos(lat) počátku už neplatí.
  //! Takhle vyjde haversine(počátek, posRad(x)) přesně x, a vzdálenosti na
  //! hodinkách tedy souhlasí s herními kilometry.
  posRad(x) {
    const dR = x / GmGeo.EARTH_R_M;
    const brg = GM_COURSE_DEG * Math.PI / 180;
    const lat0 = GM_ORIGIN_LAT_DEG * Math.PI / 180;
    const lon0 = GM_ORIGIN_LON_DEG * Math.PI / 180;
    const lat = Math.asin(Math.sin(lat0) * Math.cos(dR) +
                          Math.cos(lat0) * Math.sin(dR) * Math.cos(brg));
    const lon = lon0 + Math.atan2(Math.sin(brg) * Math.sin(dR) * Math.cos(lat0),
                                  Math.cos(dR) - Math.sin(lat0) * Math.sin(lat));
    return [lat, lon];
  }

  //! Kurz na trati v bodě x. Po ortodromě se sbíhají poledníky, takže se
  //! trať za 100 km stočí zhruba o stupeň — přesně jak by to ukázala GPS.
  trackRad(x) {
    const a = this.posRad(x), b = this.posRad(x + 200);
    return GmGeo.initialBearingRad(a[0], a[1], b[0], b[1]);
  }

  //! Řádky databáze ve stejném pozičním tvaru jako airports.json:
  //! [ident, name, lat, lon, elev, hasMetar]. Identy a jména jsou skutečná,
  //! poloha a elevace herní — přístroj, který ukazuje letiště, kam se v té hře
  //! nedostaneš, by byl horší než žádný.
  dbRows() { return this._rows; }

  _rebuildRows(world) {
    const segs = world.segs;
    let n = 0;
    this._rows.length = 0;
    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i];
      if (seg.type !== "airfield") continue;
      if (seg.gmIdent == null) {
        const nm = GM_FIELD_NAMES[n % GM_FIELD_NAMES.length];
        seg.gmIdent = nm[0];
        seg.gmName = nm[1];
      }
      const cx = (seg.x0 + seg.x1) / 2;
      const ll = this.posRad(cx);
      this._rows.push([seg.gmIdent, seg.gmName,
                       ll[0] * 180 / Math.PI, ll[1] * 180 / Math.PI,
                       Math.round(seg.flat), 0]);
      n += 1;
    }
  }

  // ------------------------------------------------------------- napájení ---
  //! Podstrčí appce to, co by na zápěstí přišlo z čidel.
  sync(world, glider, qnhActualHpa, dt) {
    if (!this.open) return;

    world.ensure(glider.x + GM_LOOKAHEAD_M);
    this._rebuildRows(world);

    // Výška -> tlak -> zpátky výška: appka si QNH aplikuje sama, přesně jednou.
    // Když ho pilot nemá nastavené správně, MSL je posunutá — jako doopravdy.
    this.baro.setPressureHpa(GmBaro.pressureForAltitude(glider.h, qnhActualHpa));

    const ll = this.posRad(glider.displayX());
    // Kurz: v přímém letu trať, v kruhu se otáčí s fází — proto se dá na téhle
    // hře otestovat i šipka vztažená ke kurzu.
    let headingRad = this.trackRad(glider.displayX());
    if (glider.mode === "circle") headingRad = GmGeo.normaliseRad(headingRad + glider.circlePhase);

    this.pos.applySim({
      latRad: ll[0],
      lonRad: ll[1],
      speedMps: glider.v,
      headingRad: headingRad,
      live: !this.simGpsLost,
      ageSec: this.simGpsLost ? Math.round(this._lostFor) : 0,
    });
    this._lostFor = this.simGpsLost ? this._lostFor + dt : 0;

    // Vlastní časovač aplikace tiká jednou za sekundu — stejně jako na
    // hodinkách, takže i případná trhanost odečtu je věrná.
    this._tickT += dt;
    if (this._tickT >= 1.0) {
      this._tickT = 0;
      const top = this.ui.top();
      if (top && top.view.refresh) top.view.refresh();
      this.ui.requestUpdate();
    }
  }

  // --------------------------------------------------------------- vstup ---
  //! Vrátí false, když BACK na kořenové obrazovce znamená „ukonči aplikaci".
  buttonDown(id) {
    this._holdId = id;
    this._holdT = 0;
    this._holdFired = false;
  }

  buttonHold(dt) {
    if (this._holdId == null || this._holdFired) return;
    this._holdT += dt;
    // Podržené UP = MENU, přesně jako na hodinkách.
    if (this._holdT >= 0.5 && this._holdId === "UP") {
      this._holdFired = true;
      this._dispatch("MENU");
    }
  }

  buttonUp(id) {
    if (this._holdId !== id) return true;
    this._holdId = null;
    if (this._holdFired) return true;
    return this._dispatch(id);
  }

  _dispatch(id) {
    const top = this.ui.top();
    if (top == null) return true;
    const d = top.delegate;
    let handled = false;

    if (id === "UP") handled = d.onPreviousPage ? d.onPreviousPage() : false;
    else if (id === "DOWN") handled = d.onNextPage ? d.onNextPage() : false;
    else if (id === "GPS") handled = d.onSelect ? d.onSelect() : false;
    else if (id === "MENU") handled = d.onMenu ? d.onMenu() : false;
    else if (id === "SET") {
      handled = d.onBack ? d.onBack() : false;
      if (!handled && this.ui.stack.length > 1) { this.ui.popView(); handled = true; }
      if (!handled) return false;          // kořen: konec aplikace
    } else if (id === "SIM") {
      this.simGpsLost = !this.simGpsLost;
      this._lostFor = 0;
      handled = true;
    }

    this.ui.requestUpdate();
    return true;
  }

  // -------------------------------------------------------------- kreslení ---
  //! Vykreslí obrazovku a srazí ji na 1 bit. Instinct 2 nemá šedou ani
  //! vyhlazování, takže cokoliv, co v simulátoru drží jen díky antialiasingu,
  //! by na zařízení zmizelo.
  _renderScreen() {
    const top = this.ui.top();
    if (top == null) return;

    this.sctx.setTransform(1, 0, 0, 1, 0, 0);
    top.view.onUpdate(this.dc);

    const img = this.sctx.getImageData(0, 0, WATCH_SCREEN, WATCH_SCREEN);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i + 1] + d[i + 2]) > 382 ? 255 : 0;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    this.sctx.putImageData(img, 0, 0);
    this.ui.dirty = false;
  }

  //! Vykreslí hodinky do herního plátna. Vrací měřítko, aby si volající uměl
  //! přepočítat dotyk na tlačítka.
  blit(ctx, ox, oy, scale) {
    if (this.ui.dirty) this._renderScreen();

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // pouzdro
    ctx.fillStyle = "#2b2f34";
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.5;
    gmRoundRect(ctx, 0, 0, this.DEV_W, this.DEV_H, 26);
    ctx.fill();
    ctx.stroke();

    // tlačítka
    ctx.font = "700 9px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const b of this.buttons) {
      const active = this._holdId === b.id;
      ctx.fillStyle = b.id === "SIM"
        ? (this.simGpsLost ? "#a8642a" : "#3a4046")
        : (active ? "#6f7880" : "#4a525a");
      gmRoundRect(ctx, b.x, b.y, b.w, b.h, 5);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
    }

    // displej
    ctx.fillStyle = "#000";
    ctx.fillRect(this.BX - 2, this.BY - 2, WATCH_SCREEN + 4, WATCH_SCREEN + 4);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.screen, this.BX, this.BY);
    ctx.imageSmoothingEnabled = true;

    // obrys subokna — fyzicky je to samostatné kulaté okénko
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.BX + this.sub.x + this.sub.w / 2, this.BY + this.sub.y + this.sub.h / 2,
            this.sub.w / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  //! Které tlačítko leží pod bodem herního plátna, nebo null.
  //! Zásah je štědřejší než kresba — na telefonu je 24 px málo.
  hitTest(px, py, ox, oy, scale) {
    const x = (px - ox) / scale, y = (py - oy) / scale;
    const pad = 12;
    for (const b of this.buttons) {
      if (x >= b.x - pad && x <= b.x + b.w + pad &&
          y >= b.y - pad && y <= b.y + b.h + pad) return b.id;
    }
    return null;
  }
}

//! roundRect chybí do iOS Safari 16 — stejná pojistka jako v render.js.
function gmRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
