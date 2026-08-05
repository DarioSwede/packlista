// Import/export of packing lists. Kept in its own module, free of DOM and
// Supabase access, so the parsing can be exercised on its own -- app.js
// only does the wiring (category mapping, saving, downloading).
//
// The CSV column layout follows LighterPack's export, since that is what
// the other gear-list sites read: Item Name, Category, desc, qty, weight,
// unit, url, price, worn, consumable. Reading is deliberately far more
// forgiving than writing: field names are matched through FIELD_ALIASES,
// which is applied both to CSV header cells and to JSON object keys, so a
// service we have never seen still lands in the right columns.

export const EXPORT_FORMAT = "packlista";
export const EXPORT_VERSION = 1;

// Everything is stored as whole grams internally.
const UNIT_GRAMS = {
  g: 1, gr: 1, gram: 1, grams: 1,
  kg: 1000, kilo: 1000, kilogram: 1000,
  oz: 28.349523125, ounce: 28.349523125, ounces: 28.349523125,
  lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237,
};

const FIELD_ALIASES = {
  name: ["itemname", "name", "item", "artikel", "pryl", "gear", "produkt", "titel", "title", "utrustning"],
  category: ["category", "kategori", "cat", "categories", "categoryname", "group", "grupp", "section", "typ"],
  weight: ["weight", "vikt", "wt", "gram", "grams", "massa"],
  unit: ["unit", "enhet", "units", "uom", "weightunit", "viktenhet"],
  quantity: ["qty", "quantity", "antal", "count", "amount", "number", "st", "stk"],
  worn: ["worn", "wornweight", "bars", "barspakroppen", "pakroppen", "burna", "iswom", "isworn"],
  consumable: ["consumable", "consumables", "consumed", "forbrukas", "forbrukning", "forbrukningsvara", "isconsumable"],
  note: ["desc", "description", "notes", "note", "notering", "beskrivning", "comment", "kommentar"],
  url: ["url", "link", "lank", "href", "webshop", "producturl"],
  price: ["price", "pris", "cost", "kostnad"],
  owned: ["owned", "have", "inkopt", "harprylen", "jagharprylen", "acquired", "ispurchased", "purchased"],
  favorite: ["favorite", "favourite", "favorit", "star", "starred", "isfavorite"],
  weighed: ["weighed", "vagd", "kontrollvagd", "verified"],
};

// Folds å/ä/ö to a/a/o and drops separators, so "Item Name", "item_name",
// "ITEMNAME", "Bärs" and "Förbrukas" all reduce to something the ASCII
// alias lists above can match.
const normaliseKey = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]/g, "");

function unitFactor(unit) {
  const key = String(unit || "").toLowerCase().replace(/[^a-z]/g, "");
  return UNIT_GRAMS[key] || 0;
}

/**
 * Resolve one CSV header cell or JSON key to a field name. Returns null
 * when nothing matches. A weight column can carry its unit in the name
 * ("weight (oz)", "weight_grams"), which is reported as `unit`.
 */
function matchField(rawKey) {
  const key = normaliseKey(rawKey);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(key)) return { field, unit: "" };
  }
  const weightPrefix = /^(weight|vikt|wt)(.*)$/.exec(key);
  if (weightPrefix) {
    const embedded = weightPrefix[2];
    return { field: "weight", unit: unitFactor(embedded) ? embedded : "" };
  }
  return null;
}

// "259,97" and "259.97" both occur -- Swedish exports use the comma.
// Anything non-numeric (units glued onto the number, thousands spaces)
// is stripped before parsing.
function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value || "").trim();
  if (!text) return 0;
  const cleaned = text.replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  // A comma is a decimal separator here, never a thousands separator: the
  // only way "1,5" reaches this function is from a Swedish decimal.
  const number = Number(cleaned.replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

const FALSEY = new Set(["", "0", "false", "no", "nej", "n", "-", "off", "nan", "null", "undefined"]);
const isTruthy = (value) => {
  if (typeof value === "boolean") return value;
  return !FALSEY.has(String(value ?? "").trim().toLowerCase());
};

const noteFrom = (parts) => parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(" · ");

function emptyItem() {
  return {
    name: "", categoryName: "", weight: 0, quantity: 1,
    worn: false, consumable: false, owned: false, favorite: false, weighed: false, note: "",
  };
}

// ---- CSV ------------------------------------------------------------

// Minimal RFC 4180 reader: quoted fields may contain the delimiter,
// newlines and doubled quotes. Handles CRLF and a trailing newline.
export function parseCsv(text, delimiter) {
  const source = String(text || "").replace(/^﻿/, "");
  const separator = delimiter || detectDelimiter(source);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === separator) { row.push(field); field = ""; continue; }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  row.push(field);
  rows.push(row);
  // Drop rows that are entirely empty -- a trailing newline always
  // produces one, and hand-edited files often have more.
  return rows.filter((candidate) => candidate.some((cell) => String(cell).trim() !== ""));
}

