# Packlista

En fristående, mobilanpassad packlisteapp på svenska.

- Publik tom testlista som inte sparas.
- Konto med e-post och lösenord.
- En privat, beständig lista per användare.
- Vikt, grundvikt, antal och inköpsstatus.
- Ägarbaserad åtkomst i Supabase.

Publiceras med GitHub Pages på:

https://darioswede.github.io/packlista/

## Anpassad domän (2026-07-31)

`CNAME`-filen i repo-roten kopplar GitHub Pages till
`packlista.utiskogen.se`. DNS sköts hos Loopia (LoopiaDNS, uppgraderat
från gratis LoopiaDomän-kontot som saknade DNS-editor) — en CNAME-post
för subdomänen `packlista` pekar mot `darioswede.github.io`. Domänens
befintliga e-post rörs inte, den låg inte på några poster i samma zon.

`https://darioswede.github.io/packlista/` fortsätter fungera som förut
(GitHub Pages dirigerar den vidare till den anpassade domänen automatiskt
när "Enforce HTTPS" är på).

**Ej gjort ännu:** `emailRedirectTo` i `app.js`s `sign-up`-hantering
pekar fortfarande på `github.io`-adressen. Fungerar fint som den är,
men om den ska bytas till den nya domänen måste den nya URL:en även
läggas till i Supabases Auth-inställningar under "Redirect URLs" —
annars slutar bekräftelselänkar i registreringsmejl fungera.

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

## Sparad-indikering, topp-rutor och kontoinställningar (2026-07-31)

- **Sparad-indikering syns nu även högst upp**, inte bara nere i
  sidopanelen (lätt att missa där, särskilt på mobil där sidopanelen
  hamnar under tabellen). `[data-save-state]` finns nu på två ställen i
  `#planner-template`; `saveState` i `app.js` är inte längre en direkt
  elementreferens utan ett litet objekt med en `set textContent`
  som uppdaterar båda samtidigt, så alla befintliga anrop
  (`saveState.textContent = "…"`) fungerade oförändrat.
- **"Vikt kvar"** är en ny ruta i `.top-stats`, bredvid Målvikt. Visar
  samma mellanskillnad som redan fanns som liten text under
  Målvikt-fältet, bara mer framträdande. Färgas grönt/rött med samma
  `.status-card`-logik som Målvikt-rutan (se förra avsnittet om
  gradient-tonen) — `tintStatusCard()` i `app.js` är den delade
  hjälpfunktionen båda rutorna nu använder.
- **Inköp-rutan är en `<button>`** med `data-view-button="shopping"` nu
  istället för en `<article>` — plockas upp automatiskt av samma
  generiska `[data-view-button]`-koppling som flikarna i sidopanelen
  redan använde, så inget nytt event-lager behövdes.
- **"Inloggad som"** är en ny liten etikett ovanför e-postadressen i
  kontodropdownen (`.dropdown-label`).
- **Kontoinställningar** är en ny modal (`#account-settings-modal`,
  öppnas via en ny knapp i kontodropdownen), tre separata delar:
  - *Byt namn* skriver till `public.users.display_name`. Kräver att
    `supabase/migrations/0024_account_settings.sql` har körts —
    0022 hade av misstag stängt av ALL uppdatering av `users`-tabellen
    (för att stoppa självpåtagen admin-roll via `role`-kolumnen), vilket
    också råkade blockera det här. Migrationen öppnar bara upp
    `display_name`/`updated_at`, `id`/`role` går fortfarande inte att
    ändra från klienten.
  - *Byt lösenord* verifierar det nuvarande lösenordet genom att faktiskt
    logga in med det (`signInWithPassword`) innan
    `supabase.auth.updateUser({password})` anropas — annars byter
    Supabase lösenord utan att bry sig om vad du skrev i "Nuvarande
    lösenord" alls, det fältet skulle annars vara rent kosmetiskt.
  - *Ta bort konto* anropar en ny säkerhets-definer-funktion,
    `public.delete_own_account()` (samma migration 0024). Klienten kan
    inte radera sin egen `auth.users`-rad direkt (den tabellen exponeras
    inte via PostgREST alls), så funktionen kör med ägarens rättigheter
    och tar bort exakt `auth.uid()` — aldrig någon annans rad. Kaskaderar
    automatiskt genom `public.users → packing_lists → packing_items`/
    `templates` via `on delete cascade` från 0020.

**Måste köras i Supabase SQL-editorn innan detta funkar fullt ut:**
`supabase/migrations/0024_account_settings.sql`.

## Mobilkort, finjustering (2026-07-31)

Uppföljning på kortlayouten ovan, efter feedback på hur den såg ut i
praktiken:

- **Antal/Vikt har fått `max`-attribut** (99 respektive 9999) i
  `itemRow()` i `app.js` -- rimliga tak för en enskild packningspryl.
  `field()`s change-hanterare respekterar nu `input.max` när det är satt
  och klipper värdet, så ett inklistrat/inskrivet för högt tal inte
  tyst överskrider fältets bredd. Kategori-selecten fick ingen
  motsvarande hård gräns (den styrs av `categories`-listan, inte av
  användarinmatning) men är CSS-smalnad till innehållets bredd
  (`width:auto;max-width:140px`, dimensionerad för det längsta
  alternativet, "Elektronik").
- **Vägd och Har låg i olika grid-kolumner** i kortlayouten (Vägd inne i
  Vikt-cellen, Har i sin egen cell) -- att linjera dem exakt sida vid
  sida är geometriskt omöjligt när kolumnerna själva ligger bredvid
  varandra. Löst genom att stapla Vikt-fältet ovanför Vägd istället för
  bredvid (`.weight-field{grid-template-columns:1fr}` i 700px-brytpunkten),
  så båda kryssrutorna hamnar vänsterjusterade i respektive cell --
  läses som ett matchat par även om de tekniskt sitter i skilda
  kolumner. Har fick också en synlig textetikett ("Har") i samma
  `.weighed-check`-stil som Vägd; tidigare var den en osynlig kryssruta
  utan text bredvid sig (bara `aria-label`).
- **Radera-knappen (×)** är omstylad till samma fotavtryck som
  Förbrukas/Bärs på kroppen/Favorit-knapparna (22x22px, transparent
  bakgrund, tunn kantlinje) istället för sin tidigare större, distinkta
  röda ruta -- läses nu som en del av samma knapprad, bara i
  varningsfärg. `.item-name-field`s tredje kolumn (`31px` -> `22px`) är
  justerad i samklang. Ett `window.confirm(...)` med prylens namn körs
  nu innan raderingen faktiskt sker, samma mönster som "Ta bort konto"
  i kontoinställningarna.
