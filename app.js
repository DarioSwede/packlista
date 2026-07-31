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
  let query = "";
  let filter = "alla";
  let tripDays = 6;
  let targetWeightKg = 10;
  let listSettings = {};
  let availableLists = [];
  let saveTimer = null;
  let deletedIds = new Set();
  const persistent = Boolean(session);

  const tbody = $("[data-items-body]", root);
  const empty = $("[data-empty]", root);
  const saveState = $("[data-save-state]", root);
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
    const weighedCount = items.filter((item) => item.weighed).length;
    $("[data-weighed]", root).textContent = `${weighedCount}/${items.length}`;
    const missing = items.filter((item) => !item.owned);
    $("[data-missing]", root).textContent = String(missing.length);
    $("[data-shopping-badge]", root).textContent = String(missing.length);
    empty.hidden = items.length > 0;
    tbody.replaceChildren(...visible.map(itemRow));
    renderInsights(total, consumable);
    renderTarget(total);
    renderShopping(missing);
    renderPrint(total, total - consumable, missing.length);
  }

  function renderTarget(total) {
    $("[data-target-unit]", root).textContent = weightUnitLabel();
    const difference = (targetWeightKg * 1000) - total;
    const card = $("[data-target-card]", root);
    card.classList.toggle("over", difference < 0);
    card.classList.toggle("under", difference >= 0);
    $("[data-target-status]", root).textContent = `${formatWeight(Math.abs(difference))} ${difference < 0 ? "över" : "under"} mål`;
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
      const values = [
        "☐",
        item.name,
        categoryName(item.category),
        `${item.weight || 0} g`,
        String(item.quantity),
        item.weighed ? "✓" : "",
        item.owned ? item.note : `INKÖP${item.note ? ` · ${item.note}` : ""}`,
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
      change(type === "checkbox" ? input.checked : type === "number" ? Math.max(0, Number(input.value) || 0) : input.value);
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
    nameWrap.append(field("text", item.name, "Artikel", (value) => item.name = value));

    // Hover/focus-reveal row for the three per-item flags that used to be
    // (or, for favorite, could only ever have been) dedicated table
    // columns. Consumable's category restriction and worn's "one set off
    // the pack weight" behavior are unchanged from before, just moved from
    // a checkbox column to here -- see itemTotal() for the worn math.
    const consumableAllowed = CONSUMABLE_CATEGORIES.has(item.category);
    const actions = document.createElement("div");
    actions.className = "item-actions";
    actions.append(
      actionToggle("🍴", "Förbrukas", item.consumable, () => { item.consumable = !item.consumable; }, {
        disabled: !consumableAllowed,
        title: !consumableAllowed
          ? "Förbrukning kan endast användas för Mat, Vatten och Bränsle."
          : item.consumable
            ? "Förbrukas -- vikten minskar jämnt över turens valda antal dagar. Klicka för att avmarkera."
            : "Markera som förbrukas (mat, vatten, bränsle).",
      }),
      actionToggle("👕", "Bärs på kroppen", item.worn, () => { item.worn = !item.worn; }, {
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
      deletedIds.add(item.id);
      items = items.filter((candidate) => candidate.id !== item.id);
      scheduleSave();
      render();
    });
    nameWrap.append(actions, remove);
    nameCell.append(nameWrap);

    const categoryCell = row.insertCell();
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Kategori");
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = `${category.icon || ""} ${category.name}`.trim();
      option.selected = item.category === category.id;
      select.append(option);
    });
    select.addEventListener("change", () => {
      item.category = select.value;
      if (!CONSUMABLE_CATEGORIES.has(item.category)) item.consumable = false;
      scheduleSave();
      render();
    });
    categoryCell.append(select);

    const weightCell = row.insertCell();
    const weightField = document.createElement("div");
    weightField.className = "weight-field";
    weightField.append(field("number", item.weight, "Vikt i gram", (value) => item.weight = value));
    const weighedLabel = document.createElement("label");
    weighedLabel.className = "weighed-check";
    weighedLabel.title = "Markera när vikten har kontrollerats på en våg.";
    weighedLabel.append(
      field("checkbox", item.weighed, "Kontrollvägd", (value) => item.weighed = value),
      document.createTextNode("Vägd"),
    );
    weightField.append(weighedLabel);
    weightCell.append(weightField);
    row.insertCell().append(field("number", item.quantity, "Antal", (value) => item.quantity = value));
    row.insertCell().append(field("checkbox", item.owned, "Jag har prylen", (value) => item.owned = value));

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
    saveState.textContent = "Sparar…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }

  async function save() {
    const rows = items.map(rowForSave);
    listSettings = { ...listSettings, tripDays, targetWeightKg };
    const listName = $("[data-list-name]", root).value.trim() || "Min packlista";
    const listResult = await supabase.from("packing_lists")
      .update({ name: listName, categories, settings: listSettings, updated_at: new Date().toISOString() })
      .eq("id", listId).eq("user_id", session.user.id);
    let error = listResult.error;
    if (!error && rows.length) {
      const result = await supabase.from("packing_items")
        .upsert(rows, { onConflict: "packing_list_id,client_id" });
      error = result.error;
    }
    const removed = [...deletedIds];
    if (!error && removed.length) {
      const result = await supabase.from("packing_items").delete()
        .eq("packing_list_id", listId).eq("user_id", session.user.id)
        .in("client_id", removed);
      error = result.error;
    }
    if (!error) deletedIds.clear();
    const selectedList = availableLists.find((list) => list.id === listId);
    if (!error && selectedList) {
      selectedList.name = listName;
      renderListSwitcher();
    }
    saveState.textContent = error?.code === "23505"
      ? "Namnet används redan · välj ett unikt namn"
      : error ? "Kunde inte spara" : "Sparad ✓";
  }

  function mergedCategories(stored = []) {
    return DEFAULT_CATEGORIES.map((fallback) => {
      const match = stored.find((category) => category.id === fallback.id);
      return {
        ...fallback,
        ...match,
        icon: match?.icon || fallback.icon,
        color: match?.color || fallback.color,
      };
    });
  }

  function renderListSwitcher() {
    const select = $("[data-list-select]", root);
    select.replaceChildren(...availableLists.map((list) => {
      const option = document.createElement("option");
      option.value = list.id;
      option.textContent = list.name;
      option.selected = list.id === listId;
      return option;
    }));
  }

  async function openList(list) {
    listId = list.id;
    categories = mergedCategories(list.categories);
    listSettings = list.settings || {};
    tripDays = Math.max(1, Number(listSettings.tripDays) || 6);
    targetWeightKg = Math.max(0, Number(listSettings.targetWeightKg) || 10);
    root.querySelectorAll("[data-trip-days]").forEach((input) => input.value = String(tripDays));
    applyTargetWeightUnit();
    $("[data-list-name]", root).value = list.name;
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
      .select("id,name,categories,settings,created_at").eq("user_id", userId).order("created_at");
    if (result.error) throw result.error;
    availableLists = result.data;
    if (!availableLists.length) {
      const created = await supabase.from("packing_lists")
        .insert({ user_id: userId, name: "Min packlista", categories: DEFAULT_CATEGORIES, settings: { tripDays: 6, targetWeightKg: 10 } })
        .select("id,name,categories,settings,created_at").single();
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
      .select("id,name,categories,settings,created_at").single();
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

const modal = $("#login-modal");
const authMessage = $("#auth-message");
const openModal = () => { modal.hidden = false; $("#email").focus(); };
const closeModal = () => { modal.hidden = true; authMessage.textContent = ""; };

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
  authMessage.textContent = error ? `Kunde inte logga in: ${error.message}` : "";
});

$("#sign-up").addEventListener("click", async () => {
  if (!$("#auth-form").reportValidity()) return;
  authMessage.textContent = "Skapar konto…";
  const { data, error } = await supabase.auth.signUp({
    email: $("#email").value.trim(),
    password: $("#password").value,
    options: { emailRedirectTo: "https://darioswede.github.io/packlista/" },
  });
  authMessage.textContent = error
    ? `Kunde inte skapa konto: ${error.message}`
    : data.session ? "" : "Kontot är skapat. Bekräfta adressen via mejlet du fått.";
});

function passkeyErrorMessage(error) {
  if (error?.code === "webauthn_credential_not_found") {
    return "YubiKeyn är inte registrerad för kontot. Logga in med e-post och välj Registrera YubiKey.";
  }
  if (error?.code === "passkey_disabled") {
    return "Inloggning med säkerhetsnyckel är inte aktiverad.";
  }
  if (error?.name === "NotAllowedError") {
    return "Registreringen avbröts eller YubiKeyn svarade inte. Sätt i nyckeln och försök igen.";
  }
  return error?.message || "Ett okänt fel inträffade.";
}

$("#passkey-sign-in").addEventListener("click", async () => {
  authMessage.textContent = "Väntar på din säkerhetsnyckel…";
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
    button.textContent = "Registrera YubiKey";
    return;
  }
  const count = data?.length || 0;
  status.textContent = count ? `Säkerhetsnyckel aktiv ✓` : "Ingen säkerhetsnyckel registrerad";
  button.textContent = count ? "Lägg till säkerhetsnyckel" : "Registrera YubiKey";
}

$("#register-passkey").addEventListener("click", async () => {
  const button = $("#register-passkey");
  const status = $("#passkey-status");
  button.disabled = true;
  status.textContent = "Väntar på YubiKey…";
  const { error } = await supabase.auth.registerPasskey();
  button.disabled = false;
  if (error) {
    status.textContent = `Kunde inte registrera: ${passkeyErrorMessage(error)}`;
    return;
  }
  status.textContent = "YubiKey registrerad ✓";
  await refreshPasskeyStatus();
});

$("#sign-out").addEventListener("click", () => supabase.auth.signOut());

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
supabase.auth.onAuthStateChange((_event, session) => {
  $("#signed-out").hidden = Boolean(session);
  $("#signed-in").hidden = !session;
  if (session) {
    closeModal();
    $("#account-email").textContent = session.user.email;
    $("#account-toggle").textContent = session.user.email.trim().charAt(0).toUpperCase() || "?";
    createPlanner($("#private-planner"), { session });
    refreshPasskeyStatus();
  } else {
    $("#private-planner").replaceChildren();
    $("#passkey-status").textContent = "";
  }
});
