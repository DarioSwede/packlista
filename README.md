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
tre små ikonknappar (F/B/★) som ligger i namncellen på varje rad, dolda
tills raden hovras eller en av knapparna har tangentbordsfokus (se
`.item-actions`/`.item-action` i `styles.css` och `actionToggle()`/
`itemRow()` i `app.js`). Knapparna är riktiga `<button>`-element hela
tiden — bara `opacity`/`pointer-events` växlar — så Tab-ordningen och
skärmläsare påverkas inte av att de är visuellt gömda. Bokstäverna är
vanlig fet text, inte emoji — 🍴/👕 renderade som oläsliga tofu-glyfer på
system utan ett fullständigt färgemoji-typsnitt (såg det live på Tors
maskin), så F/B/★ används istället (★ är en vanlig, brett stödd
Unicode-symbol, inget emoji). B (inte P, som det hette innan) matchar
första bokstaven i "Bärs".

- **Förbrukas** (F): oförändrad logik, bara flyttad. Fortfarande
  begränsad till Mat/Vatten/Bränsle (`CONSUMABLE_CATEGORIES`), fortfarande
  det som driver viktprognosen.
- **Bärs på kroppen** (B): detta fanns tidigare som en egen tabellkolumn
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

**Direkt uppföljning samma dag:** med Antal/Vikt/Kategori väl
smalnade fanns det plats för alla tre på samma rad, inte bara
Kategori+Antal som förut. `tbody tr` i 700px-brytpunkten gick från en
2-kolumners till en `1fr auto auto`-grid (Kategori får det som blir
över, Antal/Vikt sina egna innehållsbredder) med
`grid-template-areas:"name name name" "category quantity weight" "owned owned weight"`
-- Vikt-cellen spänner över både rad 2 och 3 (vikt-input i rad 2:s del,
Vägd-kryssrutan i rad 3:s del, se `.weight-field`s stapling), och
Har-cellen spänner de två kolumnerna Vägd inte upptar. Ner till 3
synliga rader per pryl (namn, kategori/antal/vikt, har) istället för 3
rader där den tredje bara innehöll två fält.

**Ytterligare en omgång samma dag** landade på 2 rader per pryl:

- **Vikt-fältet** visar `placeholder="gram"` istället för ett bokstavligt
  "0" när vikten är ovägd/oifylld (`weightInput.value = ""` i `itemRow()`
  när `item.weight === 0`) -- en bar nolla var tvetydig, gick inte att
  se om det var en riktig 0-gramspryl eller bara aldrig ifylld.
- **Vägd flyttade tillbaka inline** bredvid vikt-inputen (inte staplad
  under längre) -- `.weight-field{grid-template-columns:auto auto}` i
  700px-brytpunkten. Eftersom Vikt-cellen är radens sista kolumn hamnar
  Vägd-kryssrutan automatiskt längst ut till höger i fältraden, precis
  bredvid vikten den hör ihop med.
- **Har flyttade upp till namnraden** istället för att dela rad med
  fält-blocket -- `grid-template-areas` gick från 3 rader till 2:
  `"name name owned" "category quantity weight"`. Ren CSS-omplacering
  (samma `<td>`, bara ny grid-area), ingen DOM-flytt behövdes eftersom
  Har redan var sin egen tabellcell.

**Bugg samma dag:** fält-raden (Kategori/Antal/Vikt+Vägd) svämmade över
kortets högerkant på smala skärmar -- klassisk CSS Grid-fälla. Kategoris
kolumn var satt till plain `1fr`, men en bar `1fr`-track respekterar
fortfarande sitt innehålls `min-content` som ett implicit golv (här:
`<select>`ens längsta alternativ, "Elektronik", ~110-130px). Lägg ihop
det golvet med Antal/Vikt-kolumnernas egna `auto`-bredder och summan
kunde bli bredare än kortets faktiska innehållsyta, så raden puttade ut
förbi paddingen till höger istället för att krympa. Fixat med
`minmax(0,1fr)` istället för `1fr` på `tbody tr`, plus `min-width:0` på
`td` som allmänt skydd mot samma fälla i andra celler. Verifierat live
i en 360px-bred test-iframe mot produktionssajten innan/efter fixet.

**Samma dag, en runda till:** en skärmdump från en riktig telefon visade
att namnraden (namn + F/B/★/× + Har, alla klämda in i samma grid-area)
faktiskt låg på varandra -- exakt samma sorts bugg som ovan, fast ett
steg djupare: `.item-name-field`s egen inre grid
(`minmax(90px,1fr) auto 22px`) blåste ut sin egen box på samma sätt när
kortets yttre grid gav den mindre bredd än den behövde (namn delade rad
med Har, fick bara 2 av 3 kolumner). Att bara justera pixelbredder ett
varv till hade riskerat att bara flytta samma fälla till nästa enhet
med andra typsnittsmått.

