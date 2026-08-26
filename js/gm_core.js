"use strict";
// GlideMate — port logiky z Monkey C (repo GaFly) do JS.
//
// Tenhle soubor je překlad, ne přepis: vzorce, meze, zaokrouhlování i návratové
// hodnoty odpovídají originálu řádek po řádku, aby simulátor v TERMICE testoval
// opravdovou aplikaci a ne její hezčí dvojče. Když se něco chová divně tady,
// chová se to divně i na zápěstí.
//
// Zdroje: GaFly/source/model/Baro.mc, util/Geo.mc, util/Fmt.mc,
//         model/AirportDb.mc, model/Settings.mc

// ---------------------------------------------------------------- Baro.mc ---
const GmBaro = {
  STD_PRESSURE_HPA: 1013.25,
  _COEFF: 44330.77,
  _EXP: 0.190263,
  M_TO_FT: 3.28084,

  MIN_PRESSURE_HPA: 150.0,
  MAX_PRESSURE_HPA: 1100.0,
  MIN_QNH_HPA: 900.0,
  MAX_QNH_HPA: 1100.0,

  altitudeM(pHpa, p0Hpa) {
    if (pHpa == null || p0Hpa == null) return null;
    if (pHpa < GmBaro.MIN_PRESSURE_HPA || pHpa > GmBaro.MAX_PRESSURE_HPA) return null;
    if (p0Hpa < GmBaro.MIN_PRESSURE_HPA || p0Hpa > GmBaro.MAX_PRESSURE_HPA) return null;
    return GmBaro._COEFF * (1.0 - Math.pow(pHpa / p0Hpa, GmBaro._EXP));
  },

  stdAltitudeM(pHpa) { return GmBaro.altitudeM(pHpa, GmBaro.STD_PRESSURE_HPA); },

  flightLevel(stdAltM) {
    if (stdAltM == null) return null;
    return Math.round(stdAltM * GmBaro.M_TO_FT / 100.0);
  },

  metersToFeet(m) { return (m == null) ? null : m * GmBaro.M_TO_FT; },

  // Obrácený hypsometrický vzorec — v hodinkách není, tady je potřeba:
  // hra zná výšku, čidlo tlaku nemá. Tímhle se výška převede zpět na tlak,
  // který pak projde stejnou cestou jako skutečné měření z barometru.
  pressureForAltitude(altM, p0Hpa) {
    return p0Hpa * Math.pow(1.0 - altM / GmBaro._COEFF, 1.0 / GmBaro._EXP);
  },
};

// ----------------------------------------------------------------- Geo.mc ---
const GmGeo = {
  EARTH_R_M: 6371008.8,

  distanceM(lat1, lon1, lat2, lon2) {
    const dLat = lat2 - lat1, dLon = lon2 - lon1;
    const sLat = Math.sin(dLat / 2.0), sLon = Math.sin(dLon / 2.0);
    let a = sLat * sLat + Math.cos(lat1) * Math.cos(lat2) * sLon * sLon;
    if (a < 0.0) a = 0.0; else if (a > 1.0) a = 1.0;
    return 2.0 * GmGeo.EARTH_R_M * Math.asin(Math.sqrt(a));
  },

  initialBearingRad(lat1, lon1, lat2, lon2) {
    const dLon = lon2 - lon1;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    let b = Math.atan2(y, x);
    if (b < 0.0) b += 2.0 * Math.PI;
    return b;
  },

  relativeBearingRad(bearingRad, headingRad) {
    if (headingRad == null) return GmGeo.normaliseRad(bearingRad);
    return GmGeo.normaliseRad(bearingRad - headingRad);
  },

  normaliseRad(angle) {
    const twoPi = 2.0 * Math.PI;
    let a = angle;
    while (a < 0.0) a += twoPi;
    while (a >= twoPi) a -= twoPi;
    return a;
  },

  latSeparationM(lat1, lat2) {
    let d = lat2 - lat1;
    if (d < 0.0) d = -d;
    return d * GmGeo.EARTH_R_M;
  },
};

