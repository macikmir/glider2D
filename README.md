# TERMIKA — 2D plachtařská záchodovka

Arkádový 2D simulátor přeletu na kluzáku pro prohlížeč (desktop i mobil).
Fyzika vychází z reálné rychlostní poláry standardní třídy (~LS4), rozhodování
je to stejné jako v opravdovém plachtění: jakou rychlostí letět, jestli stoupák
vytočit nebo jen houpnout, a kdy raději včas sednout do pole.

## Spuštění

Bez buildu, bez závislostí — stačí otevřít `index.html` v prohlížeči
(funguje i z disku). Zvuk se aktivuje prvním kliknutím/klávesou.

## Na iPhone (jako aplikace)

Hra je **PWA** — po vystavení na HTTPS ji lze nainstalovat na plochu:

1. Zveřejni obsah repozitáře na libovolném HTTPS hostingu
   (GitHub Pages, Cloudflare Pages, Netlify…).
2. Na iPhonu otevři URL v **Safari**.
3. Sdílet (čtvereček se šipkou) → **Přidat na plochu**.

Poběží celoobrazovkově na šířku, offline (service worker `sw.js`),
s vlastní ikonou a bez adresního řádku. **Při změně souborů zvyš verzi
cache v `sw.js`** (`termika-v3` → `v4`) — jinak prohlížeč vůbec nepozná,
že je co stahovat, a iPhone podrží starou verzi.

Novou verzi si hra načte sama: jakmile nový service worker převezme
vládu, stránka se jednou přenačte. Na iPhonu ale kontrola nové verze
proběhne jen při skutečném spuštění, ne když se jen rozmrazí ikona z
přepínače aplikací — takže PWA nejdřív v přepínači zavři.

