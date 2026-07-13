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
s vlastní ikonou a bez adresního řádku. Při změně souborů zvyš verzi
cache v `sw.js` (`termika-v1` → `v2`), jinak iPhone podrží starou verzi.

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
| centrování v kruhu | ← → | tažení do stran |
| zvuk / pauza / restart | M / P / R | — |

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
- **Denní chod**: den běží 30× rychleji (13:00–20:00 za ~14 minut).
  Odpoledne základna stoupá, večer termika umírá — dolétnout na letiště
  je bonus do statistik, přistání do pole je v pořádku, les/ves/voda ne.
  Do pole max ~100 km/h a s malým klesáním, jinak je z toho kůlnička.
- **Aerovlek** na startu: vário ukazuje i ve vleku — vypni ve stoupáku
  (auto-vypnutí v 600 m AGL).

Herní kompromis: pracovní pásmo termiky je nižší (základna ~900–1200 m AGL)
a stoupáky/klesáky silnější než průměrná realita, aby jeden herní den dal
několik celých cyklů stoupání + přeskok. Polára a energetika jsou reálné.

## Struktura kódu

```
index.html      – kostra, overlaye (menu, nápověda, výsledek)
css/style.css   – styly UI
js/util.js      – matematika, seedovaný RNG, 1D šum
js/config.js    – všechny herní konstanty (ladí se tady)
js/audio.js     – WebAudio: vário, vítr, motor vlečné, události
js/world.js     – generovaný terén (pole/les/ves/jezero/letiště),
                  termika s životním cyklem, vzduchová hmota
js/glider.js    – fyzika kluzáku, kroužení, vlek, dosednutí
js/render.js    – kamera, obloha, mraky, terén, kluzák, HUD
js/main.js      – herní smyčka, vstupy, stavy, UI
```

Skóre (km) se ukládá do `localStorage`. Svět je nekonečný, generuje se
líně po segmentech; seed je náhodný pro každý let.