// ----------------------------------------------------------------- Fmt.mc ---
const GmFmt = {
  MAX_DISTANCE_CHARS: 4,
  MAX_ARRIVAL_CHARS: 5,

  distanceKm(distM) {
    const km = distM / 1000.0;
    if (km >= 999.5) return ">999";
    if (km < 0.0) return "---";
    return (km < 99.95) ? km.toFixed(1) : km.toFixed(0);
  },

  altitude(altM, metric) {
    if (altM == null) return "---";
    const v = metric ? altM : GmBaro.metersToFeet(altM);
    if (v == null) return "---";
    return String(Math.round(v));
  },

  flightLevel(fl) {
    if (fl == null) return "---";
    return String(fl < 0 ? 0 : fl).padStart(3, "0");
  },

  groundSpeedKmh(mps) {
    if (mps == null || mps < 0.0) return "---";
    const kmh = Math.round(mps * 3.6);
    return (kmh > 999) ? "999" : String(kmh);
  },

  // Zaokrouhlí se před zalomením, takže 359,7° dá 000 a ne 360.
  trackDegrees(trackRad) {
    if (trackRad == null) return "---";
    let deg = Math.round(trackRad * 180.0 / Math.PI) % 360;
    if (deg < 0) deg += 360;
    return String(deg).padStart(3, "0");
  },

  fixAge(seconds) {
    if (seconds == null || seconds < 0) return "?";
    if (seconds < 60) return "now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h";
    const days = Math.floor(hours / 24);
    return (days > 99) ? "99d+" : (days + "d");
  },

  arrivalM(arrival) {
    if (arrival == null) return "---";
    const v = Math.round(arrival);
    if (v > 9999) return "+9999";
    if (v < -9999) return "-9999";
    return (v >= 0) ? ("+" + v) : String(v);
  },
};

// ------------------------------------------------------------ AirportDb.mc ---
class GmAirportFix {
  constructor(ident, name, elevM, hasMetar, latRad, lonRad) {
    this.ident = ident;
    this.name = name;
    this.elevM = elevM;
    this.hasMetar = hasMetar;
    // Poloha letiště se drží, ne jen výsledek. Vzdálenost a azimut platí vždy
    // jen k nějakému bodu, a ten se pod letadlem mění každou vteřinu.
    this.latRad = latRad;
    this.lonRad = lonRad;
    this.distM = 0;
    this.bearingRad = 0;
    this.arrivalM = null;
  }

  //! Přepočte vzdálenost a azimut z aktuální polohy.
  updateFrom(latRad, lonRad) {
    this.distM = GmGeo.distanceM(latRad, lonRad, this.latRad, this.lonRad);
    this.bearingRad = GmGeo.initialBearingRad(latRad, lonRad, this.latRad, this.lonRad);
  }

  isReachable(reserveM) {
    return (this.arrivalM != null) && (this.arrivalM >= reserveM);
  }
}

// Řádky jsou poziční pole [ident, name, latDeg, lonDeg, elevM, hasMetar],
// stejně jako v airports.json. V simulátoru je plní herní svět (viz watch.js),
// ale vyhledávání běží přesně tím kódem, co na hodinkách.
class GmAirportDb {
  constructor() { this._rows = null; }

  setRows(rows) { this._rows = rows; }
  unload() { this._rows = null; }
  size() { return this._rows == null ? 0 : this._rows.length; }

  nearest(latRad, lonRad, count) {
    const rows = this._rows;
    const result = [];
    if (rows == null) return result;

    let worstM = 0.0;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const aLat = row[2] * Math.PI / 180.0;

      if (result.length >= count && GmGeo.latSeparationM(latRad, aLat) >= worstM) continue;

      const aLon = row[3] * Math.PI / 180.0;
      const d = GmGeo.distanceM(latRad, lonRad, aLat, aLon);

      if (result.length >= count && d >= worstM) continue;

      const fix = new GmAirportFix(row[0], row[1], row[4], row[5] !== 0, aLat, aLon);
      fix.updateFrom(latRad, lonRad);
      this._insertSorted(result, fix, count);
      worstM = result[result.length - 1].distM;
    }

