"use strict";
// Řízení hry: stavy, vstupy, smyčka, UI overlaye.
(function () {
  const canvas = document.getElementById("game");
  const renderer = new Renderer(canvas);
  const audio = new GameAudio();

  const elMenu = document.getElementById("menu");
  const elHelp = document.getElementById("help");
  const elResult = document.getElementById("result");
  const elTouch = document.getElementById("touchui");
  const btnAction = document.getElementById("btnAction");
  const elBest = document.getElementById("bestline");

  let state = "menu";           // menu | flying | result
  let world, glider, towPlane;
  let tDay = 0;                 // denní sekundy od startu
  let msgs = [];
  let tips = {};
  let flightTime = 0;
  let paused = false;

  let best = parseFloat(localStorage.getItem("termika_best") || "0") || 0;

  // ---------- vstupy ----------
  const input = { pitch: 0, nudge: 0, action: false };
  const keys = {};
  let touch = null;             // {id, x0, y0, x, y}

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    keys[e.code] = true;
    audio.ensure();
    if (e.code === "Space") {
      e.preventDefault();
      if (state === "flying") input.action = true;
      else if (state === "menu" && elHelp.classList.contains("hidden")) startFlight();
      else if (state === "result") restart();
    }
    if (e.code === "KeyR" && state !== "menu") restart();
    if (e.code === "KeyM") audio.toggleMute();
    if (e.code === "KeyP" || e.code === "Escape") { if (state === "flying") paused = !paused; }
    if (e.code === "KeyH") { if (state === "menu") showHelp(true); }
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  canvas.addEventListener("pointerdown", (e) => {
    audio.ensure();
    if (state !== "flying") return;
    if (touch) return;
    touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (touch && e.pointerId === touch.id) { touch.x = e.clientX; touch.y = e.clientY; }
  });
  const endTouch = (e) => {
    if (touch && e.pointerId === touch.id) touch = null;
  };
  canvas.addEventListener("pointerup", endTouch);
  canvas.addEventListener("pointercancel", endTouch);

  btnAction.addEventListener("click", () => {
    audio.ensure();
    if (state === "flying") input.action = true;
  });

  document.getElementById("btnStart").addEventListener("click", () => { audio.ensure(); startFlight(); });
  document.getElementById("btnHelp").addEventListener("click", () => showHelp(true));
  document.getElementById("btnHelpClose").addEventListener("click", () => showHelp(false));
  document.getElementById("btnAgain").addEventListener("click", restart);

  window.addEventListener("resize", () => renderer.resize());
  document.addEventListener("visibilitychange", () => { if (document.hidden && state === "flying") paused = true; });

  const isTouchDevice = matchMedia("(pointer: coarse)").matches;

  function readInput(dt) {
    // klávesy
    let target = 0;
    if (keys["ArrowUp"] || keys["KeyW"]) target += 1;    // potlačit = zrychlit
    if (keys["ArrowDown"] || keys["KeyS"]) target -= 1;  // přitáhnout = zpomalit
    let nudge = 0;
    if (keys["ArrowLeft"] || keys["KeyA"]) nudge -= 1;
    if (keys["ArrowRight"] || keys["KeyD"]) nudge += 1;

    // dotyk: tažení nahoru = stoupat (přitáhnout/zpomalit), dolů = zrychlit
    if (touch) {
      const dy = touch.y - touch.y0;   // dolů kladné
      const dx = touch.x - touch.x0;
      target = U.clamp(dy / 110, -1, 1);
      nudge = U.clamp(dx / 90, -1, 1);
    }

    // plynulý náběh
    const k = Math.min(dt * 7, 1);
    input.pitch += (target - input.pitch) * k;
    if (Math.abs(input.pitch) < 0.02 && target === 0) input.pitch = 0;
    input.nudge = nudge;
  }

  // ---------- zprávy ----------
  function say(text, opts) {
    opts = opts || {};
    const now = performance.now() / 1000;
    msgs.push({ text, t0: now, until: now + (opts.dur || 3), color: opts.color, big: opts.big });
    if (msgs.length > 4) msgs.shift();
  }

  // ---------- start / restart ----------
  function startFlight() {
    world = new World((Math.random() * 1e9) | 0);
    glider = new Glider(world);
    towPlane = { x: glider.x + 62, h: glider.h, roped: true, gone: 0, pitchVis: 0 };
    tDay = 0;
    flightTime = 0;
    msgs = [];
    tips = {};
    paused = false;
    input.action = false;
    input.pitch = 0;
    touch = null;
    state = "flying";
    elMenu.classList.add("hidden");
    elResult.classList.add("hidden");
    if (isTouchDevice) elTouch.classList.add("visible");
    btnAction.textContent = "VYPNI";
    btnAction.classList.add("tow");
    btnAction.classList.remove("circling");
    say("Aerovlek — sleduj vário a vypni ve stoupáku", { dur: 4 });
  }

  function restart() {
    elResult.classList.add("hidden");
    startFlight();
  }

  function showHelp(show) {
    elHelp.classList.toggle("hidden", !show);
  }

  function showMenu() {
    state = "menu";
    elMenu.classList.remove("hidden");
    elBest.textContent = best > 0 ? "Tvůj rekord: " + best.toFixed(1) + " km" : "";
    elTouch.classList.remove("visible");
  }

  // ---------- konec letu ----------
  const VERDICTS = {
    airfield:   { t: "Přistání na letišti", v: "Elegantní tečka za letovým dnem. Tak létají mistři!", ok: true },
    outlanding: { t: "Přistání do pole", v: "Čistě sedlo. Teď jen sehnat transport…", ok: true },
    hard:       { t: "Tvrdé dosednutí", v: "Moc velké klesání při dotyku. Kluzák to odnesl.", ok: false },
    fast:       { t: "Přílišná rychlost", v: "Hoblování přes půl pole… podvozek u ledu.", ok: false },
    forest:     { t: "V lese", v: "Neponechal sis výšku na rozhodnutí. Trosky mezi stromy.", ok: false },
    village:    { t: "Do zástavby", v: "Tam se nepřistává. Tohle bolelo.", ok: false },
    lake:       { t: "Ve vodě", v: "Žbluňk. Kluzáky bohužel neplavou.", ok: false },
    spiral:     { t: "Vytočen do země", v: "Kroužit se má s výškovou rezervou.", ok: false },
    stallCrash: { t: "Přetažení u země", v: "Rychlost je život. Doslova.", ok: false },
    vne:        { t: "Překročení VNE", v: "Drak nevydržel. Rychloměr má červenou čárku z dobrého důvodu.", ok: false },
  };

  function finishFlight() {
    state = "result";
    const res = glider.result;
    const dist = glider.x / 1000;
    const V = VERDICTS[res.kind] || VERDICTS.outlanding;

    // vzdálenost se ukáže vždy, ale rekord platí jen při přistání v pořádku
    let newRec = false;
    if (res.ok && dist > best) { best = dist; newRec = true; localStorage.setItem("termika_best", String(best)); }

    document.getElementById("resTitle").textContent = (res.ok ? "🏆 " : "💥 ") + V.t;
    document.getElementById("resVerdict").textContent = V.v;

    const st = glider.stats;
    const rows = [
      `<div class="big">${dist.toFixed(1)} km</div>`,
      newRec ? `<div class="rec">★ NOVÝ REKORD ★</div>` : "",
      `<span>Čas letu</span><b>${Math.floor(flightTime / 60)} min ${Math.floor(flightTime % 60)} s</b>`,
      `<span>Vypnutí vleku</span><b>${st.releaseAlt} m AGL</b>`,
      `<span>Max. výška</span><b>${Math.round(st.maxAlt)} m MSL</b>`,
      `<span>Nejlepší stoupák</span><b>${st.bestClimb > 0 ? "+" + st.bestClimb.toFixed(1) + " m/s" : "—"}</b>`,
      `<span>Vytočené stoupáky</span><b>${st.thermals}</b>`,
      `<span>Přistání v</span><b>${U.fmtTime(CFG.dayStartH + tDay * 1 / 3600)}</b>`,
    ];
    document.getElementById("resStats").innerHTML = rows.join("");
    elResult.classList.remove("hidden");
    elTouch.classList.remove("visible");
  }

  // ---------- události z fyziky ----------
  function handleEvents(events) {
    for (const ev of events) {
      switch (ev.type) {
        case "release":
          audio.snap();
          towPlane.roped = false;
          say(ev.auto ? "Konec vleku — vypnuto automaticky" : "Vypnuto! Hodně štěstí", { dur: 2.5 });
          btnAction.textContent = "⟳";
          btnAction.classList.remove("tow");
          break;
        case "circleStart":
          btnAction.classList.add("circling");
          break;
        case "circleEnd":
          btnAction.classList.remove("circling");
          if (ev.gained > 60) say("+" + Math.round(ev.gained) + " m ⬆", { color: "#8df0a0", dur: 2 });
          break;
        case "stall":
          say("PŘETAŽENÍ!", { color: "#ff6a50", big: true, dur: 2 });
          audio.thud(false);
          break;
        case "overspeed":
          break;
        case "tooFastCircle":
          say("Na kroužení moc rychle — zpomal pod 160 km/h", { color: "#ffd24a", dur: 2.5 });
          break;
        case "landed":
          audio.thud(!ev.ok);
          setTimeout(finishFlight, ev.ok ? 900 : 1200);
          break;
      }
    }
  }

  // ---------- kontextové tipy ----------
  function contextTips() {
    const g = glider;
    if (g.mode === "free" && !tips.lift && g.vario > 1.0 && g.agl() > 150) {
      tips.lift = true;
      say("Stoupák! MEZERNÍK / ⟳ = kroužit", { color: "#8df0a0", dur: 3.5 });
    }
    if (g.mode !== "tow" && !tips.low && g.agl() < CFG.lowAltWarn && g.agl() > 80) {
      tips.low = true;
      say("Nízko! Vyhlédni si pole a přistávej max. 100 km/h", { color: "#ffd24a", dur: 4 });
    }
    const dayH = CFG.dayStartH + tDay / 3600;
    if (!tips.evening && dayH > 17.8 && g.mode !== "done") {
      tips.evening = true;
      say("Termika slábne — večer už to neponese. Dolétni!", { color: "#ffb060", dur: 4.5 });
    }
  }

  // ---------- vlečná po vypnutí ----------
  function updateTowPlane(dt) {
    if (!towPlane) return;
    if (glider.mode === "tow") {
      towPlane.x = glider.x + 62;
      towPlane.h = glider.towT < CFG.towRollTime
        ? world.elevAt(towPlane.x) + 1.2
        : glider.h + 6;
      towPlane.pitchVis = glider.towT < CFG.towRollTime ? 0 : 0.12;
    } else if (towPlane.gone < 8) {
      towPlane.gone += dt;
      towPlane.x += (CFG.towSpeed + 8) * dt;
      towPlane.h -= 2.2 * dt;   // vlečná klesá pryč
      towPlane.pitchVis = -0.15;
      if (towPlane.gone >= 8) towPlane = null;
    }
  }

  // ---------- smyčka ----------
  let lastT = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) return;

    if (state === "flying" && !paused) {
      readInput(dt);
      tDay += dt * CFG.daySpeed;
      flightTime += dt;
      const dH = CFG.dayStartH + tDay / 3600;
      const events = [];
      glider.update(dt, input, tDay, dH, events);
      input.action = false;
      updateTowPlane(dt);
      handleEvents(events);
      contextTips();
    }

    // vykreslení (i v menu jako pozadí)
    if (world && glider) {
      const dH = CFG.dayStartH + tDay / 3600;
      renderer.draw({
        world, glider, towPlane,
        tDay, dayH: dH, dt,
        msgs,
        distance: glider.x / 1000,
        best,
        muted: audio.muted,
      });
      if (paused && state === "flying") {
        const ctx = renderer.ctx;
        ctx.fillStyle = "rgba(10,30,50,0.5)";
        ctx.fillRect(0, 0, renderer.W, renderer.H);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.font = "800 30px system-ui";
        ctx.fillText("PAUZA", renderer.W / 2, renderer.H / 2);
        ctx.font = "600 15px system-ui";
        ctx.fillText("P = pokračovat", renderer.W / 2, renderer.H / 2 + 34);
      }
      audio.update(dt, {
        vario: glider.vario,
        speed: glider.v,
        flying: state === "flying" && !paused && glider.mode !== "done",
        buffet: glider.buffet && state === "flying" && !paused,
        towing: state === "flying" && !paused && glider.mode === "tow" && !document.hidden,
      });
    } else {
      // statické pozadí menu
      const ctx = renderer.ctx;
      const grd = ctx.createLinearGradient(0, 0, 0, renderer.H);
      grd.addColorStop(0, "#549ad6");
      grd.addColorStop(1, "#bae2f5");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, renderer.W, renderer.H);
    }

    // pročistit staré zprávy
    const nowS = performance.now() / 1000;
    msgs = msgs.filter(m => m.until > nowS - 1);
  }

  // PWA: offline cache (jen přes http/https, z disku service worker nejde)
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  showMenu();
  requestAnimationFrame(frame);
})();
