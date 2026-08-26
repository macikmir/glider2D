"use strict";
// GlideMate — obrazovky a vstup, port z GaFly/source/views/*.mc a util/Arrow.mc.
//
// Layoutové konstanty jsou převzaté beze změny, včetně komentářů, které říkají
// proč jsou zrovna takové. Právě proto má smysl to takhle simulovat: když se
// dva prvky na 176x176 potkají, potkají se i na zápěstí.

// ------------------------------------------------------------------- fonty ---
// Instinct 2 fonty se v prohlížeči nedají mít, ale šířka textu je to, co
// rozhoduje o kolizích sloupců. Velikost se proto při startu dopočítá tak, aby
// referenční řetězec vyšel na tolik pixelů, kolik byl na zařízení naměřen.
// Výška se hlásí jako pevná hodnota ze zařízení — appka si o ni říká přes
// getFontHeight() při kreslení inverzních podkladů.
const GM_FONT_FAMILY = '"Arial Narrow", "Roboto Condensed", system-ui, sans-serif';

const GM_FONT = {
  XTINY:         { px: 15, height: 23, ref: "8888 m", refW: 53 },
  MEDIUM:        { px: 20, height: 29, ref: "888",    refW: 42 },
  NUMBER_MEDIUM: { px: 26, height: 41, ref: "8888",   refW: 60 },
};

const GM_JUSTIFY = { LEFT: 1, RIGHT: 2, CENTER: 4, VCENTER: 8 };

// ---------------------------------------------------------------------- Dc ---
// Napodobenina Toybox.Graphics.Dc: jen to, co appka opravdu volá.
class GmDc {
  constructor(ctx, w, h) {
    this.ctx = ctx;
    this.w = w;
    this.h = h;
    this._fg = "#fff";
    this._bg = "#000";
    this._calibrated = false;
  }

  calibrate() {
    if (this._calibrated) return;
    const ctx = this.ctx;
    for (const key in GM_FONT) {
      const f = GM_FONT[key];
      // dvě iterace stačí: měření je v šířce lineární v px
      for (let i = 0; i < 2; i += 1) {
        ctx.font = this._css(f);
        const w = ctx.measureText(f.ref).width;
        if (w > 0.5) f.px = f.px * f.refW / w;
      }
    }
    this._calibrated = true;
  }

  _css(font) { return "600 " + font.px.toFixed(2) + "px " + GM_FONT_FAMILY; }

  getWidth() { return this.w; }
  getHeight() { return this.h; }

  setColor(fg, bg) { this._fg = fg; if (bg != null) this._bg = bg; }

