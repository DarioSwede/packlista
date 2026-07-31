# Packlista

En fristående, mobilanpassad packlisteapp på svenska.

- Publik tom testlista som inte sparas.
- Konto med e-post och lösenord.
- En privat, beständig lista per användare.
- Vikt, grundvikt, antal och inköpsstatus.
- Ägarbaserad åtkomst i Supabase.

Publiceras med GitHub Pages på:

https://darioswede.github.io/packlista/

## Header (2026-07-31)

`site-header` (utloggad) och `app-header` (inloggad) i `index.html` har
varsin `.header-actions`-grupp med två dropdowns, generiskt drivna av
`initDropdowns()` i `app.js` via `[data-dropdown]`/`[data-dropdown-panel]`
— samma öppna/stäng-logik oavsett vilken:

- **Kugghjulet** (`#settings-toggle-guest` / `#settings-toggle-app`) öppnar
  inställningspanelen: enhetssystem (metriskt/US, bara vikt — appen mäter
  aldrig volym) och radtäthet (bekväm/kompakt). Sparas i `localStorage`
  under `packlista-prefs`, per webbläsare, inte per konto — gäller även
  gästläget som inte har något konto att spara mot.
- **Kontoavataren** (`#account-toggle`, bara inloggad vy) samlar det som
  förut låg som platta knappar direkt i headern: e-postadress, YubiKey-
  status/registrering, logga ut.

`formatWeight()` i `app.js` (tidigare `kg()`) respekterar
enhetsinställningen för alla summerade/beräknade vikter (totalvikt,
grundvikt, prognos, utskrift, målvikt). Vikten per pryl (kolumnen
"Vikt (gram)") är avsiktligt kvar i gram oavsett enhetsval — det är vad
man faktiskt väger på en köksvåg med, oavsett om resten av appen visar
kg eller lb. Målvikts-fältet är det enda redigerbara vikt-fältet som
konverteras (kg lagras internt precis som förut, se `kgToDisplayUnit`/
`displayUnitToKg`).

`.top-stats` (Startvikt/Grundvikt/Vägda/Inköp) låg tidigare `transform:
translateY(-18px)` uppe i `.planner-content`, för att flyta ovanpå kanten
mot headern — det var det som lästes som att texten "hängde" för nära
övergången. Borttaget till förmån för vanlig `padding-top` på
`.planner-content`.

Flera namngivna packlistor och byte av namn på en lista fanns redan sedan
tidigare (`packing_lists`-tabellen, `.list-switcher` i sidopanelen) — inget
nytt här.

## Mörkt/ljust läge (2026-07-31)

Kugghjulsmenyn har fått en tredje inställning, en pill-switch ("Mörkt
läge") bredvid enhet och radtäthet, samma `#theme-toggle-guest` /
`#theme-toggle-app`-par-mönster som de andra kontrollerna.

Hela paletten i `styles.css` var innan detta en enda uppsättning
hårdkodade hex-färger direkt i varje regel. De är nu samlade till namngivna
tokens överst i `:root` (`--card`, `--well`, `--hover`, `--accent-soft`,
`--danger-*`, `--status-*`, `--track` m.fl.) så att `html.theme-light`
(sist i filen) kan skriva om hela paletten på ett ställe istället för att
jaga varje regel. Mörkt läge är standard och oförändrat i utseende — det är
bara samma gamla hex-värden flyttade in i tokens.

`prefs.theme` ("dark"/"light") sparas i samma `packlista-prefs`-post i
`localStorage` som enhet/densitet, och `applyTheme()` i `app.js` sätter
klassen `theme-light` på `<html>`. En liten inline-`<script>` i
`index.html`s `<head>` läser samma nyckel direkt ur `localStorage` och
sätter klassen innan sidan ens ritas ut, så en användare med sparat ljust
läge inte ser en blixt av mörkt tema medan `app.js` (en deferred
module-script) laddar.

`.print-sheet` (A4-utskriften) är medvetet inte kopplad till temat — den
renderas alltid vitt papper/svart text oavsett `prefs.theme`, precis som
förut, eftersom det är vad som faktiskt hamnar på papperet.

## Hover-ikoner per pryl (2026-07-31)

`Förbrukas`-kryssrutan (tidigare en egen tabellkolumn) är borttagen.
Den, `Bärs på kroppen` och den nya `Favorit`-flaggan styrs nu istället av
tre små ikonknappar (🍴/👕/★) som ligger i namncellen på varje rad, dolda
tills raden hovras eller en av knapparna har tangentbordsfokus (se
`.item-actions`/`.item-action` i `styles.css` och `actionToggle()`/
`itemRow()` i `app.js`). Knapparna är riktiga `<button>`-element hela
tiden — bara `opacity`/`pointer-events` växlar — så Tab-ordningen och
skärmläsare påverkas inte av att de är visuellt gömda.

- **Förbrukas** (🍴): oförändrad logik, bara flyttad. Fortfarande
  begränsad till Mat/Vatten/Bränsle (`CONSUMABLE_CATEGORIES`), fortfarande
  det som driver viktprognosen.
- **Bärs på kroppen** (👕): detta fanns tidigare som en egen tabellkolumn
  och togs bort i commit `461d61e` ("Remove worn item option"). Samma
  gamla räknelogik är tillbaka i `itemTotal()`: exakt **ett** set av
  prylen räknas bort från packvikten, oavsett `quantity` — tre par
  strumpor i packlistan men ett par på kroppen ⇒ bara två par räknas i
  vikten. `worn`-kolumnen fanns kvar i databasen hela tiden (bara
  hårdkodad till `false` i appen), så ingen ny migration behövdes för den.
- **Favorit** (★): helt ny flagga, ren visuell markering utan koppling
  till viktberäkning eller filtrering. Ny databaskolumn,
  `supabase/migrations/0023_add_favorite_flag.sql` — måste köras i
  Supabas SQL-editor för `packing_items.favorite` innan fältet går att
  spara (annars skriver `rowForSave()` ett värde till en kolumn som inte
  finns).

Kamera-/länk-ikonerna i referensbilden (bild på prylen, köplänk) är
medvetet inte med i detta — separat funktion, tas senare om det blir
aktuellt.
