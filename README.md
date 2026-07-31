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