// Excel on a Swedish locale writes semicolons; everyone else writes
// commas. Pick whichever occurs more often on the header line.
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = [",", ";", "\t"].map((candidate) => [candidate, firstLine.split(candidate).length - 1]);
  const [best] = counts.sort((left, right) => right[1] - left[1]);
  return best[1] > 0 ? best[0] : ",";
}

function csvToItems(rows) {
  const warnings = [];
  const mapping = {};
  let headerUnit = "";
  (rows[0] || []).forEach((rawHeader, index) => {
    const match = matchField(rawHeader);
    if (!match || mapping[match.field] !== undefined) return;
    mapping[match.field] = index;
    if (match.field === "weight" && match.unit) headerUnit = match.unit;
  });
  if (mapping.name === undefined) {
    throw new Error("Hittade ingen kolumn med artikelnamn. Kontrollera att filen har en rubrikrad.");
  }
  const cell = (row, field) => mapping[field] === undefined ? "" : (row[mapping[field]] ?? "");
  const hasUnitInfo = mapping.unit !== undefined || Boolean(headerUnit);
  let unitlessRows = 0;

  const items = [];
  for (const row of rows.slice(1)) {
    const name = String(cell(row, "name")).trim();
    if (!name) continue;
    const item = emptyItem();
    item.name = name;
    item.categoryName = String(cell(row, "category")).trim();
    const rawWeight = cell(row, "weight");
    const rawUnit = String(cell(row, "unit")).trim() || headerUnit;
    // A unit glued to the value ("259.97 g") wins over the column, since
    // it describes that specific row.
    const inlineUnit = String(rawWeight).replace(/[0-9\s,.-]/g, "");
    const factor = unitFactor(inlineUnit) || unitFactor(rawUnit);
    if (!factor && !hasUnitInfo) unitlessRows += 1;
    item.weight = Math.max(0, Math.round(parseNumber(rawWeight) * (factor || 1)));
    const quantity = Math.round(parseNumber(cell(row, "quantity")));
    item.quantity = quantity > 0 ? quantity : 1;
    item.worn = isTruthy(cell(row, "worn"));
    item.consumable = isTruthy(cell(row, "consumable"));
    if (mapping.owned !== undefined) item.owned = isTruthy(cell(row, "owned"));
    if (mapping.favorite !== undefined) item.favorite = isTruthy(cell(row, "favorite"));
    if (mapping.weighed !== undefined) item.weighed = isTruthy(cell(row, "weighed"));
    item.note = noteFrom([
      cell(row, "note"),
      cell(row, "url"),
      cell(row, "price") ? `Pris: ${String(cell(row, "price")).trim()}` : "",
    ]);
    items.push(item);
  }
  if (unitlessRows) warnings.push(`${unitlessRows} rader saknade viktenhet och tolkades som gram.`);
  return { items, warnings };
}

// ---- JSON -----------------------------------------------------------

// Reads one item object without knowing its field names in advance: every
// key is run through matchField, so weight_grams, itemName, "Vikt (g)" and
// qty all land correctly.
function objectToItem(raw, fallbackCategory = "") {
  const item = emptyItem();
  item.categoryName = fallbackCategory;
  let unit = "";
  let weightRaw = "";
  let note = "";
  let url = "";
  let price = "";
  for (const [key, value] of Object.entries(raw || {})) {
    if (value === null || typeof value === "object") continue;
    const match = matchField(key);
    if (!match) continue;
    switch (match.field) {
      case "name": if (!item.name) item.name = String(value).trim(); break;
      case "category": if (String(value).trim()) item.categoryName = String(value).trim(); break;
      case "weight": weightRaw = value; if (match.unit) unit = match.unit; break;
      case "unit": unit = unit || String(value); break;
      case "quantity": item.quantity = Math.round(parseNumber(value)) || 1; break;
      case "worn": item.worn = isTruthy(value); break;
      case "consumable": item.consumable = isTruthy(value); break;
      case "owned": item.owned = isTruthy(value); break;
      case "favorite": item.favorite = isTruthy(value); break;
      case "weighed": item.weighed = isTruthy(value); break;
      case "note": note = note || String(value); break;
      case "url": url = String(value); break;
      case "price": price = String(value); break;
      default: break;
    }
  }
  const inlineUnit = String(weightRaw).replace(/[0-9\s,.-]/g, "");
  const factor = unitFactor(inlineUnit) || unitFactor(unit) || 1;
  item.weight = Math.max(0, Math.round(parseNumber(weightRaw) * factor));
  if (item.quantity < 1) item.quantity = 1;
  item.note = noteFrom([note, url, price ? `Pris: ${price}` : ""]);
  return item;
}

