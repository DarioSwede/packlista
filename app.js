const cfg = window.PACKLISTA_CONFIG;
const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: {
    // Packlista and Tor-dash share an origin and Supabase project. A dedicated
    // storage key keeps their sessions from signing each other in or out.
    storageKey: "packlista-auth-token",
    experimental: { passkey: true },
  },
});

const DEFAULT_CATEGORIES = [
  { id: "ryggsack", name: "Ryggsäck", icon: "🎒", color: "#9dcdf7" },
  { id: "bo", name: "Bo", icon: "⛺", color: "#6ee58c" },
  { id: "sova", name: "Sova", icon: "🛏️", color: "#5faef7" },
  { id: "mat", name: "Mat", icon: "🍲", color: "#f2c95f" },
  { id: "vatten", name: "Vatten", icon: "💧", color: "#60c8f5" },
  { id: "klader", name: "Kläder", icon: "🥾", color: "#cf9aec" },
  { id: "kok", name: "Kök", icon: "🔥", color: "#ff9b57" },
  { id: "elektronik", name: "Elektronik", icon: "🔋", color: "#55d276" },
  { id: "kamera", name: "Kamera", icon: "📷", color: "#77c9ff" },
  { id: "sakerhet", name: "Säkerhet", icon: "🩹", color: "#ef6b6b" },
  { id: "ovrigt", name: "Övrigt", icon: "📦", color: "#a8d4c8" },
  { id: "bransle", name: "Bränsle", icon: "⛽", color: "#d85f67" },
];
const CONSUMABLE_CATEGORIES = new Set(["mat", "vatten", "bransle"]);
const AVATARS = [
  ["backpack", "🎒", "Ryggsäck"], ["tent", "⛺", "Tält"],
  ["boots", "🥾", "Vandringskängor"], ["compass", "🧭", "Kompass"],
  ["mountain", "🏔️", "Fjäll"], ["canoe", "🛶", "Kanot"],
  ["campfire", "🔥", "Lägereld"], ["forest", "🌲", "Skog"],
];
const CATEGORY_ICONS = [
  ["⛺", "Tält"], ["🎒", "Ryggsäck"], ["🥾", "Kängor"], ["🧭", "Kompass"],
  ["🏔️", "Fjäll"], ["🌲", "Skog"], ["🔥", "Eld"], ["🛶", "Kanot"],
  ["🩹", "Sjukvård"], ["🩺", "Hälsa"], ["💊", "Medicin"], ["🧴", "Hygien"],
  ["🪥", "Tandvård"], ["🧼", "Tvål"], ["🧻", "Toalett"], ["🦟", "Insekter"],
  ["🍲", "Mat"], ["🥪", "Matsäck"], ["☕", "Dryck"], ["💧", "Vatten"],
  ["🔥", "Kök"], ["⛽", "Bränsle"], ["🔪", "Verktyg"], ["🧰", "Reparation"],
  ["🔋", "Elektronik"], ["📱", "Telefon"], ["📷", "Kamera"], ["🔦", "Belysning"],
  ["🗺️", "Karta"], ["📡", "Kommunikation"], ["🆘", "Nödsituation"], ["🛟", "Räddning"],
  ["👕", "Kläder"], ["🧤", "Handskar"], ["🧢", "Huvudbonad"], ["🕶️", "Solskydd"],
  ["🛏️", "Sova"], ["🌧️", "Regn"], ["❄️", "Vinter"], ["☀️", "Sol"],
  ["🐕", "Hund"], ["🎣", "Fiske"], ["🚲", "Cykel"], ["🚗", "Transport"],
  ["📄", "Dokument"], ["💰", "Pengar"], ["🎲", "Nöje"], ["📦", "Övrigt"],
];
const avatarSymbol = (key) => AVATARS.find(([value]) => value === key)?.[1] || "🎒";

const $ = (selector, root = document) => root.querySelector(selector);
const uid = () => crypto.randomUUID();

// ---- preferences: unit system (weight only -- this app doesn't track
// volume anywhere) and list density. Per-browser (localStorage), not
// per-account: a display preference like this is reasonable to keep even
// for the unsaved guest demo, and doesn't need to follow you across
// devices the way the actual packing list data does.
const PREFS_KEY = "packlista-prefs";
function loadPrefs() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch { /* ignore malformed/blocked storage */ }
  return {
    unit: stored.unit === "us" ? "us" : "metric",
    density: stored.density === "compact" ? "compact" : "comfortable",
    theme: stored.theme === "light" ? "light" : "dark",
  };
}
let prefs = loadPrefs();
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore malformed/blocked storage */ }
}

// ---- theme (dark/light) -- index.html has a tiny inline script that
// mirrors this same prefs.theme read and applies .theme-light to <html>
// before app.js (a deferred module script) even loads, so there's no
// flash of the wrong theme on reload. This copy re-applies it once app.js
// takes over, and additionally keeps the browser-chrome theme-color meta
// tag in sync so e.g. Android's status bar matches too.
const THEME_COLOR = { dark: "#08140f", light: "#f6f4ee" };
function applyTheme() {
  document.documentElement.classList.toggle("theme-light", prefs.theme === "light");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[prefs.theme]);
}
applyTheme();

const KG_PER_LB = 0.45359237;
const G_PER_LB = KG_PER_LB * 1000;
function weightUnitLabel() { return prefs.unit === "us" ? "lb" : "kg"; }
// Item-level weight entry (the "Vikt (gram)" table column) stays in
// grams regardless of unit setting -- grams are the practical unit for
// weighing individual gear on a kitchen scale either way, and converting
// that one field back and forth on every keystroke isn't worth the risk
// of rounding drift. Only the aggregate/summary numbers below (totals,
// forecast, print, target weight) respect the US/metric choice.
function formatWeight(grams) {
  const value = Number(grams) || 0;
  const shown = prefs.unit === "us" ? value / G_PER_LB : value / 1000;
  return `${shown.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${weightUnitLabel()}`;
}
// Target weight is edited directly (a number input, not just displayed),
// so it needs the round-trip: stored internally in kg same as always,
// converted to the displayed unit for the input's value and back to kg
// when read from it.
function kgToDisplayUnit(kgValue) { return prefs.unit === "us" ? kgValue / KG_PER_LB : kgValue; }
function displayUnitToKg(value) { return prefs.unit === "us" ? value * KG_PER_LB : value; }

// Every mounted planner (guest demo, private -- see the two
// createPlanner() calls at the bottom of this file) registers its own
// applyPrefs() here so a settings-dropdown change can refresh whichever
// of them currently exist, without either needing to know about the
// other. A stale entry from an instance that's since been replaced (see
// createPlanner's onAuthStateChange handling) is harmless: it just
// touches detached, invisible DOM.
const plannerRefreshers = new Set();
function refreshAllPlanners() {
  plannerRefreshers.forEach((refresh) => refresh());
}

