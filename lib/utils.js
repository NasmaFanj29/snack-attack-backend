const { URLSearchParams } = require("url");

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : ["http://localhost:3000"];

function getCorsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return {
      "Access-Control-Allow-Origin": allowedOrigins[0] || "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    };
  }

  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    };
  }

  return null;
}

function setCorsHeaders(req, res) {
  const headers = getCorsHeaders(req);
  if (!headers) return false;
  Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  return true;
}

function handleCors(req, res) {
  if (!setCorsHeaders(req, res)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "CORS origin denied" }));
    return true;
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}

function ensureMethod(req, res, methods) {
  if (!methods.includes(req.method)) {
    res.setHeader("Allow", methods.join(", "));
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return false;
  }
  return true;
}

async function parseJsonBody(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error("Invalid JSON body");
  }
}

function parseJsonSafe(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function sanitizeText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .trim();
}

function detectLanguage(text) {
  if (!text || typeof text !== "string") return "english";
  // FIX (Issue 13): /[\u0600-\u06FF]/ matched ASCII hex chars '0'–'F', not Arabic.
  // \u0600-\u06FF is the actual Arabic Unicode block.
  if (/[\u0600-\u06FF]/.test(text)) return "arabic";

  const francoNumbers = /\b\w*[32785640]\w*\b/.test(text);
  const francoWords = /\b(shu|yalla|kif|kifak|kifek|marhaba|ahla|ahlan|salam|3andi|3andak|baddak|bade|badi|hala2|halla2|hl2|kteer|kter|ktir|ma3|m3|la2|laa|fi|men|min|mn|3al|3l|lal|bl|bel|bil|byeji|bes|bas|shi|hek|inno|enno|yane|ya3ne|iza|lamma|kaman|kmn|3am|mshe|raye7|jaye|nhar|kel|eno|ana|inta|hiye|huwwe|howwe|mish|msh|ta2|2abel|sa7|ma7al|saret|7elo|7elwe|3anjad|tfaddal|yislam|zo2|wlek|wle|ya|habibi|habibte|ma32oul|2akid|akid|mbala|tfe|yiii|awww|heik)\b/i.test(text);
  if (francoNumbers || francoWords) return "franco";
  return "english";
}

function requirePositiveInt(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

function requireAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function badRequest(res, message) {
  res.statusCode = 400;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

function unauthorized(res, message = "Unauthorized") {
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

function forbidden(res, message = "Forbidden") {
  res.statusCode = 403;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

function notFound(res, message = "Not found") {
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

function internalError(res, message = "Internal server error") {
  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

function resolveItemId(item) {
  if (!item) return null;
  const id = Number(item.databaseId || item.item_id || item.menu_id || item.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function fetchMenuItemsByIds(conn, ids) {
  if (!ids.length) return {};
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await conn.query(
    `SELECT id, price, name FROM menuitems WHERE id IN (${placeholders})`,
    ids,
  );
  return rows.reduce((map, row) => {
    map[row.id] = row;
    return map;
  }, {});
}

async function validateOrderItems(conn, items, totalPrice) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items must be a non-empty array");
  }

  const ids = [...new Set(items.filter((item) => !item.isCustom).map(resolveItemId).filter(Boolean))];
  const menuItemMap = await fetchMenuItemsByIds(conn, ids);

  let computedTotal = 0;
  const validatedItems = [];

  for (const item of items) {
    const quantity = Number(item.quantity) || 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Each item quantity must be at least 1.");
    }

    const selectedExtras = item.selectedExtras ? JSON.stringify(item.selectedExtras) : null;
    const removedExtras = item.removedExtras ? JSON.stringify(item.removedExtras) : null;
    const specialNote = item.specialNote ? sanitizeText(String(item.specialNote)) : null;

    if (item.isCustom) {
      const price = requireAmount(item.price);
      if (price === null) {
        throw new Error(`Custom item \"${item.name || "custom item"}\" requires a valid price.`);
      }
      computedTotal += price * quantity;
      validatedItems.push({
        itemId: null,
        quantity,
        price,
        selectedExtras,
        removedExtras,
        specialNote,
      });
      continue;
    }

    const itemId = resolveItemId(item);
    if (!itemId) {
      throw new Error(`Missing menu item ID for item \"${item.name || "unknown"}\".`);
    }

    const menuItem = menuItemMap[itemId];
    if (!menuItem) {
      throw new Error(`Menu item ID ${itemId} not found.`);
    }

    const price = requireAmount(menuItem.price);
    if (price === null) {
      throw new Error(`Menu item \"${menuItem.name || item.name || itemId}\" has an invalid price.`);
    }

    computedTotal += price * quantity;
    validatedItems.push({
      itemId,
      quantity,
      price,
      selectedExtras,
      removedExtras,
      specialNote,
    });
  }

  if (Math.abs(requireAmount(totalPrice) - computedTotal) > 0.5) {
    throw new Error("Total price mismatch. The order total must match item prices.");
  }

  return validatedItems;
}

module.exports = {
  getCorsHeaders,
  setCorsHeaders,
  handleCors,
  ensureMethod,
  parseJsonBody,
  parseJsonSafe,
  sanitizeText,
  detectLanguage,
  requirePositiveInt,
  requireAmount,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  internalError,
  validateOrderItems,
};