"use strict";
// Herní konstanty. Jednotky: metry, sekundy, m/s (zobrazení km/h).
const CFG = {
  G: 9.81,

  // --- polára kluzáku (standardní třída, ~LS4) ---
  // opadání w(v) = polarA * (v - polarV0)^2 + polarS0   [m/s, v v m/s]
  polarA: 0.0028,
  polarV0: 23.6,   // rychlost minimálního opadání (~85 km/h)
  polarS0: 0.62,   // minimální opadání

  vStall: 17.5,    // pádová (~63 km/h)
  vBuffet: 18.6,   // varování před pádem
  vNe: 63.9,       // nepřekročitelná (~230 km/h)
  vTrim: 26.5,     // výchozí rychlost po vypnutí

  pitchAccel: 3.2,      // max podélné zrychlení od výškovky [m/s²]
  stallDrop: 22,        // ztráta výšky při přetažení [m]

  // --- kroužení ---
  circleSpeed: 25.6,    // ~92 km/h
  circleSink: 0.85,     // opadání v kruhu (klopení ~40°)
  circleNudge: 26,      // rychlost centrování [m/s]
  circlePeriod: 9,      // vizuální perioda kruhu [s]
  circleRadiusVis: 32,  // vizuální poloměr [m]

  // --- aerovlek ---
  towSpeed: 33,         // ~119 km/h
  towClimb: 5.5,        // arkádově svižný vlek
  towAutoRelease: 600,  // AGL auto-vypnutí
  towRollTime: 5,       // rozjezd [s]

  // --- den / termika ---
  // Herní kompromis: fyzika kluzáku je reálná, ale pracovní pásmo termiky je
  // nižší a stoupáky/klesáky silnější, aby jeden den (~14 min) dal několik
  // celých cyklů stoupání+přeskok.
  dayStartH: 12.0,
  dayEndH: 20.0,
  daySpeed: 30,         // 1 reálná s = 30 denních s  (celý den ~14 min)
  cloudbase0: 1250,     // MSL na začátku dne
  cloudbaseRise: 260,   // nárůst během dne

  // --- terén ---
  elev0: 300,           // základní nadmořská výška terénu

  // --- přistání ---
  landMaxVField: 27.8,  // max rychlost do pole (~100 km/h)
  landMaxVApt: 31.5,    // max rychlost na letišti (~113 km/h)
  landMaxSink: 3.2,     // max klesání při dosednutí

  // --- kamera ---
  camViewMin: 460,      // min výška záběru [m]
  camViewMax: 3000,
  camAglFactor: 1.9,

  lowAltWarn: 250,      // AGL varování
};