// Goulight (and anything else that nests items under named categories):
// { lists: [ { name, categories: [ { name, items: [...] } ] } ] }
function nestedListToItems(list) {
  const items = [];
  for (const category of list.categories || []) {
    const categoryName = String(category?.name || "").trim();
    for (const raw of category?.items || []) items.push(objectToItem(raw, categoryName));
  }
  return items;
}

function jsonToItems(payload) {
  const warnings = [];
  let listName = "";
  let settings = null;
  let items = null;

  if (Array.isArray(payload?.lists) && payload.lists.length) {
    const [list, ...rest] = payload.lists;
    listName = String(list?.name || "").trim();
    items = nestedListToItems(list);
    if (rest.length) {
      warnings.push(`Filen innehöll ${payload.lists.length} listor. Importerade "${listName || "den första"}" -- kör importen igen för de övriga.`);
    }
  } else if (Array.isArray(payload?.categories)) {
    items = nestedListToItems(payload);
    listName = String(payload?.name || "").trim();
  } else {
    const rawItems = Array.isArray(payload) ? payload
      : Array.isArray(payload?.items) ? payload.items
        : Array.isArray(payload?.gearItems) ? payload.gearItems
          : null;
    if (!rawItems) throw new Error("Hittade inga prylar i JSON-filen.");
    items = rawItems.map((raw) => objectToItem(raw));
    listName = typeof payload?.list?.name === "string" ? payload.list.name : "";
    settings = payload?.list?.settings || null;
  }

  items = items.filter((item) => item.name);
  if (!items.length) throw new Error("Filen innehöll inga prylar med namn -- är listan tom i den andra tjänsten?");
  return { items, warnings, listName, settings };
}

// ---- ZIP ------------------------------------------------------------

const readU16 = (view, offset) => view.getUint16(offset, true);
const readU32 = (view, offset) => view.getUint32(offset, true);
const U32_MAX = 0xffffffff;

// ZIP64: any size or offset that does not fit in 32 bits is written as
// 0xffffffff and the real value moves into extra field 0x0001, as eight
// byte values in a fixed order -- but only the ones that overflowed are
// present. Goulight's export writes every size this way even though the
// file is 438 bytes, so this is the normal path, not an edge case.
function applyZip64Extra(view, start, length, entry) {
  let offset = start;
  const end = start + length;
  while (offset + 4 <= end) {
    const headerId = readU16(view, offset);
    const size = readU16(view, offset + 2);
    if (headerId !== 0x0001) { offset += 4 + size; continue; }
    let cursor = offset + 4;
    const next = () => {
      const value = Number(view.getBigUint64(cursor, true));
      cursor += 8;
      return value;
    };
    if (entry.uncompressedSize === U32_MAX && cursor + 8 <= end) entry.uncompressedSize = next();
    if (entry.compressedSize === U32_MAX && cursor + 8 <= end) entry.compressedSize = next();
    if (entry.localOffset === U32_MAX && cursor + 8 <= end) entry.localOffset = next();
    return;
  }
}

/**
 * Pull the largest .json entry out of a ZIP. Written against the central
 * directory rather than the local headers, since entries written with a
 * streaming data descriptor carry zeroed sizes in the local header.
 * Stored, deflated and ZIP64 entries are handled; nothing else occurs in
 * a data export.
 */
