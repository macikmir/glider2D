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
  const elTouchLeft = document.getElementById("touchleft");
  const btnAction = document.getElementById("btnAction");
  const btnWatch = document.getElementById("btnWatch");
  const elBest = document.getElementById("bestline");

  // Simulátor hodinek GlideMate. Kluzák mezitím letí na trim — máš ruce na
  // hodinkách, ne na kniplu, což je zrovna ta situace, kterou má smysl zkoušet.
  const watch = new WatchDevice();
  let qnhActual = 1013;         // skutečné QNH dne; hodinky ho neznají

  // Klávesy na pět tlačítek Instinctu. Podržené UP dělá MENU (řeší watch.js).
  const WATCH_KEYS = {
    ArrowUp: "UP", KeyW: "UP",
    ArrowDown: "DOWN", KeyS: "DOWN",
    Enter: "GPS", Space: "GPS",
    Escape: "SET", Backspace: "SET",
    Digit0: "SIM",
  };

  let state = "menu";           // menu | flying | result
  let world, glider, towPlane;
  let tDay = 0;                 // denní sekundy od startu
  let msgs = [];
  let tips = {};
  let flightTime = 0;
  let paused = false;
  let endTimer = 0;             // odložené zobrazení výsledku po dosednutí
  let pendingReload = false;    // čeká nová verze z service workeru

  // localStorage může být v restriktivním režimu prohlížeče nedostupné
  function loadBest() {
    try { return parseFloat(localStorage.getItem("termika_best") || "0") || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem("termika_best", String(v)); } catch (e) { /* nevadí */ }
  }

  let best = loadBest();

  // ---------- vstupy ----------
  const input = { pitch: 0, nudge: 0, action: false };
  const keys = {};
  let touch = null;             // {id, x0, y0, x, y}
  let watchTouch = null;        // {id, btn} — prst drží tlačítko hodinek

  function setWatch(open) {
    watch.open = open;
    btnWatch.classList.toggle("on", open);
    if (open) { watch.start(); input.action = false; }
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    keys[e.code] = true;
    audio.ensure();

    if (e.code === "KeyT" && state === "flying") {
      e.preventDefault();
      setWatch(!watch.open);
      return;
    }
    // Otevřené hodinky berou svých pět tlačítek; M/P/R zůstávají hře.
    if (watch.open && state === "flying" && WATCH_KEYS[e.code]) {
      e.preventDefault();
      watch.buttonDown(WATCH_KEYS[e.code]);
      return;
    }

    if (e.code === "Space") {
      e.preventDefault();
      if (state === "flying") { if (!paused) input.action = true; }
      else if (state === "menu" && elHelp.classList.contains("hidden")) startFlight();
      else if (state === "result") restart();
    }
    if (e.code === "KeyR" && state !== "menu") restart();
    if (e.code === "KeyM") audio.toggleMute();
    // vstup se při přepnutí pauzy zahodí, ať kluzák po odpauzování neskočí do kruhu
    if (e.code === "KeyP" || e.code === "Escape") {
      if (state === "flying") { paused = !paused; input.action = false; }
    }
    if (e.code === "KeyH") { if (state === "menu") showHelp(true); }
  });
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
    if (watch.open && WATCH_KEYS[e.code]) {
      // BACK na kořenové obrazovce znamená „ukonči aplikaci" — tady zavři panel
      if (!watch.buttonUp(WATCH_KEYS[e.code])) setWatch(false);
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    audio.ensure();
    if (state !== "flying") return;
    // Pauza se na mobilu zapne sama při odchodu z aplikace a klávesa P tam
    // není — bez tohohle by se z rozlétaného letu nedalo dostat ven.
    if (paused) { paused = false; input.action = false; return; }
    // Otevřené hodinky si berou dotyk pro sebe; kluzák zatím letí na trim.
    if (watch.open) {
      const box = renderer.watchBox;
      const b = box && watch.hitTest(e.clientX, e.clientY, box.x, box.y, box.scale);
      if (b) { watchTouch = { id: e.pointerId, btn: b }; watch.buttonDown(b); }
      return;
    }
    if (touch) return;
    touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (touch && e.pointerId === touch.id) { touch.x = e.clientX; touch.y = e.clientY; }
  });
  const endTouch = (e) => {
    if (watchTouch && e.pointerId === watchTouch.id) {
      if (!watch.buttonUp(watchTouch.btn)) setWatch(false);
      watchTouch = null;
      return;
    }
    if (touch && e.pointerId === touch.id) touch = null;
  };
  canvas.addEventListener("pointerup", endTouch);
  canvas.addEventListener("pointercancel", endTouch);

  btnAction.addEventListener("click", () => {
    audio.ensure();
    if (state === "flying" && !paused && !watch.open) input.action = true;
  });

  btnWatch.addEventListener("click", () => {
    audio.ensure();
    if (state === "flying") setWatch(!watch.open);
  });

  document.getElementById("btnStart").addEventListener("click", () => { audio.ensure(); startFlight(); });
  document.getElementById("btnHelp").addEventListener("click", () => showHelp(true));
  document.getElementById("btnHelpClose").addEventListener("click", () => showHelp(false));
  document.getElementById("btnAgain").addEventListener("click", restart);
  document.getElementById("btnMenu").addEventListener("click", () => {
    elResult.classList.add("hidden");
    showMenu();
  });

  window.addEventListener("resize", () => renderer.resize());
  document.addEventListener("visibilitychange", () => { if (document.hidden && state === "flying") paused = true; });

  const isTouchDevice = matchMedia("(pointer: coarse)").matches;

  function readInput(dt) {
    // S hodinkami v ruce kluzák letí na trim — ruce jsou na tlačítkách.
    if (watch.open) {
      input.pitch += (0 - input.pitch) * Math.min(dt * 7, 1);
      input.nudge = 0;
      return;
    }
    // klávesy
    let target = 0;
    if (keys["ArrowUp"] || keys["KeyW"]) target += 1;    // potlačit = zrychlit
    if (keys["ArrowDown"] || keys["KeyS"]) target -= 1;  // přitáhnout = zpomalit
    let nudge = 0;
    if (keys["ArrowLeft"] || keys["KeyA"]) nudge -= 1;
    if (keys["ArrowRight"] || keys["KeyD"]) nudge += 1;

    // dotyk kopíruje knipl (a tedy i klávesy): tažení dolů = přitáhnout
    // (zpomalit), tažení nahoru = potlačit (zrychlit)
    if (touch) {
      const dy = touch.y - touch.y0;   // dolů kladné
      const dx = touch.x - touch.x0;
      target = U.clamp(-dy / 110, -1, 1);
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
    // nová verze dorazila během letu — nový let už začne na aktuálním kódu
    if (pendingReload) { location.reload(); return; }
    // po dosednutí čeká výsledek na timeoutu — restart ho musí zrušit,
    // jinak by se překlopil do už rozletěného nového letu
    clearTimeout(endTimer);
    endTimer = 0;
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
    watchTouch = null;
    setWatch(false);
    // QNH dne. Hodinky ho neznají — dokud si ho nenastavíš, MSL je posunutá
    // (o ~8 m na hPa), zatímco letová hladina sedí vždycky.
    qnhActual = 1006 + Math.floor(Math.random() * 21);
    state = "flying";
    elMenu.classList.add("hidden");
    elResult.classList.add("hidden");
    if (isTouchDevice) { elTouch.classList.add("visible"); elTouchLeft.classList.add("visible"); }
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
    elTouchLeft.classList.remove("visible");
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
    endTimer = 0;
    if (!glider || !glider.result) return;
    state = "result";
    const res = glider.result;
    const dist = glider.x / 1000;
    const V = VERDICTS[res.kind] || VERDICTS.outlanding;

    // vzdálenost se ukáže vždy, ale rekord platí jen při přistání v pořádku
    let newRec = false;
    if (res.ok && dist > best) { best = dist; newRec = true; saveBest(best); }

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
    elTouchLeft.classList.remove("visible");
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
        case "tooFastCircle":
          say("Na kroužení moc rychle — zpomal pod 160 km/h", { color: "#ffd24a", dur: 2.5 });
          break;
        case "landed":
          audio.thud(!ev.ok);
          setWatch(false);
          endTimer = setTimeout(finishFlight, ev.ok ? 900 : 1200);
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
      towPlane.pitchVis = glider.towT < CFG.towRollTime ? 0 : 0.3;   // odpovídá towClimb
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
      watch.buttonHold(dt);
      watch.sync(world, glider, qnhActual, dt);
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
        touchUI: isTouchDevice,   // HUD nechá dole vpravo místo tlačítku ⟳
        watch,
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
        ctx.fillText(isTouchDevice ? "klepni pro pokračování" : "P = pokračovat",
                     renderer.W / 2, renderer.H / 2 + 34);
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
    // sw.js se aktivuje sám (skipWaiting + clients.claim), jenže tahle stránka
    // už má v paměti starý kód — takže se po převzetí jednou přenačte. Bez
    // toho ukáže iPhone novou verzi až na druhé spuštění.
    // Při úplně první registraci se controller mění taky; tam reload nechceme.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || pendingReload) return;
      pendingReload = true;
      if (state !== "flying") location.reload();   // rozlétaný let nepřerušujeme
    });
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  showMenu();
  requestAnimationFrame(frame);
})();