Löst mer grundläggande: hela kortlayouten gick från CSS Grid till
flex-wrap, både i `.item-name-field` och i `tbody tr`. Grid-spår
(`auto`/bar `1fr`) har ett implicit golv och svämmar bara över sin box
om det inte finns plats; flex-wrap kan strukturellt inte göra det --
ett element som inte får plats radbryts till en ny rad istället, så
överlapp är omöjligt by design, inte bara testat okej på en specifik
bredd. `tbody tr` är nu en enda flex-wrap-grupp: Kategori/Antal/
Vikt+Vägd/Har (td 2-5) har `order:0` (DOM-ordning, samma som
skrivbordstabellens kolumnordning), Namnet (td 1) har
`flex-basis:100%` + `order:1` -- tvingar in det på en egen rad *efter*
fältgruppen. Det ger både det Tor bad om (Kategori hamnar överst) och
håller ihop namnets egna F/B/★/×-knappar med namnet (samma cell, egen
rad, tävlar inte om bredd med Har längre). Namnradens avdelarlinje
gick från `border-bottom` till `border-top` eftersom namnet bytte sida
(understa raden nu, inte översta). Verifierat i samma sorts test-iframe
som ovan, ner till 320px bredd (minsta vanliga telefonbredd).

**Fjärde rundan samma dag** -- Tor bad om ett konkret, fast upplägg
istället för att flex-wrap fritt skulle avgöra radbrytningarna:
rad 1 = Kategori + Vikt (Vägd rider med inne i Vikt-cellen, som förut),
rad 2 = Pryl (namn + F/B/★/× rider med i samma cell) + Antal + Har.
Flexbox har ingen inbyggd "tvinga radbrytning här"-mekanism mellan två
syskon-element på samma nivå, så en osynlig `tbody tr::after`-pseudo-
element med `flex-basis:100%` sitter mellan de två gruppernas
`order`-värden (kategori=1, vikt=2, brytare=3, namn=4, antal=5, har=6)
-- ett 100%-brett flex-element kan inte dela rad med något, vilket
tvingar allt som kommer efter det till en ny rad, utan att någon extra
riktig DOM-nod behövs.

Två mindre städningar i samma veva:
- **"gram" borttaget** från Vikt-fältet -- både pseudo-rubriken
  (`data-label` gick från `"Vikt (gram) / Vägd"` till bara `"Vikt"`)
  och placeholder-texten i själva inputen (borttagen helt). Rubriken
  "VIKT" ovanför fältet säger redan vad det är.
- **Har-kryssrutans dubbla text borttagen** -- den hade både
  pseudo-rubriken "HAR" ovanför sig och ordet "Har" bredvid kryssrutan,
  två gånger samma information. Ordet bredvid kryssrutan är borttaget,
  pseudo-rubriken (samma mönster som alla andra fält) räcker.

Verifierat live mot produktionssajten (test-iframe, 375px och 320px)
innan commit.

**Femte rundan samma dag:** Antal flyttat upp till rad 1, mellan
Kategori och Vikt (rad 1 = Kategori/Antal/Vikt+Vägd, rad 2 = Pryl/Har)
-- bara ett `order`-byte (kategori=1, antal=2, vikt=3, brytare=4,
namn=5, har=6). Fick krympa lite till för att alla tre skulle rymmas på
en rad vid 375px istället för att alltid radbrytas: Antal-inputen
56->52px, Vikt-inputen 66->64px, Kategori-selectens `max-width`
130->120px, `column-gap` 10->8px, `.weight-field`s egen gap 6->5px.
Verifierat live att "9999" fortfarande visas i sin helhet (inte
avklippt) i den smalare Vikt-inputen -- testat mot Chrome-renderad
sifferstegrare (worst case), som Tors faktiska iOS Safari inte ens
visar, så marginalen är i praktiken större på riktiga enheten.

**Sjätte rundan samma dag -- den faktiska överlappsbuggen hittad:** en
skärmdump från Tors riktiga telefon visade Antal-fältet liggande
ovanpå Kategori-fältet. Mätte upp exakt varför direkt mot
produktionssajten (samma test-iframe-teknik, men den här gången med
`getBoundingClientRect()` istället för bara ögonmått): Kategori-cellens
`<select>` hade `max-width:120px` satt som ett fast pixelvärde, men en
`<select>` med `width:auto` storleksätter sig efter sitt *bredaste
alternativ* (oavsett vilket som råkar vara valt) -- helt oberoende av
hur brett flex-layouten faktiskt gav dess `<td>` (uppmätt till 101px).
Selecten renderade alltså 120px brett i en 101px-cell och blödde ~11px
rakt in i Antal-cellen bredvid. `max-width:100%` istället för ett
gissat pixeltal löser det category-överskridande generellt -- selecten
kan aldrig bli bredare än sin faktiska container oavsett vad flexboxen
landar på, så överlapp är strukturellt omöjligt nu (precis som
tbody tr::after-tricket gör för hela raderna). Om ett långt
kategorinamn inte får plats klipps texten av med "..." istället --
verifierat mätt för både kortaste ("Bo") och längsta ("Elektronik")
kategorin, båda 0px överlapp.