export async function readZipJson(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // End of central directory: fixed 22 bytes plus an optional comment, so
  // scan backwards for the signature.
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= 0 && offset > bytes.length - 22 - 65536; offset -= 1) {
    if (readU32(view, offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("ZIP-filen ser skadad ut (hittade inget innehållsregister).");

  const entryCount = readU16(view, eocd + 10);
  let pointer = readU32(view, eocd + 16);
  if (pointer === U32_MAX) throw new Error("ZIP-filen är för stor för att packas upp i webbläsaren.");
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(view, pointer) !== 0x02014b50) break;
    const nameLength = readU16(view, pointer + 28);
    const extraLength = readU16(view, pointer + 30);
    const commentLength = readU16(view, pointer + 32);
    const entry = {
      method: readU16(view, pointer + 10),
      compressedSize: readU32(view, pointer + 20),
      uncompressedSize: readU32(view, pointer + 24),
      localOffset: readU32(view, pointer + 42),
      name: new TextDecoder().decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength)),
    };
    applyZip64Extra(view, pointer + 46 + nameLength, extraLength, entry);
    entries.push(entry);
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  const candidates = entries
    .filter((entry) => /\.json$/i.test(entry.name) && !entry.name.startsWith("__MACOSX"))
    .sort((left, right) => right.uncompressedSize - left.uncompressedSize);
  const entry = candidates[0];
  if (!entry) throw new Error("Hittade ingen JSON-fil i ZIP-filen.");

  // The local header repeats the name and extra fields, and its extra
  // field length can differ from the central directory's.
  const localNameLength = readU16(view, entry.localOffset + 26);
  const localExtraLength = readU16(view, entry.localOffset + 28);
  const start = entry.localOffset + 30 + localNameLength + localExtraLength;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error(`ZIP-filen använder en komprimering som inte stöds (metod ${entry.method}).`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

const isZip = (bytes) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

/**
 * Turn a picked File into text parseImport() can read: unwraps a ZIP data
 * export, otherwise decodes the file as UTF-8.
 */
export async function readImportFile(file) {
  const buffer = await file.arrayBuffer();
  if (isZip(new Uint8Array(buffer))) {
    return { text: await readZipJson(buffer), filename: file.name.replace(/\.zip$/i, "") };
  }
  return { text: new TextDecoder().decode(buffer), filename: file.name };
}

// ---- entry point ----------------------------------------------------

/**
 * Read an exported gear list. Accepts our own JSON export, a Goulight-style
 * data.json with lists/categories/items, a bare JSON array of items, and
 * CSV from LighterPack or anything with a comparable header row. Weights
 * come back as whole grams.
 *
 * Returns { items, warnings, listName, settings, source }. Throws with a
 * Swedish message when the file cannot be understood -- callers show it
 * as-is.
 */
export function parseImport(text, filename = "") {
  const source = String(text || "").replace(/^﻿/, "").trim();
  if (!source) throw new Error("Filen är tom.");
  if (source.startsWith("{") || source.startsWith("[")) {
    let payload;
    try { payload = JSON.parse(source); }
    catch { throw new Error("Filen ser ut som JSON men går inte att tolka."); }
    const parsed = jsonToItems(payload);
    return {
      ...parsed,
      listName: parsed.listName || filename.replace(/\.[a-z0-9]+$/i, "").trim(),
      source: "json",
    };
  }
  const rows = parseCsv(source);
  if (rows.length < 2) throw new Error("Filen saknar rader under rubrikraden.");
  return {
    ...csvToItems(rows),
    listName: filename.replace(/\.[a-z0-9]+$/i, "").trim(),
    settings: null,
    source: "csv",
  };
}

// ---- writing --------------------------------------------------------

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * LighterPack-compatible CSV. `categoryName` resolves a category id to the
 * name shown in the app, since other sites only know the name.
 */
export function itemsToCsv(items, categoryName = (id) => id) {
  const header = ["Item Name", "Category", "desc", "qty", "weight", "unit", "url", "price", "worn", "consumable"];
  const rows = (items || []).map((item) => [
    item.name || "",
    categoryName(item.category) || "",
    item.note || "",
    item.quantity ?? 1,
    Math.round(item.weight || 0),
    "g",
    "",
    "",
    item.worn ? "worn" : "",
    item.consumable ? "consumable" : "",
  ]);
  // The BOM keeps Excel from mangling å/ä/ö when the file is opened by
  // double-clicking it.
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/**
 * Full-fidelity export: everything the app stores about a list, including
 * the flags CSV has no room for, so an export can be re-imported without
 * losing anything.
 */
export function listToJson({ name, settings, categories, items }) {
  const byId = new Map((categories || []).map((category) => [category.id, category]));
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    list: { name: name || "Min packlista", settings: settings || {} },
    items: (items || []).map((item) => {
      const category = byId.get(item.category);
      return {
        name: item.name || "",
        category: category?.name || item.category || "",
        icon: category?.icon || "",
        weight: Math.round(item.weight || 0),
        unit: "g",
        quantity: item.quantity ?? 1,
        owned: !!item.owned,
        consumable: !!item.consumable,
        worn: !!item.worn,
        favorite: !!item.favorite,
        weighed: !!item.weighed,
        note: item.note || "",
      };
    }),
  };
}

export const exportFilename = (listName, extension) => {
  const base = String(listName || "packlista").trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60) || "packlista";
  return `${base}.${extension}`;
};