Pro „opravdovou“ aplikaci v App Storu by bylo potřeba zabalit hru do
WKWebView přes [Capacitor](https://capacitorjs.com) (`npm i @capacitor/core
@capacitor/ios`), Mac s Xcode a Apple Developer účet ($99/rok). Na hraní
pro sebe a kamarády je PWA plnohodnotná a zdarma.

## Ovládání

| Akce | Klávesnice | Dotyk |
|---|---|---|
| potlačit (zrychlit) | ↑ / W | tažení nahoru |
| přitáhnout (zpomalit) | ↓ / S | tažení dolů |
| vypnout vlek / kroužit | mezerník | tlačítko ⟳ |
| centrování v kruhu | ← → / A D | tažení do stran |
| zvuk / pauza / restart | M / P nebo Esc / R | klepnutí ruší pauzu |

Dotyk kopíruje knipl: táhneš prsty k sobě (dolů) = přitažení.
Odchod z aplikace let sám zapauzuje; zpátky do něj se vrátíš klepnutím.

## Herní principy (pro plachtaře)

- **Polára**: min. opadání 0,62 m/s @ 85 km/h, klouzavost ~41 @ 100 km/h,
  VNE 230 km/h (překročení = rozpad). Přetažení pod ~63 km/h.
- **Vário** je TE-kompenzované, s 20s průměrovačem; pípá jak se sluší.
- **MacCready**: šipky ZRYCHLI/ZPOMAL u rychloměru počítají STF z poláry,
  MC se nastavuje automaticky podle posledního vytočeného stoupáku.
  Zpomalení ve stoupání = delfín („houpnutí“) funguje energeticky správně.
- **Termika**: stoupáky mají gaussovský profil, jádro putuje, fouká
  v poryvech a každý stoupák má životní cyklus — kumul roste, zraje
  a rozpadá se (rozpadající se mrak je plochý a šedý, nenese).
  ~18 % stoupáků je „modrých“ (bez mraku). Silné nesou čápy.
- **Denní chod**: den běží 30× rychleji (12:00–20:00 za ~16 minut).
  Odpoledne základna stoupá, večer termika umírá — dolétnout na letiště
  je bonus do statistik, přistání do pole je v pořádku, les/ves/voda ne.
  Do pole max ~100 km/h a s malým klesáním, jinak je z toho kůlnička.
- **Aerovlek** je krátký (~35 s, auto-vypnutí ve 400 m AGL) — jako v reálu
  se předčasně vypnout skoro nevyplatí. Vário ve vleku ukazuje **netto**,
  tedy samotný vzduch, takže když tě vlečná zrovna táhne stoupákem, je to
  vidět a jde toho využít.

Herní kompromis: pracovní pásmo termiky je nižší (základna ~900–1200 m AGL)
a stoupáky/klesáky silnější než průměrná realita, aby jeden herní den dal
několik celých cyklů stoupání + přeskok. Polára a energetika jsou reálné.

## Hodinky GlideMate (⌚ / klávesa T)

V letu se dá vyvolat simulátor hodinek **Garmin Instinct 2** s aplikací
[GlideMate](https://github.com/macikmir/GaFly) — nejbližší letiště, vzdálenost
a výška, se kterou bys nad ně přiletěl. Kluzák zatím letí na trim, protože máš
ruce na tlačítkách, ne na kniplu.

Ovládá se pěti tlačítky na pouzdře (dotykem i klávesami): **UP/DOWN** = ↑↓ nebo
W/S, **GPS** = Enter, **SET** = Esc. Podržené UP otevře menu, jako na zápěstí.
**SET** na první obrazovce aplikaci zavře. Tlačítko **SIM** není součástí
aplikace — simuluje ztrátu GPS, což se na skutečných hodinkách testuje těžko.

Letiště jsou herní, ne z reálné databáze: přístroj, který ukazuje letiště, kam
se v téhle hře nedostaneš, by byl horší než žádný. Skutečné jsou jen identy
a jména. Osa x je trať 070° z LKRK, takže v přímém letu šipka ukazuje
nahoru/dolů — a **v termice se roztočí**, protože kroužení dodá skutečný kurz.

Každý let má svoje **QNH dne** (1006–1026 hPa), které hodinky neznají. Dokud si
ho nenastavíš (GPS → UP/DOWN), je MSL posunutá o ~8 m na hPa — letová hladina
sedí vždycky. Přesně tenhle rozdíl je důvod, proč appka ukazuje obojí zároveň.

Matematika, formátovače i rozvržení jsou portované z Monkey C řádek po řádku,
takže se tu appka dá posuzovat i z hlediska UI/UX. Věrné je rozvržení, chování
tlačítek a zaokrouhlování; věrné **nejsou** tvary písmen (fonty Instinctu nemáme,
dopočítává se šířka referenčních řetězců) a vzhled systémového menu.

Simulátor si zatím vyžádal jednu opravu, která do GaFly teprve patří: tamní
`AirportsView` drží kilometrový práh nejen pro sken databáze, ale i pro už
vybraná letiště, takže vzdálenost stojí 33 s a pak skočí o kilometr — a šipka
po přeletu letiště ještě kilometr ukazuje dopředu. Tady se přepočítává každou
sekundu (čtyři haversiny), sken databáze zůstal na prahu.

## Struktura kódu

```
index.html      – kostra, overlaye (menu, nápověda, výsledek)
css/style.css   – styly UI
js/util.js      – matematika, seedovaný RNG, 1D šum
js/config.js    – všechny herní konstanty (ladí se tady)
js/gm_core.js   – GlideMate: port matematiky a formátovačů z Monkey C
js/gm_ui.js     – GlideMate: obrazovky, vstup, náhrada Dc a WatchUi
js/watch.js     – emulace Instinctu 2 + adaptér herního světa na appku
js/audio.js     – WebAudio: vário, vítr, motor vlečné, události
js/world.js     – generovaný terén (pole/les/ves/jezero/letiště),
                  termika s životním cyklem, vzduchová hmota
js/glider.js    – fyzika kluzáku, kroužení, vlek, dosednutí
js/render.js    – kamera, obloha, mraky, terén, kluzák, HUD
js/main.js      – herní smyčka, vstupy, stavy, UI
```

Skóre (km) se ukládá do `localStorage`. Svět je nekonečný, generuje se
líně po segmentech; seed je náhodný pro každý let.