Passade också på att dra åt höjdledens luft en aning: `row-gap` 8->6px,
namnradens `padding-top` (ovanför avdelarlinjen) 8->5px -- de två
lades ihop till mer luft än nödvändigt när radbrytningen mellan
fält-raden och namnraden redan sköts av `tbody tr::after`-tricket.

**Sjunde rundan samma dag:** `max-width:100%` löste överlappet men gav
Kategori bara "vad som blev över" efter Antal/Vikts fasta pixelbredder
-- för smalt för längre namn ("Bränsle"/"Elektronik" klipptes ner till
bara ikonen + "..."). Tor bad om explicita proportioner istället:
40/25/25/10 för Kategori/Antal/Vikt/Vägd. Bytte de fasta bredderna mot
`flex-grow`-kvoter med `flex-basis:0` (`flex:40 0 0` osv.) på
`tbody tr`s tre fält-`td`, och Kategori-selecten/Antal-Vikt-inputen
till `width:100%` av sin `td` istället för ett pixeltal -- samma
`max-width:100%`-princip som löste överlappet, bara nu med en
garanterad, förutsägbar andel av raden istället för restposten. Vikt
(25) och Vägd (10) delar sin gemensamma `td` (35% totalt) 5:2 via
samma teknik i `.weight-field`s `grid-template-columns`. Verifierat
`getBoundingClientRect()` mot produktionssajten för både kortaste
("Bo") och längsta ("Elektronik") kategorinamnet -- 0px överlapp i
båda, och "Bränsle"/"Elektronik" visas nu i sin helhet istället för
"...".

**Åttonde rundan samma dag:** två sista finjusteringar.

- **Vägds text flyttade från bredvid till ovanför sin kryssruta** --
  läser nu som en fjärde rubrik i samma rad som Kategori/Antal/Vikt
  istället för en lös bisats till höger. `.weight-field .weighed-check`
  fick samma typografi som `td[data-label]::before` (10px, versaler,
  bokstavsmellanrum) och `flex-direction:column-reverse` -- DOM-
  ordningen i `itemRow()` är fortfarande kryssruta-sedan-text (det
  ordningen skrivbordsvyn vill ha), så `column-reverse` visar bara sista
  barnet (texten) först utan att `app.js` behövde ändras.
- **Har-knappen flyttade till namnraden, direkt efter radera** --
  `td:nth-child(1)` (namncellen) gick från `flex:1 1 90px` (växte för
  att fylla hela rad 2, vilket sköt Har hela vägen till radens
  högerkant) till `flex:0 1 auto` (krymper till sitt eget innehålls
  bredd). Eftersom Har (`order:6`) redan låg direkt efter namnet
  (`order:5`) i ordning räckte det -- de hamnar nu sida vid sida med
  bara den vanliga kolumnmellanrummet (8px) emellan, verifierat mätt.
  Texten "Har" är tillbaka bredvid kryssrutan (till vänster om den,
  läsordning), men bara på mobil -- ett nytt generiskt
  `.mobile-only-text`-hjälpklass (`display:none` som grundläge, `inline`
  i 700px-brytpunkten) håller den borta på skrivbordet, som redan har en
  egen `<th>Har</th>`-kolumnrubrik och inte behöver ordet upprepat i
  varje cell. Den gamla "HAR"-pseudo-rubriken (`::before`) är dold för
  den här cellen nu istället, för att inte visa samma ord två gånger
  igen.

**Nionde rundan samma dag:** column-reverse-varianten av Vägd-headern
var bara en approximation -- den satt nära men inte exakt i linje med
Kategori/Antal/Vikt, eftersom Vägds kryssruta levde en nivå djupare
(inne i `.weight-field`) än de andras egna `<td>`-element. Byggde om
strukturellt istället för att finjustera pixlar: Vikt-inputen och
Vägd-kryssrutan fick varsin `<div>`-wrapper i `itemRow()`
(`.weight-input-wrap` / `.vagd-wrap`), var och en med sitt eget
`data-label`. Den generiska pseudo-header-regeln gick från
`td[data-label]::before` till `[data-label]::before` (vilken elementtyp
som helst, inte bara `<td>`), så båda de nya wrapper-`div`arna får
samma `::before`-rubrik som Kategori/Antal-cellerna -- exakt samma
mekanism, inte en efterhandskonstruktion. `.weight-field`s
`align-items` gick från `end` till `start` eftersom båda kolumnerna nu
bygger sin egen rubrik-ovanför-fält-stapel och ska linjera upptill, som
Kategori/Antal gör. Den gamla inline-texten bredvid kryssrutan
(`.weighed-check-label`) lever kvar för skrivbordsvyn, bara dold på
mobil nu (`display:none` i 700px-brytpunkten) eftersom `vagd-wrap`s
pseudo-header säger samma sak.

Verifierat mätt (`getBoundingClientRect()` på Kategori-cellen och den
nya `.vagd-wrap`, mot en DOM-patchad kopia av produktionssajten) --
`diff: 0` i vertikal position, pixel-perfekt samma rad.