  clear() {
    this.ctx.fillStyle = this._bg;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  fillRectangle(x, y, w, h) {
    this.ctx.fillStyle = this._fg;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  drawLine(x1, y1, x2, y2) {
    const ctx = this.ctx;
    ctx.strokeStyle = this._fg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
    ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
    ctx.stroke();
  }

  fillPolygon(pts) {
    const ctx = this.ctx;
    ctx.fillStyle = this._fg;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  getTextWidthInPixels(text, font) {
    this.ctx.font = this._css(font);
    return this.ctx.measureText(text).width;
  }

  getFontHeight(font) { return font.height; }

  drawText(x, y, font, text, justify) {
    const ctx = this.ctx;
    ctx.font = this._css(font);
    ctx.fillStyle = this._fg;
    ctx.textAlign = (justify & GM_JUSTIFY.CENTER) ? "center"
                  : ((justify & GM_JUSTIFY.RIGHT) ? "right" : "left");
    ctx.textBaseline = (justify & GM_JUSTIFY.VCENTER) ? "middle" : "top";
    ctx.fillText(text, x, y);
  }
}

// ------------------------------------------------------------------ Arrow ---
const GmArrow = {
  _BASE_ANGLE: 2.5,

  fill(dc, cx, cy, r, angleRad) { dc.fillPolygon(GmArrow._points(cx, cy, r, angleRad)); },

  outline(dc, cx, cy, r, angleRad) {
    const p = GmArrow._points(cx, cy, r, angleRad);
    for (let i = 0; i < p.length; i += 1) {
      const a = p[i], b = p[(i + 1) % p.length];
      dc.drawLine(a[0], a[1], b[0], b[1]);
    }
  },

  // Obrazovka se točí po směru od svislice: x roste doprava, y dolů, takže
  // nulový úhel musí dát hrot přesně nad střed.
  _points(cx, cy, r, angleRad) {
    const back = r * 0.85;
    return [
      [cx + r * Math.sin(angleRad), cy - r * Math.cos(angleRad)],
      [cx + back * Math.sin(angleRad + GmArrow._BASE_ANGLE),
       cy - back * Math.cos(angleRad + GmArrow._BASE_ANGLE)],
      [cx + back * Math.sin(angleRad - GmArrow._BASE_ANGLE),
       cy - back * Math.cos(angleRad - GmArrow._BASE_ANGLE)],
    ];
  },
};

// --------------------------------------------------------- PositionModel ---
// Stejné rozhraní jako na hodinkách; hodnoty místo GPS dodává simulátor.
class GmPositionModel {
  constructor() {
    this._latRad = null; this._lonRad = null;
    this._speedMps = null; this._headingRad = null;
    this._live = false; this._ageSec = null;
  }

  applySim(s) {
    this._live = s.live;
    if (s.live || this._latRad == null) {
      this._latRad = s.latRad;
      this._lonRad = s.lonRad;
      this._speedMps = s.speedMps;
      this._headingRad = s.headingRad;
    }
    this._ageSec = s.ageSec;
  }

  hasLiveFix() { return this._live; }
  hasAnyPosition() { return this._latRad != null && this._lonRad != null; }
  latRad() { return this._latRad; }
  lonRad() { return this._lonRad; }
  groundSpeedMps() { return this.hasLiveFix() ? this._speedMps : null; }
  orientationRad() { return this.hasLiveFix() ? this._headingRad : null; }
  isTrack() { return this._speedMps != null && this._speedMps >= 5.0; }
  fixAgeSeconds() { return this._ageSec; }
}

// ------------------------------------------------------ WatchUi (náhrada) ---
// Zásobník pohledů s stejnou sémantikou jako Toybox.WatchUi: push/pop/switchTo.
class GmUi {
  constructor() { this.stack = []; this.dirty = true; }

  top() { return this.stack[this.stack.length - 1] || null; }
  requestUpdate() { this.dirty = true; }

  pushView(view, delegate) {
    const cur = this.top();
    if (cur && cur.view.onHide) cur.view.onHide();
    this.stack.push({ view, delegate });
    if (view.onShow) view.onShow();
    this.dirty = true;
  }

  popView() {
    if (this.stack.length <= 1) return;
    const gone = this.stack.pop();
    if (gone.view.onHide) gone.view.onHide();
    const cur = this.top();
    if (cur && cur.view.onShow) cur.view.onShow();
    this.dirty = true;
  }

  switchToView(view, delegate) {
    const cur = this.top();
    if (cur && cur.view.onHide) cur.view.onHide();
    this.stack[this.stack.length - 1] = { view, delegate };
    if (view.onShow) view.onShow();
    this.dirty = true;
  }
}

// ---------------------------------------------------------------- AltView ---
// Výška v obou jednotkách vedle sebe, letová hladina v subokně, pohyb pod tím.
//
//   y   0.. 44  "MSL <unit>", vlevo od subokna
//               subokno (x 113..175, y 0..62): "FL" + hladina
//   y  53.. 95  hlavní výška, velká, celá vlevo od x=113
//   y  71.. 95  táž výška v druhé jednotce, na stejné účaří
//   y      100  oddělovač
//   y 101..125  řádek: rychlost nad zemí a směr
//   y 147..173  stavový řádek QNH
class GmAltView {
  constructor(baro, pos, dev) {
    this._baro = baro; this._pos = pos; this._dev = dev;
    this._adjusting = false;
    this._Y_HEADING = 30;
    this._Y_ALTITUDE = 74;
    this._Y_SEPARATOR = 100;
    this._Y_INFO_ROW = 113;
    this._Y_QNH = 160;
    this._Y_ALTITUDE_OTHER = 83;
    this._X_ALTITUDE = 58;
    this._X_INFO_LEFT = 44;
    this._X_INFO_RIGHT = 132;
  }

  setAdjusting(on) { this._adjusting = on; this._dev.ui.requestUpdate(); }
  isAdjusting() { return this._adjusting; }

  onUpdate(dc) {
    const w = dc.getWidth();
    const metric = GmSettings.altUnitMeters();
    const mslM = this._baro.mslAltitudeM();
    const sub = this._dev.sub;

    dc.setColor("#fff", "#000");
    dc.clear();
    dc.setColor("#fff", null);

    this._drawSubwindowFlightLevel(dc);

    dc.drawText(sub.x / 2, this._Y_HEADING, GM_FONT.XTINY,
                "MSL " + GmSettings.altUnitLabel(),
                GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);

    dc.drawText(this._X_ALTITUDE, this._Y_ALTITUDE, GM_FONT.NUMBER_MEDIUM,
                GmFmt.altitude(mslM, metric),
                GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);

    dc.drawText(sub.x + sub.w / 2, this._Y_ALTITUDE_OTHER, GM_FONT.XTINY,
                GmFmt.altitude(mslM, !metric) + " " + GmSettings.altUnitLabelOther(),
                GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);

    dc.drawLine(20, this._Y_SEPARATOR, w - 20, this._Y_SEPARATOR);

    this._drawInfoRow(dc);
    this._drawQnhLine(dc, w / 2, this._Y_QNH);
  }

  // TRK za letu, HDG při stání — jsou to různé veličiny a jeden popisek pro
  // obojí by byl polovinu času špatně.
  _drawInfoRow(dc) {
    dc.drawText(this._X_INFO_LEFT, this._Y_INFO_ROW, GM_FONT.XTINY,
                "GS " + GmFmt.groundSpeedKmh(this._pos.groundSpeedMps()),
                GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);

    const label = this._pos.isTrack() ? "TRK " : "HDG ";
    dc.drawText(this._X_INFO_RIGHT, this._Y_INFO_ROW, GM_FONT.XTINY,
                label + GmFmt.trackDegrees(this._pos.orientationRad()),
                GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);
  }

  _drawSubwindowFlightLevel(dc) {
    const sub = this._dev.sub;
    const cx = sub.x + sub.w / 2, cy = sub.y + sub.h / 2;
    dc.drawText(cx, cy - 12, GM_FONT.XTINY, "FL", GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);
    dc.drawText(cx, cy + 10, GM_FONT.MEDIUM, GmFmt.flightLevel(this._baro.flightLevel()),
                GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);
  }

  _drawQnhLine(dc, cx, cy) {
    const text = "QNH " + Math.round(this._baro.qnhHpa()) + " " + this._sourceLabel();

    if (this._adjusting) {
      const tw = dc.getTextWidthInPixels(text, GM_FONT.XTINY) + 10;
      const th = dc.getFontHeight(GM_FONT.XTINY) + 2;
      dc.setColor("#fff", "#fff");
      dc.fillRectangle(cx - tw / 2, cy - th / 2, tw, th);
      dc.setColor("#000", null);
    }

    dc.drawText(cx, cy, GM_FONT.XTINY, text, GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);

    if (this._adjusting) dc.setColor("#fff", null);
  }

  _sourceLabel() {
    const src = this._baro.qnhSource();
    if (src === GM_QNH_MANUAL) return "MAN";
    if (src === GM_QNH_METAR) return "MET";
    return "STD";
  }
}

class GmAltDelegate {
  constructor(baro, pos, view, dev) {
    this._baro = baro; this._pos = pos; this._view = view; this._dev = dev;
  }

  onSelect() { this._view.setAdjusting(!this._view.isAdjusting()); return true; }
  onNextPage() { return this._adjust(-1); }
  onPreviousPage() { return this._adjust(1); }

  onMenu() {
    this._dev.ui.pushView(new GmMenu2View(GmSettingsMenu.build(), this._dev),
                          new GmSettingsMenuDelegate(this._dev));
    return true;
  }

  onBack() {
    if (this._view.isAdjusting()) { this._view.setAdjusting(false); return true; }
    return false;
  }

  _adjust(deltaHpa) {
    if (!this._view.isAdjusting()) return this._toAirportsView();
    this._baro.nudgeManualQnh(deltaHpa);
    this._dev.ui.requestUpdate();
    return true;
  }

  _toAirportsView() {
    const view = new GmAirportsView(this._baro, this._pos, this._dev);
    this._dev.ui.switchToView(view, new GmAirportsDelegate(this._baro, this._pos, this._dev));
    return true;
  }
}

// ----------------------------------------------------------- AirportsView ---
// Nejbližší letiště: kterým směrem leží, jak daleko, a s jakou výškou bys nad
// ně přiletěl. Šipka je smysl téhle obrazovky — nahoře je směr letu, takže
// obrázek stojí vůči letadlu a hodinky se nemusí k ničemu natáčet.
//
// Plná šipka = dosažitelné se zachovanou rezervou. Obrys = není, nebo je
// poloha moc stará na to takové tvrzení vyslovit.
class GmAirportsView {
  constructor(baro, pos, dev) {
    this._baro = baro; this._pos = pos; this._dev = dev;
    this._db = new GmAirportDb();
    this._fixLatRad = null;
    this._fixLonRad = null;
    this._fixes = [];

    this._ROW_COUNT = 4;
    this._ROW_FIRST_Y = 78;
    this._ROW_STEP = 27;
    this._ARROW_CX = 15;
    this._ARROW_R = 8;
    this._COL_IDENT_X = 28;
    this._COL_DIST_X = 108;
    this._COL_ARRIVAL_X = 162;
    this._RECOMPUTE_DIST_M = 1000.0;
  }

  onShow() { this._db.setRows(this._dev.dbRows()); this.refresh(); }

  onHide() {
    this._db.unload();
    this._fixes = [];
    this._fixLatRad = null;
    this._fixLonRad = null;
  }

  // Kilometrový práh šetří jen úplný sken celé databáze — to je ta drahá část.
  // Vzdálenost a azimut už vybraných letišť se přepočítají každý tik, jsou to
  // čtyři haversiny za sekundu.
  //
  // POZOR, tohle je jediné místo, kde se port rozchází s originálem: v GaFly
  // drží práh i výsledky, takže vzdálenost stojí 33 s a pak skočí o kilometr
  // (a šipka po přeletu letiště ještě kilometr ukazuje dopředu). Odhaleno
  // právě tímhle simulátorem; do AirportsView.mc to patří stejně.
  refresh() {
    this._db.setRows(this._dev.dbRows());
    const lat = this._pos.latRad(), lon = this._pos.lonRad();
    if (lat == null || lon == null) return;

    if (this._needsRecompute(lat, lon)) {
      this._fixes = this._db.nearest(lat, lon, this._ROW_COUNT);
      this._fixLatRad = lat;
      this._fixLonRad = lon;
    } else {
      for (let i = 0; i < this._fixes.length; i += 1) this._fixes[i].updateFrom(lat, lon);
      this._sortByDistance();
    }

    GmGlide.annotate(this._fixes, this._baro.mslAltitudeM(), GmSettings.glideLD());
  }

  // Který ze čtyř je nejblíž, se mění i mezi skeny — přeletíš letiště a to
  // za tebou se propadne v pořadí. Obrazovka slibuje „nejbližší první".
  _sortByDistance() {
    const f = this._fixes;
    for (let i = 1; i < f.length; i += 1) {
      const cur = f[i];
      let j = i - 1;
      while (j >= 0 && f[j].distM > cur.distM) { f[j + 1] = f[j]; j -= 1; }
      f[j + 1] = cur;
    }
  }

  _needsRecompute(lat, lon) {
    if (this._fixes.length === 0 || this._fixLatRad == null || this._fixLonRad == null) return true;
    return GmGeo.distanceM(this._fixLatRad, this._fixLonRad, lat, lon) > this._RECOMPUTE_DIST_M;
  }

  onUpdate(dc) {
    dc.setColor("#fff", "#000");
    dc.clear();
    dc.setColor("#fff", null);

    this._drawHeader(dc);

    if (!this._pos.hasAnyPosition()) {
      dc.drawText(dc.getWidth() / 2, 110, GM_FONT.XTINY, "SEARCHING FOR GPS",
                  GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);
      return;
    }

    const reserve = GmSettings.arrivalReserveM();
    const live = this._pos.hasLiveFix();
    const orientation = this._pos.orientationRad();

    for (let i = 0; i < this._fixes.length; i += 1) {
      this._drawRow(dc, this._ROW_FIRST_Y + i * this._ROW_STEP, this._fixes[i],
                    reserve, live, orientation);
    }
  }

  _drawHeader(dc) {
    const sub = this._dev.sub;
    const cx = sub.x + sub.w / 2, cy = sub.y + sub.h / 2;
    dc.drawText(cx, cy - 12, GM_FONT.XTINY, "L/D", GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);
    dc.drawText(cx, cy + 10, GM_FONT.MEDIUM, String(GmSettings.glideLD()),
                GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);
    this._drawStatus(dc, sub.x / 2, cy);
  }

  // Jeden řádek pokrývá režim šipky i stav GPS — jsou to vzájemně vylučující
  // se fakta. Inverzní tedy znamená právě jedno: téhle poloze nevěř.
  _drawStatus(dc, cx, cy) {
    const live = this._pos.hasLiveFix();
    let text;

    if (live) text = this._orientationLabel();
    else if (this._pos.hasAnyPosition()) text = "OLD " + GmFmt.fixAge(this._pos.fixAgeSeconds());
    else text = "no fix";

    if (!live) {
      const tw = dc.getTextWidthInPixels(text, GM_FONT.XTINY) + 8;
      const th = dc.getFontHeight(GM_FONT.XTINY) + 2;
      dc.setColor("#fff", "#fff");
      dc.fillRectangle(cx - tw / 2, cy - th / 2, tw, th);
      dc.setColor("#000", null);
    }

    dc.drawText(cx, cy, GM_FONT.XTINY, text, GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);

    if (!live) dc.setColor("#fff", null);
  }

  _orientationLabel() {
    if (this._pos.orientationRad() == null) return "N UP";
    return this._pos.isTrack() ? "TRK UP" : "HDG UP";
  }

  _drawRow(dc, cy, fix, reserve, live, orientation) {
    const angle = GmGeo.relativeBearingRad(fix.bearingRad, orientation);
    if (live && fix.isReachable(reserve)) GmArrow.fill(dc, this._ARROW_CX, cy, this._ARROW_R, angle);
    else GmArrow.outline(dc, this._ARROW_CX, cy, this._ARROW_R, angle);

    dc.drawText(this._COL_IDENT_X, cy, GM_FONT.XTINY, fix.ident,
                GM_JUSTIFY.LEFT | GM_JUSTIFY.VCENTER);
    dc.drawText(this._COL_DIST_X, cy, GM_FONT.XTINY, GmFmt.distanceKm(fix.distM),
                GM_JUSTIFY.RIGHT | GM_JUSTIFY.VCENTER);
    dc.drawText(this._COL_ARRIVAL_X, cy, GM_FONT.XTINY, GmFmt.arrivalM(fix.arrivalM),
                GM_JUSTIFY.RIGHT | GM_JUSTIFY.VCENTER);
  }
}

class GmAirportsDelegate {
  constructor(baro, pos, dev) { this._baro = baro; this._pos = pos; this._dev = dev; }

  onPreviousPage() { return this._toAltView(); }
  onNextPage() { return this._toAltView(); }

  onMenu() {
    this._dev.ui.pushView(new GmMenu2View(GmSettingsMenu.build(), this._dev),
                          new GmSettingsMenuDelegate(this._dev));
    return true;
  }

  _toAltView() {
    const view = new GmAltView(this._baro, this._pos, this._dev);
    this._dev.ui.switchToView(view, new GmAltDelegate(this._baro, this._pos, view, this._dev));
    return true;
  }
}

// -------------------------------------------------------------- AdjustView ---
// Editor jednoho čísla: titulek, velká hodnota, UP/DOWN mění, BACK zavírá.
// Meze se ořezávají, nezalamují — přetočit z 70 na 10 palcem na tlačítku není
// nic, co by pilot kdy chtěl.
class GmAdjustView {
  constructor(title, value, min, max, step, onChange, dev) {
    this._title = title; this._value = value;
    this._min = min; this._max = max; this._step = step;
    this._onChange = onChange; this._dev = dev;
  }

  value() { return this._value; }

  nudge(direction) {
    let next = this._value + direction * this._step;
    if (next < this._min) next = this._min;
    else if (next > this._max) next = this._max;
    if (next !== this._value) {
      this._value = next;
      this._onChange(next);
      this._dev.ui.requestUpdate();
    }
  }

  onUpdate(dc) {
    const w = dc.getWidth(), h = dc.getHeight();
    dc.setColor("#fff", "#000");
    dc.clear();
    dc.setColor("#fff", null);

    dc.drawText(w / 2, h / 2 - 42, GM_FONT.XTINY, this._title,
                GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);
    dc.drawText(w / 2, h / 2, GM_FONT.NUMBER_MEDIUM, String(this._value),
                GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);
    dc.drawText(w / 2, h / 2 + 44, GM_FONT.XTINY, "UP / DOWN",
                GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);
  }
}

class GmAdjustDelegate {
  constructor(view, onClose, dev) { this._view = view; this._onClose = onClose; this._dev = dev; }
  onPreviousPage() { this._view.nudge(1); return true; }
  onNextPage() { this._view.nudge(-1); return true; }
  onBack() {
    this._dev.ui.popView();
    if (this._onClose) this._onClose();
    return true;
  }
}

// ------------------------------------------------------------ SettingsMenu ---
// POZOR: Menu2 kreslí systém, ne aplikace. Tenhle vzhled je tedy odhad —
// věrné je chování (co která klávesa dělá, kdy se překlopí přepínač), ne
// pixely. Vlastní kreslení appky na ostatních obrazovkách věrné je.
const GmSettingsMenu = {
  ITEM_ALT_UNIT: "altUnit",
  ITEM_GLIDE_LD: "glideLD",
  ITEM_RESERVE: "reserve",

  build() {
    return {
      title: "GlideMate",
      items: [
        { id: GmSettingsMenu.ITEM_ALT_UNIT, label: "Altitude", toggle: true,
          enabled: GmSettings.altUnitMeters(), on: "meters", off: "feet" },
        { id: GmSettingsMenu.ITEM_GLIDE_LD, label: "Glide L/D",
          sublabel: GmSettingsMenu.ldSubLabel() },
        { id: GmSettingsMenu.ITEM_RESERVE, label: "Arrival reserve",
          sublabel: GmSettingsMenu.reserveSubLabel() },
      ],
    };
  },

  ldSubLabel() { return "1 : " + GmSettings.glideLD(); },
  reserveSubLabel() { return GmSettings.arrivalReserveM() + " m"; },
};

class GmMenu2View {
  constructor(menu, dev) { this.menu = menu; this.sel = 0; this._dev = dev; }

  move(d) {
    this.sel = Math.max(0, Math.min(this.menu.items.length - 1, this.sel + d));
    this._dev.ui.requestUpdate();
  }

  selected() { return this.menu.items[this.sel]; }

  onUpdate(dc) {
    const w = dc.getWidth();
    dc.setColor("#fff", "#000");
    dc.clear();
    dc.setColor("#fff", null);

    dc.drawText(w / 2, 22, GM_FONT.XTINY, this.menu.title,
                GM_JUSTIFY.CENTER | GM_JUSTIFY.VCENTER);
    dc.drawLine(24, 38, w - 24, 38);

    const rowH = 42;
    for (let i = 0; i < this.menu.items.length; i += 1) {
      const it = this.menu.items[i];
      const y = 62 + i * rowH;
      if (i === this.sel) {
        dc.setColor("#fff", "#fff");
        dc.fillRectangle(6, y - 19, w - 12, rowH - 4);
        dc.setColor("#000", null);
      }
      dc.drawText(14, y - 8, GM_FONT.XTINY, it.label, GM_JUSTIFY.LEFT | GM_JUSTIFY.VCENTER);
      const sub = it.toggle ? (it.enabled ? it.on : it.off) : it.sublabel;
      dc.drawText(14, y + 12, GM_FONT.XTINY, sub, GM_JUSTIFY.LEFT | GM_JUSTIFY.VCENTER);
      if (i === this.sel) dc.setColor("#fff", null);
    }
  }
}

class GmSettingsMenuDelegate {
  constructor(dev) { this._dev = dev; this._pending = null; this._item = null; }

  onPreviousPage() { this._dev.ui.top().view.move(-1); return true; }
  onNextPage() { this._dev.ui.top().view.move(1); return true; }
  onBack() { this._dev.ui.popView(); return true; }

  // Menu2 překlopí ToggleMenuItem dřív, než ho předá aplikaci, takže
  // isEnabled() už hlásí stav, který pilot právě zvolil.
  onSelect() {
    const view = this._dev.ui.top().view;
    const item = view.selected();

    if (item.id === GmSettingsMenu.ITEM_ALT_UNIT) {
      item.enabled = !item.enabled;
      GmSettings.setAltUnitMeters(item.enabled);
      this._dev.ui.requestUpdate();

    } else if (item.id === GmSettingsMenu.ITEM_GLIDE_LD) {
      this._pushAdjust(item, "Glide L/D", GmSettings.glideLD(),
                       GmSettings.MIN_GLIDE_LD, GmSettings.MAX_GLIDE_LD, 1,
                       (v) => { GmSettings.setGlideLD(v); this._pending = GmSettingsMenu.ITEM_GLIDE_LD; });

    } else if (item.id === GmSettingsMenu.ITEM_RESERVE) {
      this._pushAdjust(item, "Reserve (m)", GmSettings.arrivalReserveM(),
                       GmSettings.MIN_RESERVE_M, GmSettings.MAX_RESERVE_M, 50,
                       (v) => { GmSettings.setArrivalReserveM(v); this._pending = GmSettingsMenu.ITEM_RESERVE; });
    }
    return true;
  }

  _pushAdjust(item, title, value, min, max, step, onChange) {
    this._item = item;
    const view = new GmAdjustView(title, value, min, max, step, onChange, this._dev);
    this._dev.ui.pushView(view, new GmAdjustDelegate(view, () => this.onAdjustClosed(), this._dev));
  }

  onAdjustClosed() {
    if (this._item == null) return;
    if (this._pending === GmSettingsMenu.ITEM_GLIDE_LD) this._item.sublabel = GmSettingsMenu.ldSubLabel();
    else if (this._pending === GmSettingsMenu.ITEM_RESERVE) this._item.sublabel = GmSettingsMenu.reserveSubLabel();
    this._pending = null;
    this._item = null;
    this._dev.ui.requestUpdate();
  }
}
