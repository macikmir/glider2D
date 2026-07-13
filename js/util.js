"use strict";
// Drobné matematické utility + deterministický šum.
const U = {
  clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
  clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); },
  lerp(a, b, t) { return a + (b - a) * t; },
  smoothstep(t) { t = U.clamp01(t); return t * t * (3 - 2 * t); },

  // mulberry32 – seedovatelný RNG
  rng(seed) {
    let s = seed >>> 0;
    return function () {
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  // hash celého čísla -> [0,1)
  hash1(n) {
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  },

  // hladký 1D value noise, výstup zhruba [-1,1]
  noise1(x, seed) {
    const i = Math.floor(x), f = x - i;
    const a = U.hash1(i * 374761 + (seed | 0) * 668265);
    const b = U.hash1((i + 1) * 374761 + (seed | 0) * 668265);
    return (U.lerp(a, b, U.smoothstep(f)) - 0.5) * 2;
  },

  kmh(ms) { return ms * 3.6; },
  ms(kmh) { return kmh / 3.6; },

  fmtTime(hours) {
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return h + ":" + (m < 10 ? "0" : "") + m;
  },
};
