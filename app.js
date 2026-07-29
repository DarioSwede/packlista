const cfg = window.PACKLISTA_CONFIG;
const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { experimental: { passkey: true } },
});

const DEFAULT_CATEGORIES = [
  { id: "ryggsack", name: "Ryggsäck" },
  { id: "bo", name: "Bo" },
  { id: "sova", name: "Sova" },
  { id: "mat", name: "Mat" },
  { id: "kok", name: "Kök" },
  { id: "klader", name: "Kläder" },
  { id: "sakerhet", name: "Säkerhet" },
  { id: "elektronik", name: "Elektronik" },
  { id: "ovrigt", name: "Övrigt" },
];

const $ = (selector, root = document) => root.querySelector(selector);
const uid = () => crypto.randomUUID();
const kg = (grams) => `${((Number(grams) || 0) / 1000).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;

function createPlanner(container, { session = null } = {}) {
  const root = document.importNode($("#planner-template").content, true).firstElementChild;
  container.replaceChildren(root);

  let listId = null;
  let items = [];
  let categories = DEFAULT_CATEGORIES;
  let query = "";
  let filter = "alla";
  let tripDays = 6;
  let listSettings = {};
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
    const packedQuantity = Math.max(0, item.quantity - (item.worn ? 1 : 0));
    return item.weight * packedQuantity;
  }

  function render() {
    const visible = items.filter((item) => {
      const matchesText = !query || item.name.toLowerCase().includes(query);
      return matchesText && (filter === "alla" || item.category === filter);
    });
    const total = items.reduce((sum, item) => sum + itemTotal(item), 0);
    const consumable = items.filter((item) => item.consumable).reduce((sum, item) => sum + itemTotal(item), 0);

    $("[data-total]", root).textContent = kg(total);
    $("[data-base]", root).textContent = kg(total - consumable);
    $("[data-count]", root).textContent = String(items.length);
    const missing = items.filter((item) => !item.owned);
    $("[data-missing]", root).textContent = String(missing.length);
    $("[data-shopping-badge]", root).textContent = String(missing.length);
    empty.hidden = items.length > 0;
    tbody.replaceChildren(...visible.map(itemRow));
    renderInsights(total, consumable);
    renderShopping(missing);
    renderPrint(total, total - consumable, missing.length);
  }

  function categoryName(id) {
    return categories.find((category) => category.id === id)?.name || "Övrigt";
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
    svg.setAttribute("aria-label", `Viktprognos från ${kg(total)} till ${kg(endWeight)} under ${days} dagar`);
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
    $("[data-forecast-caption]", root).textContent = consumable
      ? `Dag 1: ${kg(total)} → Dag ${days}: ${kg(endWeight)} · jämn förbrukning över dagarna.`
      : `Markera mat, bränsle och annat som “Förbrukas” för att se hur vikten minskar.`;

    const grouped = categories.map((category) => ({
      ...category,
      weight: items.filter((item) => item.category === category.id).reduce((sum, item) => sum + itemTotal(item), 0),
    })).filter((category) => category.weight > 0).sort((a, b) => b.weight - a.weight);
    const maxWeight = Math.max(1, ...grouped.map((category) => category.weight));
    const chart = $("[data-category-chart]", root);
    $("[data-category-empty]", root).hidden = grouped.length > 0;
    $("[data-clear-category]", root).hidden = filter === "alla";
    chart.replaceChildren(...grouped.map((category) => {
      const button = document.createElement("button");
      button.className = "category-bar";
      button.classList.toggle("active", filter === category.id);
      button.setAttribute("aria-label", `Visa ${category.name}, ${kg(category.weight)}`);
      const name = document.createElement("span");
      name.textContent = category.name;
      const track = document.createElement("i");
      const fill = document.createElement("b");
      fill.style.width = `${Math.max(3, (category.weight / maxWeight) * 100)}%`;
      track.append(fill);
      const weight = document.createElement("strong");
      weight.textContent = kg(category.weight);
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
      const label = document.createElement("label");
      label.append(check, document.createTextNode(" Inköpt"));
      row.append(info, label);
      return row;
    }));
  }

  function renderPrint(total, base, missingCount) {
    $("[data-print-title]", root).textContent = $(".list-title", root).textContent;
    $("[data-print-total]", root).textContent = kg(total);
    $("[data-print-base]", root).textContent = kg(base);
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
        item.worn ? "✓" : "",
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

  function itemRow(item) {
    const row = document.createElement("tr");
    const nameCell = row.insertCell();
    nameCell.append(field("text", item.name, "Artikel", (value) => item.name = value));

    const categoryCell = row.insertCell();
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Kategori");
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.name;
      option.selected = item.category === category.id;
      select.append(option);
    });
    select.addEventListener("change", () => {
      item.category = select.value;
      scheduleSave();
      render();
    });
    categoryCell.append(select);

    row.insertCell().append(field("number", item.weight, "Vikt i gram", (value) => item.weight = value));
    row.insertCell().append(field("number", item.quantity, "Antal", (value) => item.quantity = value));
    row.insertCell().append(field("checkbox", item.owned, "Jag har prylen", (value) => item.owned = value));
    row.insertCell().append(field("checkbox", item.consumable, "Förbrukas", (value) => item.consumable = value));
    row.insertCell().append(field("checkbox", item.worn, "Bärs på kroppen", (value) => item.worn = value));

    const deleteCell = row.insertCell();
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Ta bort ${item.name}`);
    remove.addEventListener("click", () => {
      deletedIds.add(item.id);
      items = items.filter((candidate) => candidate.id !== item.id);
      scheduleSave();
      render();
    });
    deleteCell.append(remove);
    return row;
  }

  function addItem() {
    items.push({
      id: uid(), name: "Ny pryl", category: "ovrigt", weight: 0, quantity: 1,
      owned: false, consumable: false, worn: false, weighed: false, note: "",
    });
    scheduleSave();
    render();
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
    listSettings = { ...listSettings, tripDays };
    const listResult = await supabase.from("packing_lists")
      .update({ categories, settings: listSettings, updated_at: new Date().toISOString() })
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
    saveState.textContent = error ? "Kunde inte spara" : "Sparad ✓";
  }

  async function load() {
    if (!persistent) {
      saveState.textContent = "Testläge · sparas inte";
      render();
      return;
    }

    const userId = session.user.id;
    const profile = await supabase.from("users").upsert({
      id: userId,
      display_name: session.user.email.split("@")[0],
      updated_at: new Date().toISOString(),
    });
    if (profile.error) throw profile.error;

    let { data: list, error } = await supabase.from("packing_lists")
      .select("id,name,categories,settings").eq("user_id", userId)
      .order("created_at").limit(1).maybeSingle();
    if (error) throw error;
    if (!list) {
      const created = await supabase.from("packing_lists")
        .insert({ user_id: userId, name: "Min packlista", categories: DEFAULT_CATEGORIES, settings: { tripDays: 6 } })
        .select("id,name,categories,settings").single();
      if (created.error) throw created.error;
      list = created.data;
    }
    listId = list.id;
    categories = list.categories?.length ? list.categories : DEFAULT_CATEGORIES;
    listSettings = list.settings || {};
    tripDays = Math.max(1, Number(listSettings.tripDays) || 6);
    $("[data-trip-days]", root).value = String(tripDays);
    $(".list-title", root).textContent = list.name;

    const stored = await supabase.from("packing_items")
      .select("client_id,name,category,weight,quantity,owned,consumable,worn,weighed,note")
      .eq("packing_list_id", listId).order("sort_order");
    if (stored.error) throw stored.error;
    items = stored.data.map((item) => ({ ...item, id: item.client_id }));
    saveState.textContent = "Sparad ✓";
    renderFilters();
    render();
  }

  function renderFilters() {
    filterSelect.replaceChildren();
    [["alla", "Alla kategorier"], ...categories.map((category) => [category.id, category.name])].forEach(([value, label]) => {
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
  $("[data-trip-days]", root).addEventListener("change", (event) => {
    tripDays = Math.min(60, Math.max(1, Number(event.target.value) || 1));
    event.target.value = String(tripDays);
    scheduleSave();
    render();
  });
  $("[data-clear-category]", root).addEventListener("click", () => {
    filter = "alla";
    filterSelect.value = filter;
    render();
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

$("#passkey-sign-in").addEventListener("click", async () => {
  authMessage.textContent = "Väntar på din säkerhetsnyckel…";
  const { error } = await supabase.auth.signInWithPasskey();
  authMessage.textContent = error ? `Kunde inte logga in: ${error.message}` : "";
});

$("#sign-out").addEventListener("click", () => supabase.auth.signOut());

createPlanner($("#guest-planner"));
supabase.auth.onAuthStateChange((_event, session) => {
  $("#signed-out").hidden = Boolean(session);
  $("#signed-in").hidden = !session;
  if (session) {
    closeModal();
    $("#account-email").textContent = session.user.email;
    createPlanner($("#private-planner"), { session });
  } else {
    $("#private-planner").replaceChildren();
  }
});