function createPlanner(container, { session = null } = {}) {
  const root = document.importNode($("#planner-template").content, true).firstElementChild;
  container.replaceChildren(root);

  let listId = null;
  let items = [];
  let categories = DEFAULT_CATEGORIES;
  let pendingCategoryItem = null;
  let editingCategoryId = null;
  let query = "";
  let filter = "alla";
  let tripDays = 6;
  let targetWeightKg = 10;
  let listSettings = {};
  let availableLists = [];
  let canEditList = true;
  let ownsList = true;
  let saveTimer = null;
  let deletedIds = new Set();
  const persistent = Boolean(session);

  const tbody = $("[data-items-body]", root);
  const empty = $("[data-empty]", root);
  // Two [data-save-state] elements exist now -- one tucked in the sidebar
  // (easy to miss, especially with the sidebar collapsed to the bottom on
  // mobile) and one right above .top-stats so the save status is visible
  // without scrolling. This fans every assignment out to both instead of
  // making every call site below know there are two.
  const saveState = {
    set textContent(value) {
      root.querySelectorAll("[data-save-state]").forEach((el) => { el.textContent = value; });
    },
  };
  const filterSelect = $("[data-category-filter]", root);
  const shoppingList = $("[data-shopping-list]", root);
  const shoppingEmpty = $("[data-shopping-empty]", root);
  const printBody = $("[data-print-body]", root);
  let activeView = "packing";

  function itemTotal(item) {
    // "Bärs på kroppen" (worn): exactly one set is on your body, not in the
    // pack, regardless of how many you're carrying in total -- e.g. 3 pairs
    // of socks packed but one pair worn subtracts 1 from quantity, not all 3.
    const packedQuantity = Math.max(0, item.quantity - (item.worn ? 1 : 0));
    return item.weight * packedQuantity;
  }

  function render() {
    const visible = items.filter((item) => {
      const matchesText = !query || item.name.toLowerCase().includes(query);
      return matchesText && (filter === "alla" || item.category === filter);
    });
    const total = items.reduce((sum, item) => sum + itemTotal(item), 0);
    const consumable = items
      .filter((item) => item.consumable && CONSUMABLE_CATEGORIES.has(item.category))
      .reduce((sum, item) => sum + itemTotal(item), 0);

    $("[data-total]", root).textContent = formatWeight(total);
    $("[data-base]", root).textContent = formatWeight(total - consumable);
    // Missing weight is deliberately independent of the "Kontrollvägd"
    // checkbox. A checked zero-gram row still lacks a usable weight, while
    // an unchecked row with a positive weight does not. This also keeps the
    // summary aligned with the print view's generated "Vikt saknas" note.
    const missingWeightCount = items.filter((item) => Number(item.weight) <= 0).length;
    $("[data-missing-weight]", root).textContent = String(missingWeightCount);
    const missingWeightArticle = $("[data-missing-weight]", root).closest("article");
    missingWeightArticle.classList.toggle("stat-good", missingWeightCount === 0);
    missingWeightArticle.classList.toggle("stat-alert", missingWeightCount > 0);
    const missing = items.filter((item) => !item.owned);
    $("[data-missing]", root).textContent = String(missing.length);
    const shoppingButton = $("[data-missing]", root).closest(".top-stat-button");
    shoppingButton.classList.toggle("stat-good", missing.length === 0);
    shoppingButton.classList.toggle("stat-alert", missing.length > 0);
    $("[data-shopping-badge]", root).textContent = String(missing.length);
    empty.hidden = items.length > 0;
    tbody.replaceChildren(...visible.map(itemRow));
    renderInsights(total, consumable);
    renderTarget(total);
    renderShopping(missing);
    renderPrint(total, total - consumable, missing.length);
  }

  // Shared by the editable Målvikt card and the plain read-only Vikt-kvar
  // card next to it -- both need the same over/under tint (see .status-card
  // in styles.css), just applied to different elements since they're
  // separate boxes in the top-stats row.
  function tintStatusCard(card, difference, targetGrams) {
    card.classList.toggle("over", difference < 0);
    card.classList.toggle("under", difference >= 0);
    // How red the card gets scales with how far over you are, relative to
    // the target itself (packing double your target weight or more maxes
    // it out). Expressed as a color-mix() percentage set via a custom
    // property rather than a fixed class, so it's a smooth gradient
    // instead of a handful of steps.
    if (difference < 0 && targetGrams > 0) {
      const overRatio = Math.min(1, -difference / targetGrams);
      card.style.setProperty("--over-mix", `${Math.round(14 + overRatio * 46)}%`);
    }
  }

  function renderTarget(total) {
    $("[data-target-unit]", root).textContent = weightUnitLabel();
    const targetGrams = targetWeightKg * 1000;
    const difference = targetGrams - total;
    tintStatusCard($("[data-target-card]", root), difference, targetGrams);
    $("[data-target-status]", root).textContent = `${formatWeight(Math.abs(difference))} ${difference < 0 ? "över" : "under"} mål`;

    // Vikt kvar -- the same headroom the Målvikt card's small-text already
    // states, just surfaced as its own prominent top-stats box too (Tor
    // wanted it visible "i toppen" without having to read the fine print
    // under the target-weight input).
    const remainingCard = $("[data-remaining-card]", root);
    tintStatusCard(remainingCard, difference, targetGrams);
    $("[data-remaining-label]", root).textContent = difference < 0 ? "Över mål" : "Vikt kvar";
    $("[data-remaining]", root).textContent = formatWeight(Math.abs(difference));

    // Startvikt and Grundvikt get the same over/under-target tint too --
    // same difference/targetGrams as Målvikt and Vikt kvar, since it's the
    // same underlying "are we within budget" question, just two more
    // places it's shown.
    tintStatusCard($("[data-total-card]", root), difference, targetGrams);
    tintStatusCard($("[data-base-card]", root), difference, targetGrams);
  }

  // Density (see .planner.density-compact in styles.css) and the target-
  // weight input's unit both need to react live to a prefs change, not
  // just at load -- called both at startup and whenever the settings
  // dropdown changes prefs (see plannerRefreshers below).
  function applyDensity() {
    root.classList.toggle("density-compact", prefs.density === "compact");
  }
  function applyTargetWeightUnit() {
    const input = $("[data-target-weight]", root);
    const isUs = prefs.unit === "us";
    input.max = isUs ? "220" : "100";
    input.step = isUs ? "0.5" : "0.1";
    input.value = kgToDisplayUnit(targetWeightKg).toFixed(2);
  }
  function applyPrefs() {
    applyDensity();
    applyTargetWeightUnit();
    render();
  }
  plannerRefreshers.add(applyPrefs);

  function categoryName(id) {
    const category = categories.find((candidate) => candidate.id === id);
    return category ? `${category.icon || ""} ${category.name}`.trim() : "📦 Övrigt";
  }

  function renderInsights(total, consumable) {
    const forecast = $("[data-forecast-chart]", root);
    const endWeight = total - consumable;
    const days = Math.max(1, tripDays);
    const points = Array.from({ length: days }, (_, index) => {
      const usedShare = days === 1 ? 0 : index / (days - 1);
      return total - (consumable * usedShare);
    });
    const width = 560;
    const height = 150;
    const padding = 14;
    const range = Math.max(1, total - endWeight);
    const coords = points.map((weight, index) => {
      const x = days === 1 ? padding : padding + (index / (days - 1)) * (width - padding * 2);
      const y = padding + ((total - weight) / range) * (height - padding * 2);
      return [x, y];
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Viktprognos från ${formatWeight(total)} till ${formatWeight(endWeight)} under ${days} dagar`);
    const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    area.setAttribute("points", `${coords.map((point) => point.join(",")).join(" ")} ${width - padding},${height - padding} ${padding},${height - padding}`);
    area.setAttribute("class", "forecast-area");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", coords.map((point) => point.join(",")).join(" "));
    line.setAttribute("class", "forecast-line");
    svg.append(area, line);
    coords.forEach(([x, y], index) => {
      if (days > 14 && index !== 0 && index !== days - 1) return;
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", x);
      dot.setAttribute("cy", y);
      dot.setAttribute("r", "4");
      dot.setAttribute("class", "forecast-dot");
      svg.append(dot);
    });
    forecast.replaceChildren(svg);
    const summary = $("[data-forecast-summary]", root);
    const summaryValues = [
      ["Startvikt", formatWeight(total)],
      ["Förbrukas", formatWeight(consumable)],
      [`Dag ${days}`, formatWeight(endWeight)],
    ];
    summary.replaceChildren(...summaryValues.map(([label, value]) => {
      const metric = document.createElement("div");
      const caption = document.createElement("span");
      caption.textContent = label;
      const amount = document.createElement("strong");
      amount.textContent = value;
      metric.append(caption, amount);
      return metric;
    }));

    const dayList = $("[data-forecast-days]", root);
    dayList.replaceChildren(...points.map((weight, index) => {
      const day = document.createElement("div");
      if (index === 0) day.classList.add("first");
      if (index === points.length - 1) day.classList.add("last");
      const label = document.createElement("span");
      label.textContent = `Dag ${index + 1}`;
      const amount = document.createElement("strong");
      amount.textContent = formatWeight(weight);
      day.append(label, amount);
      return day;
    }));

    const dailyReduction = days > 1 ? consumable / (days - 1) : 0;
    $("[data-forecast-caption]", root).textContent = consumable
      ? `${formatWeight(dailyReduction)} lättare per dag från dag 1 till dag ${days}.`
      : `Markera mat, vatten eller bränsle som “Förbrukas” för att se hur vikten minskar.`;

    const grouped = categories.map((category) => ({
      ...category,
      weight: items.filter((item) => item.category === category.id).reduce((sum, item) => sum + itemTotal(item), 0),
    }));
    const maxWeight = Math.max(1, ...grouped.map((category) => category.weight));
    const chart = $("[data-category-chart]", root);
    $("[data-category-empty]", root).hidden = true;
    $("[data-clear-category]", root).hidden = filter === "alla";
    chart.replaceChildren(...grouped.map((category) => {
      const button = document.createElement("button");
      button.className = "category-bar";
      button.classList.toggle("active", filter === category.id);
      button.setAttribute("aria-label", `Visa ${category.name}, ${formatWeight(category.weight)}`);
      const name = document.createElement("span");
      name.textContent = `${category.icon || ""} ${category.name}`.trim();
      const track = document.createElement("i");
      const fill = document.createElement("b");
      fill.style.width = category.weight ? `${(category.weight / maxWeight) * 100}%` : "0";
      fill.style.background = category.color || "var(--green)";
      track.append(fill);
      const weight = document.createElement("strong");
      weight.textContent = formatWeight(category.weight);
      button.append(name, track, weight);
      button.addEventListener("click", () => {
        filter = filter === category.id ? "alla" : category.id;
        filterSelect.value = filter;
        render();
      });
      return button;
    }));
  }

  function renderShopping(missing) {
    shoppingEmpty.hidden = missing.length > 0;
    shoppingList.replaceChildren(...missing.map((item) => {
      const row = document.createElement("article");
      row.className = "shopping-item";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.setAttribute("aria-label", `Markera ${item.name} som inköpt`);
      check.addEventListener("change", () => {
        item.owned = true;
        scheduleSave();
        render();
      });
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = item.name;
      const meta = document.createElement("span");
      meta.textContent = `${categoryName(item.category)} · ${item.quantity} st · ${item.weight || 0} g`;
      info.append(name, meta);
      const note = document.createElement("textarea");
      note.className = "shopping-note";
      note.rows = 2;
      note.maxLength = 500;
      note.placeholder = "Notering, till exempel butik, storlek eller modell…";
      note.value = item.note || "";
      note.setAttribute("aria-label", `Notering för ${item.name || "pryl"}`);
      note.addEventListener("input", () => {
        item.note = note.value;
        scheduleSave();
        renderPrint(
          items.reduce((sum, candidate) => sum + itemTotal(candidate), 0),
          items.reduce((sum, candidate) => sum + itemTotal(candidate), 0)
            - items.filter((candidate) => candidate.consumable && CONSUMABLE_CATEGORIES.has(candidate.category))
              .reduce((sum, candidate) => sum + itemTotal(candidate), 0),
          missing.length,
        );
      });
      const label = document.createElement("label");
      label.append(check, document.createTextNode(" Inköpt"));
      row.append(info, note, label);
      return row;
    }));
  }

  function renderPrint(total, base, missingCount) {
    $("[data-print-title]", root).textContent = $("[data-list-name]", root).value || "Min packlista";
    $("[data-print-total]", root).textContent = formatWeight(total);
    $("[data-print-base]", root).textContent = formatWeight(base);
    $("[data-print-target]", root).textContent = formatWeight(targetWeightKg * 1000);
    $("[data-print-count]", root).textContent = String(items.length);
    $("[data-print-missing]", root).textContent = String(missingCount);
    $("[data-print-empty]", root).hidden = items.length > 0;
    printBody.replaceChildren(...items.map((item) => {
      const row = document.createElement("tr");
      // Older imported rows can carry the literal note even after a real
      // weight has been entered. Treat that phrase as derived UI state:
      // remove it when weight exists, add it when weight is zero, and keep
      // any genuine user note alongside it.
      const legacyMissingWeight = /^vikt saknas i lokal lista\.?$/i;
      const storedNote = legacyMissingWeight.test((item.note || "").trim()) ? "" : (item.note || "").trim();
      const printNote = Number(item.weight) <= 0
        ? `Vikt saknas${storedNote ? ` · ${storedNote}` : ""}`
        : storedNote;
      const values = [
        "☐",
        item.name,
        categoryName(item.category),
        `${item.weight || 0} g`,
        String(item.quantity),
        item.weighed ? "✓" : "",
        item.owned ? printNote : `INKÖP${printNote ? ` · ${printNote}` : ""}`,
      ];
      values.forEach((value) => {
        const cell = row.insertCell();
        cell.textContent = value;
      });
      return row;
    }));
  }

  function showView(view) {
    activeView = view;
    root.querySelectorAll("[data-view]").forEach((panel) => {
      panel.hidden = panel.dataset.view !== activeView;
    });
    root.querySelectorAll("[data-view-button]").forEach((button) => {
      button.classList.toggle("active", button.dataset.viewButton === activeView);
    });
    render();
  }

  function field(type, value, label, change) {
    const input = document.createElement("input");
    input.type = type;
    input.setAttribute("aria-label", label);
    if (type === "checkbox") input.checked = value;
    else input.value = value;
    input.addEventListener("change", () => {
      let out = input.value;
      if (type === "checkbox") {
        out = input.checked;
      } else if (type === "number") {
        out = Math.max(0, Number(input.value) || 0);
        // Respects a max attribute when the call site sets one (e.g. Antal
        // capped at 99, Vikt capped at 9999) so a pasted/typed value can't
        // silently exceed the width the field was sized for -- see itemRow().
        if (input.max !== "") out = Math.min(out, Number(input.max));
      }
      change(out);
      scheduleSave();
      render();
    });
    return input;
  }

  // Small icon toggle used by the hover action row in the name cell (see
  // itemRow below) -- always in the DOM/tab order so keyboard users can
  // Tab to it, just visually hidden until the row is hovered or one of
  // its own buttons has focus (see .item-actions in styles.css).
  function actionToggle(icon, label, checked, onToggle, { disabled = false, title } = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "item-action";
    btn.textContent = icon;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", String(checked));
    btn.classList.toggle("active", checked);
    btn.disabled = disabled;
    btn.title = title || label;
    btn.addEventListener("click", () => {
      onToggle();
      scheduleSave();
      render();
    });
    return btn;
  }

  function itemRow(item) {
    const row = document.createElement("tr");
    const nameCell = row.insertCell();
    const nameWrap = document.createElement("div");
    nameWrap.className = "item-name-field";
    const categoryIcon = document.createElement("span");
    categoryIcon.className = "item-category-icon";
    categoryIcon.setAttribute("aria-hidden", "true");
    categoryIcon.textContent = categories.find((category) => category.id === item.category)?.icon || "📦";
    nameWrap.append(categoryIcon, field("text", item.name, "Artikel", (value) => item.name = value));

    // Hover/focus-reveal row for the three per-item flags that used to be
    // (or, for favorite, could only ever have been) dedicated table
    // columns. Consumable's category restriction and worn's "one set off
    // the pack weight" behavior are unchanged from before, just moved from
    // a checkbox column to here -- see itemTotal() for the worn math.
    const consumableAllowed = CONSUMABLE_CATEGORIES.has(item.category);
    const actions = document.createElement("div");
    actions.className = "item-actions";
    actions.append(
      // Plain bold letter, not an emoji, on purpose -- 🍴 (fork and knife)
      // renders as unreadable tofu/fallback glyphs on systems without a
      // full color-emoji font (seen live on Tor's machine as a "‖"-looking
      // shape). "F"/"B"/★ below all render identically everywhere since
      // they're either plain text or an old, widely-supported symbol.
      // "B" (not "P") matches the first letter of "Bärs", the word the
      // label/tooltip actually leads with.
      actionToggle("F", "Förbrukas", item.consumable, () => { item.consumable = !item.consumable; }, {
        disabled: !consumableAllowed,
        title: !consumableAllowed
          ? "Förbrukning kan endast användas för Mat, Vatten och Bränsle."
          : item.consumable
            ? "Förbrukas -- vikten minskar jämnt över turens valda antal dagar. Klicka för att avmarkera."
            : "Markera som förbrukas (mat, vatten, bränsle).",
      }),
      actionToggle("B", "Bärs på kroppen", item.worn, () => { item.worn = !item.worn; }, {
        title: item.worn
          ? "Bärs på kroppen -- ett set räknas inte i packvikten. Klicka för att avmarkera."
          : "Markera om ett set av den här prylen bärs på kroppen istället för i packningen.",
      }),
      actionToggle("★", "Favorit", item.favorite, () => { item.favorite = !item.favorite; }, {
        title: item.favorite ? "Favorit -- klicka för att avmarkera." : "Markera som favorit.",
      }),
    );

    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Ta bort prylen";
    remove.setAttribute("aria-label", `Ta bort ${item.name || "pryl"}`);
    remove.addEventListener("click", () => {
      if (!window.confirm(`Ta bort "${item.name || "prylen"}"?`)) return;
      deletedIds.add(item.id);
      items = items.filter((candidate) => candidate.id !== item.id);
      scheduleSave();
      render();
    });
    nameWrap.append(actions, remove);
    nameCell.append(nameWrap);

    const categoryCell = row.insertCell();
    categoryCell.dataset.label = "Kategori";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Kategori");
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = `${category.icon || ""} ${category.name}`.trim();
      option.selected = item.category === category.id;
      select.append(option);
    });
    const addCategoryOption = document.createElement("option");
    addCategoryOption.value = "__new_category__";
    addCategoryOption.textContent = "＋ Ny kategori…";
    select.append(addCategoryOption);
    select.addEventListener("change", () => {
      if (select.value === "__new_category__") {
        select.value = item.category;
        pendingCategoryItem = item;
        openCategoryModal();
        return;
      }
      item.category = select.value;
      if (!CONSUMABLE_CATEGORIES.has(item.category)) item.consumable = false;
      scheduleSave();
      render();
    });
    categoryCell.append(select);

    const weightCell = row.insertCell();
    const weightField = document.createElement("div");
    weightField.className = "weight-field";
    // Vikt and Vägd each get their own wrapper with its own data-label,
    // instead of one data-label on weightCell covering both -- that was
    // one ::before floating above the whole pair, which couldn't line up
    // with Vägd specifically since Vägd sits in its own grid column
    // below (see .weight-field's 5fr/2fr split in styles.css). Two
    // wrappers means two independent [data-label]::before headers, each
    // sitting directly above its own column's content, so Vikt and Vägd
    // end up on the exact same header line as Kategori/Antal -- not an
    // approximation via flex tricks.
    const weightInputWrap = document.createElement("div");
    weightInputWrap.className = "weight-input-wrap";
    weightInputWrap.dataset.label = "Vikt";
    const weightInput = field("number", item.weight, "Vikt i gram", (value) => item.weight = value);
    // 9999 g (~10 kg) is comfortably past anything one packing item weighs
    // on its own -- capping it lets the mobile card give this field a
    // fixed, narrow width instead of the full-width default (see .weight-field
    // in styles.css's 700px breakpoint).
    weightInput.max = "9999";
    // Show the box empty instead of a literal "0" for an unset weight --
    // a bare 0 read as ambiguous (a genuine zero-gram item vs. just never
    // filled in yet). No placeholder text either now (dropped "gram" --
    // the "VIKT" pseudo-heading above the field already says what it is,
    // no need to repeat the unit inside the box too).
    if (item.weight === 0) weightInput.value = "";
    weightInputWrap.append(weightInput);
    weightField.append(weightInputWrap);
    const vagdWrap = document.createElement("div");
    vagdWrap.className = "vagd-wrap";
    vagdWrap.dataset.label = "Vägd";
    const weighedLabel = document.createElement("label");
    weighedLabel.className = "weighed-check";
    weighedLabel.title = "Markera när vikten har kontrollerats på en våg.";
    // Text still lives inline next to the checkbox too (desktop keeps
    // this exact look, unchanged) -- .weighed-check-label hides it on
    // mobile only, where the "VÄGD" pseudo-heading above (from
    // vagdWrap's data-label) says it instead, so it isn't shown twice.
    const weighedText = document.createElement("span");
    weighedText.className = "weighed-check-label";
    weighedText.textContent = "Vägd";
    weighedLabel.append(
      field("checkbox", item.weighed, "Kontrollvägd", (value) => item.weighed = value),
      weighedText,
    );
    vagdWrap.append(weighedLabel);
    weightField.append(vagdWrap);
    weightCell.append(weightField);
    const quantityCell = row.insertCell();
    quantityCell.dataset.label = "Antal";
    const quantityInput = field("number", item.quantity, "Antal", (value) => item.quantity = value);
    // 99 st is far past any realistic packing-item count -- caps the field
    // so the mobile card can size it narrow and fixed (see td[data-label="Antal"]
    // in styles.css's 700px breakpoint).
    quantityInput.max = "99";
    quantityCell.append(quantityInput);
    const ownedCell = row.insertCell();
    ownedCell.dataset.label = "Har";
    // "Har" as a real element (not a bare text node) so the mobile
    // stylesheet can show it -- desktop already has a <th>Har</th>
    // column header, so a second "Har" inside every cell would just be
    // clutter there; .mobile-only-text hides it above the 700px
    // breakpoint (see styles.css). Text comes before the checkbox (not
    // after, like Vägd) since on mobile this cell sits right next to the
    // delete button on the name row, reading left-to-right as a label
    // for what follows.
    const ownedLabel = document.createElement("label");
    ownedLabel.className = "weighed-check";
    const ownedText = document.createElement("span");
    ownedText.className = "mobile-only-text";
    ownedText.textContent = "Har";
    ownedLabel.append(
      ownedText,
      field("checkbox", item.owned, "Jag har prylen", (value) => item.owned = value),
    );
    ownedCell.append(ownedLabel);

    if (!canEditList) row.querySelectorAll("input,select,button").forEach((control) => { control.disabled = true; });
    return row;
  }

  function addItem() {
    filter = "alla";
    query = "";
    filterSelect.value = "alla";
    $("[data-search]", root).value = "";
    items.push({
      id: uid(), name: "", category: "ovrigt", weight: 0, quantity: 1,
      owned: false, consumable: false, worn: false, favorite: false, weighed: false, note: "",
    });
    scheduleSave();
    render();
    requestAnimationFrame(() => {
      const nameFields = root.querySelectorAll('[data-items-body] input[aria-label="Artikel"]');
      const newest = nameFields[nameFields.length - 1];
      if (newest) {
        newest.focus();
        newest.select();
      }
    });
  }

  function rowForSave(item, index) {
    return {
      packing_list_id: listId,
      user_id: session.user.id,
      client_id: item.id,
      name: item.name,
      category: item.category,
      weight: Math.round(item.weight),
      quantity: Math.round(item.quantity),
      owned: item.owned,
      consumable: item.consumable,
      worn: item.worn,
      favorite: item.favorite,
      weighed: item.weighed,
      note: item.note,
      sort_order: index,
      updated_at: new Date().toISOString(),
    };
  }

  function scheduleSave() {
    if (!persistent) {
      saveState.textContent = "Testläge · sparas inte";
      return;
    }
    if (!canEditList) {
      saveState.textContent = "Delad med visningsbehörighet";
      return;
    }
    saveState.textContent = "Sparar…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }

  async function save() {
    const rows = items.map(rowForSave);
    listSettings = { ...listSettings, tripDays, targetWeightKg };
    const listName = $("[data-list-name]", root).value.trim() || "Min packlista";
    const listResult = await supabase.from("packing_lists")
      .update({ name: listName, settings: listSettings, updated_at: new Date().toISOString() })
      .eq("id", listId);
    let error = listResult.error;
    if (!error && rows.length) {
      const result = await supabase.from("packing_items")
        .upsert(rows, { onConflict: "packing_list_id,client_id" });
      error = result.error;
    }
    const removed = [...deletedIds];
    if (!error && removed.length) {
      const result = await supabase.from("packing_items").delete()
        .eq("packing_list_id", listId)
        .in("client_id", removed);
      error = result.error;
    }
    if (!error) deletedIds.clear();
    const selectedList = availableLists.find((list) => list.id === listId);
    if (!error && selectedList) {
      selectedList.name = listName;
      renderListSwitcher();
    }
    if (error) console.error("Packlista: kunde inte spara", error);
    saveState.textContent = error?.code === "23505"
      ? "Namnet används redan · välj ett unikt namn"
      // Includes the raw Supabase error message (e.g. "column favorite does
      // not exist") so a save failure is diagnosable from the UI alone,
      // without needing devtools open -- see README's "Kunde inte spara"
      // troubleshooting note.
      : error ? `Kunde inte spara: ${error.message || error.code || "okänt fel"}` : "Sparad ✓";
  }

  function mergedCategories(stored = []) {
    const defaults = DEFAULT_CATEGORIES.map((fallback) => {
      const match = stored.find((category) => category.id === fallback.id);
      return {
        ...fallback,
        ...match,
        icon: match?.icon || fallback.icon,
        color: match?.color || fallback.color,
      };
    });
    const defaultIds = new Set(DEFAULT_CATEGORIES.map((category) => category.id));
    const custom = stored.filter((category) => !defaultIds.has(category.id)).map((category) => ({
      id: String(category.id),
      name: String(category.name || "Egen kategori"),
      icon: String(category.icon || "📦"),
      color: String(category.color || "#2f934d"),
    }));
    return [...defaults, ...custom];
  }

  function renderListSwitcher() {
    const select = $("[data-list-select]", root);
    select.replaceChildren(...availableLists.map((list) => {
      const option = document.createElement("option");
      option.value = list.id;
      option.textContent = `${list.user_id === session?.user.id ? "" : "Delad · "}${list.name}`;
      option.selected = list.id === listId;
      return option;
    }));
    const deleteButton = $("[data-delete-list]", root);
    deleteButton.hidden = !ownsList;
    deleteButton.disabled = ownsList && availableLists.filter((list) => list.user_id === session?.user.id).length <= 1;
    deleteButton.title = deleteButton.disabled
      ? "Skapa en ny lista innan du tar bort den sista."
      : "Ta bort vald packlista";
  }

  async function openList(list) {
    listId = list.id;
    ownsList = !persistent || list.user_id === session.user.id;
    canEditList = ownsList;
    if (persistent && !ownsList) {
      const membership = await supabase.from("packing_list_members")
        .select("access_level").eq("packing_list_id", listId).eq("user_id", session.user.id).maybeSingle();
      if (membership.error) throw membership.error;
      canEditList = membership.data?.access_level === "editor";
    }
    categories = mergedCategories(userCategories);
    listSettings = list.settings || {};
    tripDays = Math.max(1, Number(listSettings.tripDays) || 6);
    targetWeightKg = Math.max(0, Number(listSettings.targetWeightKg) || 10);
    root.querySelectorAll("[data-trip-days]").forEach((input) => input.value = String(tripDays));
    applyTargetWeightUnit();
    $("[data-list-name]", root).value = list.name;
    $("[data-list-name]", root).disabled = !canEditList;
    $("[data-add]", root).disabled = !canEditList;
    $("[data-empty-add]", root).disabled = !canEditList;
    $("[data-share-list]", root).hidden = !ownsList;
    $("[data-manage-categories]", root).disabled = !canEditList;
    filter = "alla";
    query = "";
    $("[data-search]", root).value = "";
    deletedIds.clear();

    const stored = await supabase.from("packing_items")
      .select("client_id,name,category,weight,quantity,owned,consumable,worn,favorite,weighed,note")
      .eq("packing_list_id", listId).order("sort_order");
    if (stored.error) throw stored.error;
    items = stored.data.map((item) => ({
      ...item,
      id: item.client_id,
      consumable: item.consumable && CONSUMABLE_CATEGORIES.has(item.category),
    }));
    saveState.textContent = "Sparad ✓";
    renderListSwitcher();
    renderFilters();
    render();
  }

  async function load() {
    applyDensity();
    if (!persistent) {
      categories = mergedCategories();
      saveState.textContent = "Testläge · sparas inte";
      applyTargetWeightUnit();
      renderFilters();
      render();
      return;
    }

    const userId = session.user.id;
    const categoryResult = await supabase.from("user_categories")
      .select("category_key,name,icon,color").eq("user_id", userId).order("created_at");
    if (categoryResult.error) throw categoryResult.error;
    userCategories = categoryResult.data.map((category) => ({
      id: category.category_key,
      name: category.name,
      icon: category.icon,
      color: category.color,
    }));
    const profile = await supabase.from("users").select("id").eq("id", userId).maybeSingle();
    if (profile.error) throw profile.error;
    if (!profile.data) {
      const createdProfile = await supabase.from("users").insert({
        id: userId,
        display_name: session.user.email.split("@")[0],
        updated_at: new Date().toISOString(),
      });
      if (createdProfile.error) throw createdProfile.error;
    }

    const result = await supabase.from("packing_lists")
      .select("id,user_id,name,categories,settings,created_at").order("created_at");
    if (result.error) throw result.error;
    availableLists = result.data;
    if (!availableLists.length) {
      const created = await supabase.from("packing_lists")
        .insert({ user_id: userId, name: "Min packlista", categories: DEFAULT_CATEGORIES, settings: { tripDays: 6, targetWeightKg: 10 } })
        .select("id,user_id,name,categories,settings,created_at").single();
      if (created.error) throw created.error;
      availableLists = [created.data];
    }
    $("[data-list-switcher]", root).hidden = false;
    $("[data-list-login-hint]", root).hidden = true;
    await openList(availableLists[0]);
  }

  function renderFilters() {
    filterSelect.replaceChildren();
    [["alla", "🌐 Alla kategorier"], ...categories.map((category) => [category.id, `${category.icon || ""} ${category.name}`.trim()])].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      filterSelect.append(option);
    });
  }

  const categoryModal = $("[data-category-modal]", root);
  const categoryMessage = $("[data-category-message]", root);
  const categoryIconInput = $("[data-category-icon]", root);
  const categoryNameInput = $("[data-category-name]", root);
  const categoryColorInput = $("[data-category-color]", root);
  const categorySubmit = $("[data-category-submit]", root);
  const defaultCategoryIds = new Set(DEFAULT_CATEGORIES.map((category) => category.id));
  let userCategories = [];

  function syncIconPicker() {
    $("[data-category-icon-picker]", root).querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.icon === categoryIconInput.value));
    });
  }

  $("[data-category-icon-picker]", root).replaceChildren(...CATEGORY_ICONS.map(([icon, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-icon-option";
    button.dataset.icon = icon;
    button.textContent = icon;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      categoryIconInput.value = icon;
      syncIconPicker();
    });
    return button;
  }));
  categoryIconInput.addEventListener("input", syncIconPicker);

  function startCategoryEdit(category) {
    editingCategoryId = category.id;
    categoryNameInput.value = category.name;
    categoryNameInput.readOnly = defaultCategoryIds.has(category.id);
    categoryIconInput.value = category.icon || "📦";
    categoryColorInput.value = category.color || "#2f934d";
    categorySubmit.textContent = "Spara ändringar";
    syncIconPicker();
    categoryIconInput.focus();
  }

  function renderCategoryManager() {
    const list = $("[data-category-manager-list]", root);
    list.replaceChildren(...categories.map((category) => {
      const row = document.createElement("article");
      const name = document.createElement("span");
      name.textContent = `${category.icon || "📦"} ${category.name}`;
      row.append(name);
      const actions = document.createElement("div");
      actions.className = "category-manager-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "quiet-button";
      edit.textContent = "Byt ikon";
      edit.addEventListener("click", () => startCategoryEdit(category));
      actions.append(edit);
      if (!defaultCategoryIds.has(category.id)) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "quiet-button danger-button";
        remove.textContent = "Ta bort";
        remove.addEventListener("click", async () => {
          if (items.some((item) => item.category === category.id)) {
            categoryMessage.textContent = "Flytta först prylarna från kategorin.";
            return;
          }
          if (persistent) {
            const { error } = await supabase.from("user_categories").delete()
              .eq("user_id", session.user.id).eq("category_key", category.id);
            if (error) {
              categoryMessage.textContent = `Kunde inte ta bort: ${error.message}`;
              return;
            }
          }
          categories = categories.filter((candidate) => candidate.id !== category.id);
          userCategories = userCategories.filter((candidate) => candidate.id !== category.id);
          renderCategoryManager();
          renderFilters();
          render();
          scheduleSave();
          categoryMessage.textContent = "Kategorin är borttagen ✓";
        });
        actions.append(remove);
      }
      row.append(actions);
      return row;
    }));
  }

  function openCategoryModal() {
    if (!canEditList) return;
    categoryMessage.textContent = "";
    editingCategoryId = null;
    categoryNameInput.readOnly = false;
    categoryNameInput.value = "";
    categoryIconInput.value = "🏕️";
    categoryColorInput.value = "#2f934d";
    categorySubmit.textContent = "Lägg till kategori";
    syncIconPicker();
    renderCategoryManager();
    categoryModal.hidden = false;
    $("[data-category-name]", root).focus();
  }
  $("[data-manage-categories]", root).addEventListener("click", openCategoryModal);
  const closeCategoryModal = () => { categoryModal.hidden = true; pendingCategoryItem = null; editingCategoryId = null; };
  $("[data-category-close]", root).addEventListener("click", closeCategoryModal);
  categoryModal.addEventListener("click", (event) => { if (event.target === categoryModal) closeCategoryModal(); });
  $("[data-category-form]", root).addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = categoryNameInput.value.trim();
    if (categories.some((category) => category.id !== editingCategoryId && category.name.toLocaleLowerCase("sv-SE") === name.toLocaleLowerCase("sv-SE"))) {
      categoryMessage.textContent = "Kategorinamnet finns redan.";
      return;
    }
    if (editingCategoryId) {
      const category = categories.find((candidate) => candidate.id === editingCategoryId);
      if (!category) return;
      const updated = {
        ...category,
        name: defaultCategoryIds.has(category.id) ? category.name : name,
        icon: categoryIconInput.value.trim() || "📦",
        color: categoryColorInput.value,
      };
      if (persistent) {
        const { error } = await supabase.from("user_categories").upsert({
          user_id: session.user.id,
          category_key: updated.id,
          name: updated.name,
          icon: updated.icon,
          color: updated.color,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,category_key" });
        if (error) {
          categoryMessage.textContent = `Kunde inte spara ikonen: ${error.message}`;
          return;
        }
      }
      categories = categories.map((candidate) => candidate.id === updated.id ? updated : candidate);
      userCategories = [...userCategories.filter((candidate) => candidate.id !== updated.id), updated];
      editingCategoryId = null;
      categoryNameInput.readOnly = false;
      categoryNameInput.value = "";
      categorySubmit.textContent = "Lägg till kategori";
      renderCategoryManager();
      renderFilters();
      render();
      categoryMessage.textContent = "Ikonen är uppdaterad ✓";
      return;
    }
    const category = {
      id: `egen-${uid()}`,
      name,
      icon: categoryIconInput.value.trim() || "📦",
      color: categoryColorInput.value,
    };
    if (persistent) {
      const { error } = await supabase.from("user_categories").insert({
        user_id: session.user.id,
        category_key: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
      });
      if (error) {
        categoryMessage.textContent = `Kunde inte spara kategorin: ${error.message}`;
        return;
      }
    }
    userCategories.push(category);
    categories.push(category);
    if (pendingCategoryItem) pendingCategoryItem.category = category.id;
    categoryNameInput.value = "";
    renderCategoryManager();
    renderFilters();
    render();
    scheduleSave();
    categoryMessage.textContent = "Kategorin är tillagd ✓";
    if (pendingCategoryItem) {
      pendingCategoryItem = null;
      categoryModal.hidden = true;
    }
  });

  const shareModal = $("[data-share-modal]", root);
  const shareMessage = $("[data-share-message]", root);

  async function loadSharing() {
    const [directory, members] = await Promise.all([
      supabase.rpc("list_packlista_directory"),
      supabase.rpc("list_packlista_members", { requested_list_id: listId }),
    ]);
    if (directory.error || members.error) throw directory.error || members.error;
    const memberIds = new Set((members.data || []).map((member) => member.user_id));
    const select = $("[data-share-user]", root);
    select.replaceChildren(...(directory.data || []).filter((user) => !memberIds.has(user.id)).map((user) => {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = `${avatarSymbol(user.avatar_key)} ${user.display_name}`;
      return option;
    }));
    select.disabled = !select.options.length;
    const list = $("[data-share-members]", root);
    list.replaceChildren(...(members.data || []).map((member) => {
      const row = document.createElement("article");
      const identity = document.createElement("span");
      identity.textContent = `${avatarSymbol(member.avatar_key)} ${member.display_name}`;
      const access = document.createElement("small");
      access.textContent = member.access_level === "editor" ? "Kan redigera" : "Kan visa";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "quiet-button danger-button";
      remove.textContent = "Ta bort";
      remove.addEventListener("click", async () => {
        const result = await supabase.rpc("unshare_packlista", {
          requested_list_id: listId,
          target_user_id: member.user_id,
        });
        shareMessage.textContent = result.error ? `Kunde inte ta bort: ${result.error.message}` : "Delningen är borttagen ✓";
        if (!result.error) await loadSharing();
      });
      row.append(identity, access, remove);
      return row;
    }));
  }

  $("[data-share-list]", root).addEventListener("click", async () => {
    if (!ownsList) return;
    shareMessage.textContent = "Hämtar användare…";
    shareModal.hidden = false;
    try {
      await loadSharing();
      shareMessage.textContent = "";
    } catch (error) {
      shareMessage.textContent = `Kunde inte hämta delning: ${error.message}`;
    }
  });
  const closeShareModal = () => { shareModal.hidden = true; };
  $("[data-share-close]", root).addEventListener("click", closeShareModal);
  shareModal.addEventListener("click", (event) => { if (event.target === shareModal) closeShareModal(); });
  $("[data-share-form]", root).addEventListener("submit", async (event) => {
    event.preventDefault();
    const userSelect = $("[data-share-user]", root);
    if (!userSelect.value) return;
    const result = await supabase.rpc("share_packlista", {
      requested_list_id: listId,
      target_user_id: userSelect.value,
      requested_access: $("[data-share-access]", root).value,
    });
    shareMessage.textContent = result.error ? `Kunde inte dela: ${result.error.message}` : "Packlistan är delad ✓";
    if (!result.error) await loadSharing();
  });

  $("[data-add]", root).addEventListener("click", addItem);
  $("[data-empty-add]", root).addEventListener("click", addItem);
  $("[data-shopping-add]", root).addEventListener("click", () => {
    addItem();
    showView("packing");
  });
  $("[data-print]", root).addEventListener("click", () => window.print());
  root.querySelectorAll("[data-view-button]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.viewButton));
  });
  $("[data-search]", root).addEventListener("input", (event) => {
    query = event.target.value.trim().toLowerCase();
    render();
  });
  filterSelect.addEventListener("change", () => {
    filter = filterSelect.value;
    render();
  });
  root.querySelectorAll("[data-trip-days]").forEach((input) => {
    input.addEventListener("input", (event) => {
      tripDays = Math.min(60, Math.max(1, Number(event.target.value) || 1));
      root.querySelectorAll("[data-trip-days]").forEach((other) => other.value = String(tripDays));
      scheduleSave();
      render();
    });
  });
  $("[data-target-weight]", root).addEventListener("input", (event) => {
    const enteredKg = displayUnitToKg(Number(event.target.value) || 0);
    targetWeightKg = Math.min(100, Math.max(0, enteredKg));
    scheduleSave();
    render();
  });
  $("[data-clear-category]", root).addEventListener("click", () => {
    filter = "alla";
    filterSelect.value = filter;
    render();
  });
  $("[data-list-name]", root).addEventListener("change", (event) => {
    event.target.value = event.target.value.trim() || "Min packlista";
    scheduleSave();
    render();
  });
  $("[data-list-select]", root).addEventListener("change", async (event) => {
    const nextId = event.target.value;
    clearTimeout(saveTimer);
    if (listId) await save();
    const next = availableLists.find((list) => list.id === nextId);
    if (next) await openList(next);
  });
  const newListModal = $("[data-new-list-modal]", root);
  const newListName = $("[data-new-list-name]", root);
  const newListDays = $("[data-new-list-days]", root);
  const newListMessage = $("[data-new-list-message]", root);
  const closeNewListModal = () => {
    newListModal.hidden = true;
    newListMessage.textContent = "";
  };

  $("[data-new-list]", root).addEventListener("click", async () => {
    clearTimeout(saveTimer);
    if (listId) await save();
    const usedNames = new Set(availableLists.map((list) => list.name.trim().toLocaleLowerCase("sv-SE")));
    let number = 1;
    let newName = "Ny packlista";
    while (usedNames.has(newName.toLocaleLowerCase("sv-SE"))) {
      number += 1;
      newName = `Ny packlista ${number}`;
    }
    newListName.value = newName;
    newListDays.value = String(tripDays);
    newListMessage.textContent = "";
    newListModal.hidden = false;
    newListName.focus();
    newListName.select();
  });

  $("[data-delete-list]", root).addEventListener("click", async () => {
    if (!persistent || !listId) return;
    const selected = availableLists.find((list) => list.id === listId);
    if (availableLists.length <= 1) {
      saveState.textContent = "Skapa en ny lista innan du tar bort den sista";
      return;
    }
    if (!window.confirm(`Ta bort packlistan "${selected?.name || "Packlista"}" och alla dess prylar?`)) return;
    clearTimeout(saveTimer);
    const result = await supabase.from("packing_lists").delete()
      .eq("id", listId).eq("user_id", session.user.id);
    if (result.error) {
      saveState.textContent = `Kunde inte ta bort listan: ${result.error.message}`;
      return;
    }
    availableLists = availableLists.filter((list) => list.id !== listId);
    await openList(availableLists[0]);
    saveState.textContent = "Packlistan är borttagen";
  });

  $("[data-new-list-cancel]", root).addEventListener("click", closeNewListModal);
  newListModal.addEventListener("click", (event) => {
    if (event.target === newListModal) closeNewListModal();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !newListModal.hidden) closeNewListModal();
  });
  $("[data-new-list-form]", root).addEventListener("submit", async (event) => {
    event.preventDefault();
    const chosenName = newListName.value.trim();
    const chosenDays = Math.min(60, Math.max(1, Number(newListDays.value) || 1));
    const nameExists = availableLists.some((list) =>
      list.name.trim().toLocaleLowerCase("sv-SE") === chosenName.toLocaleLowerCase("sv-SE"));
    if (!chosenName) {
      newListMessage.textContent = "Ange ett namn på listan.";
      newListName.focus();
      return;
    }
    if (nameExists) {
      newListMessage.textContent = "Namnet används redan · välj ett unikt namn.";
      newListName.focus();
      newListName.select();
      return;
    }
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    submitButton.disabled = true;
    newListMessage.textContent = "Skapar listan…";
    const created = await supabase.from("packing_lists")
      .insert({
        user_id: session.user.id,
        name: chosenName,
        categories: DEFAULT_CATEGORIES,
        settings: { tripDays: chosenDays, targetWeightKg: 10 },
      })
      .select("id,user_id,name,categories,settings,created_at").single();
    submitButton.disabled = false;
    if (created.error) {
      newListMessage.textContent = created.error.code === "23505"
        ? "Namnet används redan · välj ett unikt namn."
        : "Kunde inte skapa listan · försök igen.";
      return;
    }
    availableLists.push(created.data);
    closeNewListModal();
    await openList(created.data);
  });

  renderFilters();
  load().catch((error) => {
    console.error(error);
    saveState.textContent = "Kunde inte ladda listan";
  });
}

// Fun one-off, 2026-08-01 -- Tor wanted the pulsing red edge-glow that
// AI computer-use tools flash while remote-controlling a screen. It now
// starts when the login dialog opens, before the user submits the form.
// One overlay element is made once and reused; see
// .control-glow-overlay in styles.css for the actual glow/animation.
const controlGlow = document.createElement("div");
controlGlow.className = "control-glow-overlay";
controlGlow.setAttribute("aria-hidden", "true");
document.body.append(controlGlow);
const flashControlGlow = () => controlGlow.classList.add("active");
const hideControlGlow = () => controlGlow.classList.remove("active");

const modal = $("#login-modal");
const authMessage = $("#auth-message");
const openModal = () => {
  flashControlGlow();
  modal.hidden = false;
  $("#email").focus();
};
const closeModal = () => {
  hideControlGlow();
  modal.hidden = true;
  authMessage.textContent = "";
};

$("#open-login").addEventListener("click", openModal);
$("#close-login").addEventListener("click", closeModal);
modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "Loggar in…";
  const { error } = await supabase.auth.signInWithPassword({
    email: $("#email").value.trim(),
    password: $("#password").value,
  });
  hideControlGlow();
  authMessage.textContent = error ? `Kunde inte logga in: ${error.message}` : "";
});

$("#sign-up").addEventListener("click", async () => {
  if (!$("#auth-form").reportValidity()) return;
  authMessage.textContent = "Skapar konto…";
  const { data, error } = await supabase.auth.signUp({
    email: $("#email").value.trim(),
    password: $("#password").value,
    options: { emailRedirectTo: "https://packlista.utiskogen.se/" },
  });
  authMessage.textContent = error
    ? `Kunde inte skapa konto: ${error.message}`
    : data.session ? "" : "Kontot är skapat. Bekräfta adressen via mejlet du fått.";
});

function passkeyErrorMessage(error) {
  if (error?.message?.includes("RP ID") || error?.message?.includes("relying party")) {
    return "Passkey-domänen är felkonfigurerad. Försök igen efter att sidan har uppdaterats.";
  }
  if (error?.code === "webauthn_credential_not_found") {
    return "Ingen passkey hittades för kontot. Logga in med e-post och välj Registrera passkey.";
  }
  if (error?.code === "passkey_disabled") {
    return "Inloggning med passkey är inte aktiverad.";
  }
  if (error?.name === "NotAllowedError") {
    return "Passkey-flödet avbröts eller enheten svarade inte. Försök igen med biometrik, PIN-kod eller säkerhetsnyckel.";
  }
  return error?.message || "Ett okänt fel inträffade.";
}

$("#passkey-sign-in").addEventListener("click", async () => {
  authMessage.textContent = "Väntar på din passkey…";
  window.focus();
  $("#passkey-sign-in").focus({ preventScroll: true });
  const { error } = await supabase.auth.signInWithPasskey();
  authMessage.textContent = error ? `Kunde inte logga in: ${passkeyErrorMessage(error)}` : "";
});

async function refreshPasskeyStatus() {
  const status = $("#passkey-status");
  const button = $("#register-passkey");
  const { data, error } = await supabase.auth.passkey.list();
  if (error) {
    status.textContent = "";
    button.textContent = "Registrera passkey";
    return;
  }
  const count = data?.length || 0;
  status.textContent = count ? `Passkey aktiv ✓` : "Ingen passkey registrerad";
  button.textContent = count ? "Lägg till passkey" : "Registrera passkey";
}

$("#register-passkey").addEventListener("click", async () => {
  const button = $("#register-passkey");
  const status = $("#passkey-status");
  button.disabled = true;
  status.textContent = "Väntar på din passkey…";
  const { error } = await supabase.auth.registerPasskey();
  button.disabled = false;
  if (error) {
    status.textContent = `Kunde inte registrera: ${passkeyErrorMessage(error)}`;
    return;
  }
  status.textContent = "Passkey registrerad ✓";
  await refreshPasskeyStatus();
});

$("#sign-out").addEventListener("click", () => supabase.auth.signOut());

// ---- Account Settings modal (byt namn / byt lösenord / ta bort konto) --
// same modal-backdrop/login-card pattern as #login-modal above.
// currentSession is set from onAuthStateChange further down, since that's
// the only place a live session is available at this scope; every handler
// here bails out harmlessly if it's somehow null (shouldn't happen, the
// "Kontoinställningar" button only exists in the signed-in header).
let currentSession = null;
let currentProfile = null;
let presenceTimer = null;
let adminRefreshTimer = null;
const accountSettingsModal = $("#account-settings-modal");
const accountMessage = $("#account-settings-message");

function setAccountAvatar(key) {
  const accountButton = $("#account-toggle");
  const symbol = document.createElement("span");
  symbol.className = "header-control-icon account-avatar-symbol";
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = avatarSymbol(key);
  const label = document.createElement("span");
  label.className = "header-control-label";
  const identity = (currentProfile?.display_name || currentSession?.user?.email?.split("@")[0] || "Konto").trim();
  label.textContent = identity.split(/\s+/)[0].split(/[._-]/)[0] || "Konto";
  accountButton.replaceChildren(symbol, label);
  document.querySelectorAll(".avatar-option").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.avatar === key));
  });
}

function initAvatarOptions() {
  const options = $("#avatar-options");
  for (const [key, symbol, label] of AVATARS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar-option";
    button.dataset.avatar = key;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-checked", "false");
    button.textContent = symbol;
    button.addEventListener("click", async () => {
      if (!currentSession) return;
      accountMessage.textContent = "Sparar avatar…";
      const { error } = await supabase.from("users")
        .update({ avatar_key: key, updated_at: new Date().toISOString() })
        .eq("id", currentSession.user.id);
      if (error) {
        accountMessage.textContent = `Kunde inte spara avatar: ${error.message}`;
        return;
      }
      currentProfile = { ...currentProfile, avatar_key: key };
      setAccountAvatar(key);
      accountMessage.textContent = "Avataren är sparad ✓";
    });
    options.append(button);
  }
}
initAvatarOptions();

function formatAdminDate(value) {
  return value ? new Date(value).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }) : "Aldrig";
}

function adminFirstName(user) {
  const identity = (user.display_name || user.email?.split("@")[0] || "Användare").trim();
  return identity.split(/\s+/)[0].split(/[._-]/)[0] || "Användare";
}

function formatOnlineTime(value) {
  return value
    ? new Date(value).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })
    : "";
}

function isAdminRole(role) {
  return role === "admin" || role === "owner";
}

async function loadPresence() {
  if (!currentSession) return;
  const header = $("#online-users");
  const { data, error } = await supabase.rpc("list_packlista_presence");
  if (error) {
    console.error("Packlista: kunde inte hämta närvaro", error);
    header.hidden = true;
    return;
  }
  const online = (data || [])
    .sort((left, right) => Number(right.id === currentSession.user.id) - Number(left.id === currentSession.user.id));
  header.replaceChildren();
  if (!online.length) {
    header.hidden = true;
    return;
  }
  const dot = document.createElement("i");
  dot.className = "online-dot";
  const names = document.createElement("strong");
  names.textContent = online
    .map((user) => `${adminFirstName(user)} ${formatOnlineTime(user.last_seen_at)}`.trim())
    .join(" · ");
  header.append(dot, names);
  header.hidden = false;
}

async function loadAdminUsers() {
  if (!isAdminRole(currentProfile?.role)) return;
  const message = $("#admin-message");
  const list = $("#admin-users-list");
  message.textContent = "Hämtar användare…";
  const { data, error } = await supabase.functions.invoke("packlista-admin", { body: { action: "list" } });
  if (error || data?.error) {
    message.textContent = `Kunde inte hämta användare: ${data?.error || error?.message}`;
    return;
  }
  list.replaceChildren();
  for (const user of data?.users || []) {
    const row = document.createElement("article");
    row.className = "admin-user-row";
    const avatar = document.createElement("div");
    avatar.className = "admin-user-avatar";
    avatar.textContent = avatarSymbol(user.avatarKey);
    const identity = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = `${user.displayName || user.email || "Namnlös användare"}${user.id === currentSession?.user?.id ? " (du)" : ""}`;
    const meta = document.createElement("span");
    meta.textContent = `${user.confirmedAt ? "Godkänd" : "Väntar på godkännande"} · Registrerad ${formatAdminDate(user.createdAt)} · Senast inloggad ${formatAdminDate(user.lastSignInAt)}`;
    identity.append(name, meta);
    const status = document.createElement("b");
    status.className = "admin-user-actions";
    if (!user.confirmedAt) {
      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "quiet-button admin-approve-button";
      approve.textContent = "Godkänn";
      approve.addEventListener("click", async () => {
        approve.disabled = true;
        message.textContent = "Godkänner användaren…";
        const result = await supabase.functions.invoke("packlista-admin", { body: { action: "approve", userId: user.id } });
        if (result.error || result.data?.error) {
          message.textContent = result.data?.error || result.error?.message;
          approve.disabled = false;
          return;
        }
        await loadAdminUsers();
      });
      status.append(approve);
    }
    const role = document.createElement("select");
    role.setAttribute("aria-label", `Behörighet för ${user.email}`);
    role.disabled = user.role === "owner";
    [["user", "Användare"], ["admin", "Administratör"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = user.role === value || (user.role === "owner" && value === "admin");
      role.append(option);
    });
    role.addEventListener("change", async () => {
      role.disabled = true;
      const result = await supabase.functions.invoke("packlista-admin", { body: { action: "set_role", userId: user.id, role: role.value } });
      message.textContent = result.error || result.data?.error ? (result.data?.error || result.error?.message) : "Behörigheten är sparad ✓";
      role.disabled = false;
    });
    status.append(role);
    row.append(avatar, identity, status);
    list.append(row);
  }
  message.textContent = "";
}

async function markActive() {
  if (!currentSession || document.visibilityState === "hidden") return;
  await supabase.rpc("touch_packlista_presence");
  await loadPresence();
}

$("#admin-invite-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdminRole(currentProfile?.role)) return;
  const emailInput = $("#admin-invite-email");
  const message = $("#admin-message");
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  message.textContent = "Skickar inbjudan…";
  const { data, error } = await supabase.functions.invoke("packlista-admin", {
    body: { action: "invite", email: emailInput.value.trim() },
  });
  button.disabled = false;
  if (error || data?.error) {
    message.textContent = `Kunde inte skicka inbjudan: ${data?.error || error?.message}`;
    return;
  }
  emailInput.value = "";
  message.textContent = "Inbjudan är skickad ✓";
  await loadAdminUsers();
});

$("#admin-refresh-users").addEventListener("click", loadAdminUsers);
const adminModal = $("#admin-modal");
async function openAdminModal(trigger) {
  const panel = trigger.closest("[data-dropdown-panel]");
  if (panel) panel.hidden = true;
  $("#settings-toggle-app").setAttribute("aria-expanded", "false");
  $("#account-toggle").setAttribute("aria-expanded", "false");
  adminModal.hidden = false;
  await loadAdminUsers();
}
$("#open-admin-settings").addEventListener("click", (event) => openAdminModal(event.currentTarget));
$("#open-admin-account").addEventListener("click", (event) => openAdminModal(event.currentTarget));
const closeAdminModal = () => { adminModal.hidden = true; };
$("#close-admin").addEventListener("click", closeAdminModal);
adminModal.addEventListener("click", (event) => { if (event.target === adminModal) closeAdminModal(); });
const openAccountSettingsModal = async () => {
  accountMessage.textContent = "";
  $("#password-form").reset();
  accountSettingsModal.hidden = false;
  if (!currentSession) return;
  const { data, error } = await supabase.from("users")
    .select("display_name,avatar_key,role").eq("id", currentSession.user.id).maybeSingle();
  $("#display-name").value = error ? "" : (data?.display_name || "");
  if (!error && data) {
    currentProfile = data;
    setAccountAvatar(data.avatar_key);
  }
};
const closeAccountSettingsModal = () => { accountSettingsModal.hidden = true; };

$("#open-account-settings").addEventListener("click", () => {
  // The button lives inside the account dropdown panel -- close that
  // panel explicitly since it's not a click "outside" the dropdown from
  // initDropdowns()' point of view (the click target is inside it).
  const panel = $("#open-account-settings").closest("[data-dropdown-panel]");
  if (panel) panel.hidden = true;
  $("#account-toggle").setAttribute("aria-expanded", "false");
  openAccountSettingsModal();
});
$("#close-account-settings").addEventListener("click", closeAccountSettingsModal);
accountSettingsModal.addEventListener("click", (event) => {
  if (event.target === accountSettingsModal) closeAccountSettingsModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !accountSettingsModal.hidden) closeAccountSettingsModal();
  if (event.key === "Escape" && !adminModal.hidden) closeAdminModal();
});

$("#rename-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentSession) return;
  const name = $("#display-name").value.trim();
  accountMessage.textContent = "Sparar namn…";
  const { error } = await supabase.from("users")
    .update({ display_name: name, updated_at: new Date().toISOString() })
    .eq("id", currentSession.user.id);
  // Needs supabase/migrations/0024_account_settings.sql run (it re-grants
  // UPDATE on display_name -- 0022 had revoked it entirely) or this fails
  // with a permission error every time.
  accountMessage.textContent = error ? `Kunde inte byta namn: ${error.message}` : "Namnet är uppdaterat ✓";
  if (!error) {
    currentProfile = { ...currentProfile, display_name: name };
    setAccountAvatar(currentProfile.avatar_key);
    if (isAdminRole(currentProfile.role)) loadAdminUsers();
  }
});

$("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentSession) return;
  const current = $("#current-password").value;
  const next = $("#new-password").value;
  const confirm = $("#confirm-password").value;
  if (next !== confirm) {
    accountMessage.textContent = "De nya lösenorden matchar inte.";
    return;
  }
  accountMessage.textContent = "Byter lösenord…";
  // supabase.auth.updateUser() alone doesn't check the current password --
  // it trusts whatever session is active. Re-authenticating first (rather
  // than just trusting the "Nuvarande lösenord" field blindly) is what
  // actually verifies it's correct before allowing the change.
  const verify = await supabase.auth.signInWithPassword({ email: currentSession.user.email, password: current });
  if (verify.error) {
    accountMessage.textContent = "Fel nuvarande lösenord.";
    return;
  }
  const { error } = await supabase.auth.updateUser({ password: next });
  accountMessage.textContent = error ? `Kunde inte byta lösenord: ${error.message}` : "Lösenordet är uppdaterat ✓";
  if (!error) $("#password-form").reset();
});

$("#delete-account").addEventListener("click", async () => {
  if (!currentSession) return;
  if (!window.confirm("Ta bort kontot och all packlistedata permanent? Det går inte att ångra.")) return;
  accountMessage.textContent = "Tar bort konto…";
  // Calls the delete_own_account() security-definer function from
  // 0024_account_settings.sql -- there's no client-safe way to delete
  // your own auth.users row directly (auth.* isn't exposed to PostgREST).
  const { error } = await supabase.rpc("delete_own_account");
  if (error) {
    accountMessage.textContent = `Kunde inte ta bort kontot: ${error.message}`;
    return;
  }
  await supabase.auth.signOut();
  window.location.reload();
});

// ---- header dropdowns (settings gear, account avatar) -- one generic
// implementation for both, driven entirely by the [data-dropdown]/
// [data-dropdown-panel] markup in index.html rather than per-button
// wiring, since the two behave identically (click trigger to toggle,
// click outside or Escape to close, opening one closes any other).
function initDropdowns() {
  const dropdowns = Array.from(document.querySelectorAll("[data-dropdown]"));
  function closeAll() {
    dropdowns.forEach((dropdown) => {
      const trigger = dropdown.querySelector("button");
      const panel = dropdown.querySelector("[data-dropdown-panel]");
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    });
  }
  dropdowns.forEach((dropdown) => {
    const trigger = dropdown.querySelector("button");
    const panel = dropdown.querySelector("[data-dropdown-panel]");
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = panel.hidden;
      closeAll();
      panel.hidden = !willOpen;
      trigger.setAttribute("aria-expanded", String(!willOpen));
    });
    panel.addEventListener("click", (event) => event.stopPropagation());
  });
  document.addEventListener("click", closeAll);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeAll(); });
}
initDropdowns();

// ---- settings dropdown controls (unit system, density) -- guest and
// signed-in headers each have their own copy of these selects (they're
// never both visible at once, but both exist in the DOM simultaneously),
// kept in sync with each other and with the shared `prefs` object so
// switching between signed-out and signed-in never shows a stale choice.
function initSettingsControls() {
  const unitSelects = [$("#unit-select-guest"), $("#unit-select-app")].filter(Boolean);
  const densitySelects = [$("#density-select-guest"), $("#density-select-app")].filter(Boolean);
  const themeToggles = [$("#theme-toggle-guest"), $("#theme-toggle-app")].filter(Boolean);
  function syncControls() {
    unitSelects.forEach((select) => { select.value = prefs.unit; });
    densitySelects.forEach((select) => { select.value = prefs.density; });
    themeToggles.forEach((toggle) => { toggle.checked = prefs.theme === "dark"; });
  }
  syncControls();
  unitSelects.forEach((select) => select.addEventListener("change", () => {
    prefs = { ...prefs, unit: select.value };
    savePrefs();
    syncControls();
    refreshAllPlanners();
  }));
  densitySelects.forEach((select) => select.addEventListener("change", () => {
    prefs = { ...prefs, density: select.value };
    savePrefs();
    syncControls();
    refreshAllPlanners();
  }));
  themeToggles.forEach((toggle) => toggle.addEventListener("change", () => {
    prefs = { ...prefs, theme: toggle.checked ? "dark" : "light" };
    savePrefs();
    applyTheme();
    syncControls();
  }));
}
initSettingsControls();

createPlanner($("#guest-planner"));
async function handleSession(session) {
  currentSession = session;
  $("#signed-out").hidden = Boolean(session);
  $("#signed-in").hidden = !session;
  if (session) {
    closeModal();
    $("#account-email").textContent = session.user.email;
    createPlanner($("#private-planner"), { session });
    refreshPasskeyStatus();
    const { data } = await supabase.from("users")
      .select("display_name,avatar_key,role").eq("id", session.user.id).maybeSingle();
    currentProfile = data || { display_name: "", avatar_key: "backpack", role: "user" };
    setAccountAvatar(currentProfile.avatar_key);
    $("#open-admin-settings").hidden = !isAdminRole(currentProfile.role);
    $("#open-admin-account").hidden = !isAdminRole(currentProfile.role);
    clearInterval(presenceTimer);
    clearInterval(adminRefreshTimer);
    await markActive();
    presenceTimer = setInterval(markActive, 45_000);
    if (isAdminRole(currentProfile.role)) {
      await loadAdminUsers();
      adminRefreshTimer = setInterval(loadAdminUsers, 60_000);
    }
  } else {
    $("#private-planner").replaceChildren();
    $("#passkey-status").textContent = "";
    $("#online-users").hidden = true;
    $("#open-admin-settings").hidden = true;
    $("#open-admin-account").hidden = true;
    currentProfile = null;
    clearInterval(presenceTimer);
    clearInterval(adminRefreshTimer);
  }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") markActive(); });
supabase.auth.onAuthStateChange((_event, session) => {
  handleSession(session).catch((error) => console.error("Packlista session setup failed", error));
});