    return result;
  }

  _insertSorted(list, fix, count) {
    let pos = list.length;
    for (let i = 0; i < list.length; i += 1) {
      if (fix.distM < list[i].distM) { pos = i; break; }
    }
    if (pos >= count) return;

    list.push(fix);
    for (let i = list.length - 1; i > pos; i -= 1) list[i] = list[i - 1];
    list[pos] = fix;

    while (list.length > count) list.pop();
  }
}

// Přímá still-air geometrie — bez větru, bez MacCreadyho, bez poláry.
// To je poctivá mez toho, co appka ví, a důvod, proč existuje příletová rezerva.
const GmGlide = {
  arrivalHeightM(altMslM, elevM, distM, ld) {
    if (altMslM == null || ld <= 0) return null;
    return altMslM - elevM - distM / ld;
  },

  annotate(fixes, altMslM, ld) {
    for (let i = 0; i < fixes.length; i += 1) {
      fixes[i].arrivalM = GmGlide.arrivalHeightM(altMslM, fixes[i].elevM, fixes[i].distM, ld);
    }
  },
};

// ------------------------------------------------------------- Settings.mc ---
// Na hodinkách Application.Properties, tady localStorage. Stejné klíče,
// stejné výchozí hodnoty, stejné meze — a stejná zásada, že konfigurační
// problém nesmí nic zablokovat, takže každé čtení má fallback.
const GmSettings = {
  DEFAULT_QNH_HPA: 1013,
  DEFAULT_GLIDE_LD: 32,
  DEFAULT_RESERVE_M: 150,
  MIN_GLIDE_LD: 10,
  MAX_GLIDE_LD: 70,
  MIN_RESERVE_M: 0,
  MAX_RESERVE_M: 1000,

  _get(key, fallback) {
    try {
      const v = localStorage.getItem("gm_" + key);
      if (v == null) return fallback;
      const p = JSON.parse(v);
      return (typeof p === typeof fallback) ? p : fallback;
    } catch (e) { return fallback; }
  },

  _set(key, value) {
    try { localStorage.setItem("gm_" + key, JSON.stringify(value)); } catch (e) { /* nevadí */ }
  },

  _clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },

  useManualQnh() { return GmSettings._get("useManualQnh", true); },
  manualQnh() { return GmSettings._get("manualQnh", GmSettings.DEFAULT_QNH_HPA); },
  setManualQnh(hpa) {
    GmSettings._set("manualQnh", hpa);
    GmSettings._set("useManualQnh", true);
  },

  altUnitMeters() { return GmSettings._get("altUnitMeters", false); },
  setAltUnitMeters(m) { GmSettings._set("altUnitMeters", m); },
  altUnitLabel() { return GmSettings.altUnitMeters() ? "m" : "ft"; },
  altUnitLabelOther() { return GmSettings.altUnitMeters() ? "ft" : "m"; },

  glideLD() {
    return GmSettings._clamp(GmSettings._get("glideLD", GmSettings.DEFAULT_GLIDE_LD),
                             GmSettings.MIN_GLIDE_LD, GmSettings.MAX_GLIDE_LD);
  },
  setGlideLD(ld) {
    GmSettings._set("glideLD", GmSettings._clamp(ld, GmSettings.MIN_GLIDE_LD, GmSettings.MAX_GLIDE_LD));
  },

  arrivalReserveM() {
    return GmSettings._clamp(GmSettings._get("arrivalReserveM", GmSettings.DEFAULT_RESERVE_M),
                             GmSettings.MIN_RESERVE_M, GmSettings.MAX_RESERVE_M);
  },
  setArrivalReserveM(m) {
    GmSettings._set("arrivalReserveM", GmSettings._clamp(m, GmSettings.MIN_RESERVE_M, GmSettings.MAX_RESERVE_M));
  },
};

// --------------------------------------------------------------- BaroModel ---
const GM_QNH_STANDARD = 0, GM_QNH_MANUAL = 1, GM_QNH_METAR = 2;

class GmBaroModel {
  constructor() {
    this._pressureHpa = null;
    this._qnhHpa = GmBaro.STD_PRESSURE_HPA;
    this._qnhSource = GM_QNH_STANDARD;
    this.loadSettings();
  }

  loadSettings() {
    const useManual = GmSettings.useManualQnh();
    const manual = GmSettings.manualQnh();
    if (useManual && manual >= GmBaro.MIN_QNH_HPA && manual <= GmBaro.MAX_QNH_HPA) {
      this._qnhHpa = manual;
      this._qnhSource = GM_QNH_MANUAL;
    } else {
      this._qnhHpa = GmBaro.STD_PRESSURE_HPA;
      this._qnhSource = GM_QNH_STANDARD;
    }
  }

  // Na hodinkách čte čidlo, tady tlak dodává simulátor.
  setPressureHpa(hpa) { this._pressureHpa = hpa; }

  pressureHpa() { return this._pressureHpa; }
  qnhHpa() { return this._qnhHpa; }
  qnhSource() { return this._qnhSource; }

  mslAltitudeM() { return GmBaro.altitudeM(this._pressureHpa, this._qnhHpa); }
  stdAltitudeM() { return GmBaro.stdAltitudeM(this._pressureHpa); }
  flightLevel() { return GmBaro.flightLevel(this.stdAltitudeM()); }

  nudgeManualQnh(deltaHpa) {
    let next = (this._qnhSource === GM_QNH_MANUAL)
      ? this._qnhHpa + deltaHpa
      : Math.trunc(GmBaro.STD_PRESSURE_HPA) + deltaHpa;

    if (next < GmBaro.MIN_QNH_HPA) next = GmBaro.MIN_QNH_HPA;
    else if (next > GmBaro.MAX_QNH_HPA) next = GmBaro.MAX_QNH_HPA;

    this._qnhHpa = next;
    this._qnhSource = GM_QNH_MANUAL;
    GmSettings.setManualQnh(Math.trunc(this._qnhHpa));
  }
}

// Skutečné identy a jména českých letišť z OurAirports (public domain),
// přes tools/build_airports.py v repu GaFly. Tady slouží jen jako popisky —
// polohu i elevaci dodává herní svět, aby hodinky souhlasily s tím, na co se
// v té hře dá doopravdy sednout.
const GM_FIELD_NAMES = [
  ["LKRK", "Rakovnik"], ["LKPM", "Příbram"], ["LKVL", "Vlašim"], ["LKBE", "Benešov"],
  ["LKZB", "Zbraslavice"], ["LKHV", "Hořovice"], ["LKKL", "Kladno"], ["LKSN", "Slaný"],
  ["LKKO", "Kolín"], ["LKNY", "Nymburk"], ["LKMB", "Mladá Boleslav"], ["LKJC", "Jičín"],
  ["LKHC", "Hořice"], ["LKJA", "Jaroměř"], ["LKZM", "Žamberk"], ["LKVM", "Vysoké Mýto"],
  ["LKCR", "Chrudim"], ["LKSK", "Skuteč"], ["LKPA", "Polička"], ["LKCT", "Chotěboř"],
  ["LKPI", "Přibyslav"], ["LKHB", "Havlíčkův Brod"], ["LKJI", "Jihlava"], ["LKKA", "Křižanov"],
  ["LKTA", "Tábor"], ["LKSO", "Soběslav"], ["LKST", "Strakonice"], ["LKHS", "Hosín"],
  ["LKKT", "Klatovy"], ["LKRY", "Rokycany"], ["LKLN", "Plzeň-Líně"], ["LKPS", "Plasy"],
  ["LKTO", "Toužim"], ["LKZD", "Žatec"], ["LKMO", "Most"], ["LKCH", "Chomutov"],
  ["LKRO", "Roudnice"], ["LKCE", "Česká Lípa"], ["LKMH", "Mnichovo Hradiště"], ["LKSU", "Šumperk"],
  ["LKKM", "Kroměříž"], ["LKPJ", "Prostějov"], ["LKHN", "Hranice"], ["LKKY", "Kyjov"],
];
