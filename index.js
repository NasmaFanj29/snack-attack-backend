require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const xssClean = require("xss-clean");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const pool = require("./db");
const Stripe = require("stripe");

const {
  findStaffUser,
  verifyPassword,
  signToken,
  authenticateJWT,
  requireRole,
} = require("./middleware/auth");

const {
  validateRequest,
  placeOrderValidators,
  staffLoginValidators,
  paymentIntentValidators,
  chatValidators,
  orderIdParamValidator,
} = require("./middleware/validation");

const {
  parseJsonSafe,
  detectLanguage,
  sanitizeText,
  asyncHandler,
} = require("./utils");

const app = express();
app.set("trust proxy", 1);

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : ["http://localhost:3000"];

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS origin denied"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
};

app.use(helmet());
app.use(cors(corsOptions));
app.use(xssClean());
app.use(express.json({ limit: "10kb" }));
app.use("/images", express.static(path.join(__dirname, "images"), { maxAge: "7d", index: false }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again later." },
});
app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many chat requests. Slow down a bit." },
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2023-08-16" });
const webhookEventCache = new Set();

const dbName = pool.dbName;
const dbHost = pool.dbHost;
const dbPort = pool.dbPort;
const dbUser = pool.dbUser;
const dbWarnings = pool.dbWarnings;

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("WARNING: STRIPE_SECRET_KEY is not set. Stripe payments will not work until configured.");
}
if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not set. AI chat will be unavailable until configured.");
}
if (process.env.NODE_ENV === "production" && !process.env.CORS_ORIGINS) {
  console.warn("WARNING: CORS_ORIGINS is not configured. Restrict origins in production.");
}

function getEnvName() {
  return process.env.NODE_ENV ? process.env.NODE_ENV.toUpperCase() : "development";
}

function reportStartupIssues() {
  const issues = [];
  if (!process.env.DB_HOST) issues.push("DB_HOST");
  if (!process.env.DB_USER) issues.push("DB_USER");
  if (!process.env.DB_PASSWORD) issues.push("DB_PASSWORD");
  if (!process.env.DB_DATABASE && !process.env.DB_NAME) issues.push("DB_DATABASE or DB_NAME");
  if (!process.env.JWT_SECRET) issues.push("JWT_SECRET");

  if (issues.length) {
    console.warn(`WARNING: Backend is starting with missing configuration: ${issues.join(", ")}.`);
    console.warn("Make sure Render environment variables are configured before using production endpoints.");
  }
}

async function verifyDatabaseConnection() {
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !(process.env.DB_DATABASE || process.env.DB_NAME)) {
    console.error("❌ Database connection not attempted because required DB configuration is missing.");
    return false;
  }

  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log(`✅ Database connected successfully to ${dbHost}:${dbPort}/${dbName}`);
    return true;
  } catch (err) {
    const safeMessage = err && err.code ? `${err.code}` : err.message || "Unknown database error";
    console.error(`❌ Database connection failed: ${safeMessage}`);
    console.error("Please verify DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE/DB_NAME and network access.");
    return false;
  }
}

reportStartupIssues();

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

const presence = {}; // { room: Set<socketId> }

function getRoomName(type, id) {
  return `${type}:${id}`;
}

function resolveItemId(item) {
  const id = Number(item.databaseId || item.item_id || item.menu_id || item.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function fetchMenuItemsByIds(ids) {
  if (!ids.length) return {};
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT id, price, name FROM menuitems WHERE id IN (${placeholders})`,
    ids,
  );
  return rows.reduce((map, row) => {
    map[row.id] = row;
    return map;
  }, {});
}

async function validateOrderItems(conn, items, totalPrice) {
  const ids = [...new Set(items.filter((item) => !item.isCustom).map(resolveItemId).filter(Boolean))];
  const menuItemMap = await fetchMenuItemsByIds(ids);

  let computedTotal = 0;
  const validatedItems = [];

  for (const item of items) {
    const quantity = Number(item.quantity) || 1;
    if (quantity < 1) {
      throw new Error("Each item quantity must be at least 1.");
    }

    const selectedExtras = item.selectedExtras ? JSON.stringify(item.selectedExtras) : null;
    const removedExtras = item.removedExtras ? JSON.stringify(item.removedExtras) : null;
    const specialNote = item.specialNote ? sanitizeText(item.specialNote) : null;

    if (item.isCustom) {
      const price = Number(item.price);
      if (isNaN(price) || price <= 0) {
        throw new Error(`Custom item "${item.name || "custom item"}" requires a valid price.`);
      }
      computedTotal += price * quantity;
      validatedItems.push({
        itemId: null,
        name: item.name || "Custom Burger",
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
      throw new Error(`Missing menu item ID for item "${item.name || "unknown"}".`);
    }

    const menuItem = menuItemMap[itemId];
    if (!menuItem) {
      throw new Error(`Menu item ID ${itemId} not found.`);
    }

    const price = Number(menuItem.price);
    if (isNaN(price) || price <= 0) {
      throw new Error(`Menu item "${menuItem.name || item.name || itemId}" has an invalid price.`);
    }

    computedTotal += price * quantity;
    validatedItems.push({
      itemId,
      name: menuItem.name || item.name,
      quantity,
      price,
      selectedExtras,
      removedExtras,
      specialNote,
    });
  }

  if (Math.abs(Number(totalPrice) - computedTotal) > 0.5) {
    throw new Error("Total price mismatch. The order total must match item prices.");
  }

  return validatedItems;
}

/* ================================================================
   PLACE ORDER
   ================================================================ */
app.post(
  "/place-order",
  validateRequest(placeOrderValidators),
  asyncHandler(async (req, res) => {
    const { customer = {}, table_id, total_price, items, payment_splits } = req.body;
    const customerName = sanitizeText(customer.name?.trim() || "Guest");
    const phoneNumber = customer.phone?.trim() || null;

    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      let userId = null;
      if (phoneNumber) {
        const [userRows] = await conn.query("SELECT user_id FROM users WHERE phone_number = ?", [phoneNumber]);
        if (userRows.length) userId = userRows[0].user_id;
      }

      if (!userId) {
        const [userResult] = await conn.query(
          "INSERT INTO users (full_name, phone_number, qlub_balance) VALUES (?, ?, 0)",
          [customerName, phoneNumber],
        );
        userId = userResult.insertId;
      }

      const validatedItems = await validateOrderItems(conn, items, total_price);

      const [orderResult] = await conn.query(
        "INSERT INTO orders (table_id, total_price, status, user_id, payment_splits) VALUES (?, ?, 'Requested', ?, ?)",
        [table_id || 1, Number(total_price), userId, JSON.stringify(payment_splits || [])],
      );
      const orderId = orderResult.insertId;

      let savedCount = 0;
      for (const item of validatedItems) {
        await conn.query(
          `INSERT INTO order_items
             (order_id, item_id, quantity, price_at_time, special_note, removed_extras, selected_extras)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            item.itemId,
            item.quantity,
            item.price,
            item.specialNote,
            item.removedExtras,
            item.selectedExtras,
          ],
        );
        savedCount += 1;
      }

      await conn.commit();
      res.json({ success: true, orderId, savedCount });
    } catch (err) {
      if (conn) await conn.rollback();
      console.error("❌ Place Order Error:", err.message);
      res.status(500).json({ error: err.message });
    } finally {
      if (conn) conn.release();
    }
  }),
);

/* ================================================================
   ADMIN — GET ALL ORDERS
   ================================================================ */
app.get("/admin/orders", authenticateJWT, requireRole("admin", "waiter", "kitchen"), async (req, res) => {
  try {
    const [orders] = await pool.query(`
      SELECT o.*, u.full_name, u.phone_number
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.user_id
      ORDER BY o.created_at DESC
    `);

    if (orders.length === 0) return res.json([]);

    const orderIds = orders.map((o) => o.id);

    const [allItems] = await pool.query(`
      SELECT oi.*, m.name
      FROM order_items oi
      LEFT JOIN menuitems m ON oi.item_id = m.id
      WHERE oi.order_id IN (${orderIds.map(() => "?").join(",")})
      ORDER BY oi.order_id, oi.id
    `, orderIds);

    // Group items by order ID
    const itemsMap = {};
    (allItems || []).forEach((item) => {
      const parsed = {
        ...item,
        name: item.name
          || (item.special_note?.startsWith("Custom:") ? "Custom Burger" : `Item #${item.item_id || item.id}`),
        selected_extras: parseJsonSafe(item.selected_extras) || [],
        removed_extras:  parseJsonSafe(item.removed_extras)  || [],
      };
      if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
      itemsMap[item.order_id].push(parsed);
    });

    const result = orders.map((order) => ({
      ...order,
      full_name:   order.full_name || "Guest",
      items:       itemsMap[order.id] || [],
      order_items: itemsMap[order.id] || [],
    }));

    res.json(result);
  } catch (err) {
    console.error("❌ Admin Fetch Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================
   ADMIN — UPDATE ORDER STATUS
   ================================================================ */
app.put("/admin/orders/:id/status", authenticateJWT, requireRole("admin", "waiter", "kitchen"), async (req, res) => {
  try {
    const { status, payment_splits, replace_splits, reason } = req.body;
    const updates = [];
    const values  = [];

    if (status)                          { updates.push("status = ?");          values.push(status); }
    if (payment_splits && replace_splits){ updates.push("payment_splits = ?");   values.push(JSON.stringify(payment_splits)); }
    if (reason)                          { updates.push("rejection_reason = ?"); values.push(reason); }

    if (updates.length === 0) return res.json({ success: true });

    values.push(req.params.id);
    await pool.query(`UPDATE orders SET ${updates.join(", ")} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Update Status Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================
   ADMIN — DELETE ORDER
   ================================================================ */
app.delete("/admin/orders/:id", authenticateJWT, requireRole("admin"), async (req, res) => {
  try {
    await pool.query("DELETE FROM order_items WHERE order_id = ?", [req.params.id]);
    await pool.query("DELETE FROM orders WHERE id = ?",            [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Delete Order Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================
   MENU ITEMS
   ================================================================ */
app.get("/menu", async (req, res) => {
  try {
    const [items] = await pool.query("SELECT * FROM menuitems");
    res.json(items);
  } catch (err) {
    console.error("❌ Error fetching menu:", err);
    res.status(500).json({ error: "Failed to fetch menu items" });
  }
});

/* ================================================================
   EXTRAS
   Note: extra_options table has columns (id, name, price) only.
   Both routes return all extras — no per-item filtering needed.
   ================================================================ */
app.get("/extras", async (req, res) => {
  try {
    const [extras] = await pool.query("SELECT * FROM extra_options");
    res.json(extras);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(
  "/item-extras/:id",
  validateRequest(orderIdParamValidator),
  asyncHandler(async (req, res) => {
    const [extras] = await pool.query("SELECT * FROM extra_options");
    res.json({ itemId: Number(req.params.id), extras });
  }),
);

/* ================================================================
   SINGLE ORDER
   ================================================================ */
app.get(
  "/orders/:id",
  validateRequest(orderIdParamValidator),
  asyncHandler(async (req, res) => {
    const [order] = await pool.query("SELECT * FROM orders WHERE id = ?", [req.params.id]);
    if (!order.length) return res.status(404).json({ error: "Not found" });

    const [items] = await pool.query(`
      SELECT oi.*, m.name
      FROM order_items oi
      LEFT JOIN menuitems m ON oi.item_id = m.id
      WHERE oi.order_id = ?
    `, [req.params.id]);

    const parsedItems = items.map((item) => ({
      ...item,
      selected_extras: parseJsonSafe(item.selected_extras),
      removed_extras:  parseJsonSafe(item.removed_extras),
    }));

    res.json({ order: order[0], items: parsedItems });
  }),
);

/* ================================================================
   STAFF LOGIN
   ================================================================ */
app.post(
  "/staff/login",
  authLimiter,
  validateRequest(staffLoginValidators),
  asyncHandler(async (req, res) => {
    if (!process.env.JWT_SECRET) {
      return res.status(503).json({ error: "Authentication unavailable until JWT_SECRET is configured." });
    }

    const { username, password } = req.body;
    const user = findStaffUser(username);

    if (!verifyPassword(user, password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signToken({ username: user.username, role: user.role, name: user.name });
    res.json({ token, role: user.role, name: user.name });
  }),
);

/* ================================================================
   AI CHAT — Gemini Flash via Google Generative Language API
   Handles: custom burger orders, menu questions, staff escalation
   ================================================================ */
const GEMINI_MODEL = "gemini-2.0-flash";

app.post("/api/chat", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("⚠️ /api/chat requested but GEMINI_API_KEY is not configured.");
    return res.status(503).json({ error: "AI chat unavailable until GEMINI_API_KEY is configured." });
  }

  const { messages, menuItems } = req.body;

  if (!messages || !Array.isArray(messages)) {
    console.warn("⚠️ /api/chat received invalid messages:", typeof messages);
    return res.status(400).json({ error: "messages array required" });
  }

  // Fetch available add-on extras from DB (columns: id, name, price)
  let extrasText = "AVAILABLE ADD-ON EXTRAS:\n";
  try {
    const [extras] = await pool.query("SELECT name, price FROM extra_options");
    if (extras.length > 0) {
      extras.forEach((ext) => { extrasText += `- ${ext.name} (+$${Number(ext.price).toFixed(2)})\n`; });
    } else {
      extrasText += "No extras currently available.\n";
    }
  } catch (err) {
    console.error("❌ Error fetching extras:", err.message);
    extrasText += "Extras currently unavailable.\n";
  }

  // Build menu list from the payload sent by the frontend
  let menuList = "AVAILABLE MENU ITEMS:\n";
  if (menuItems && menuItems.length > 0) {
    menuItems.forEach((item) => { menuList += `- ${item.name} — $${item.price}\n`; });
  } else {
    menuList += "Menu is currently unavailable.\n";
  }

  const SYSTEM_PROMPT = `You are "Sami", the friendly assistant at Snack Attack restaurant in Lebanon.

════════════════════════════════════════
LANGUAGE RULE — HIGHEST PRIORITY
════════════════════════════════════════
You will receive a [LANGUAGE:xxx] tag before every user message. Always reply in that language.

[LANGUAGE:ARABIC]  → Arabic letters only (أحرف عربية). No English or Franco.
[LANGUAGE:FRANCO]  → Franco Lebanese only (Latin + numbers like 3,2,7). No Arabic letters.
[LANGUAGE:ENGLISH] → Pure English only. No Arabic or Franco.

Always match the LATEST [LANGUAGE:xxx] tag. Never mix languages.
════════════════════════════════════════

RESTAURANT INFO:
- Name: Snack Attack, Hamra - Bliss Street
- Hours: Every day, 11:00 AM to 11:00 PM
- Phone: 03 231 506

${menuList}
${extrasText}

══════════════════════════════════
ORDER FLOW — FOLLOW EXACTLY
══════════════════════════════════

STEP 1 — COLLECT ALL DETAILS (one question at a time):
  Ask: bread type → protein → cheese → veggies → sauce
  After that ask: "Baddak fries?" → then "Shu baddak teshrab?"

STEP 2 — CONFIRMATION (MANDATORY before any action):
  Once you have everything, show a clear summary and ask for confirmation.
  Example (Franco):
    "So checkup 3al sari3:
     - Sandwich: brioche bun + beef patty + cheddar + lettuce & tomato + garlic sauce
     - Fries: yes
     - Drink: Pepsi
     Mashi heik?"

  Example (Arabic):
    "للتأكيد قبل ما نكمل:
     - ساندويش: خبز بريوش + لحمة + شيدر + خس وبندورة + صوص ثوم
     - فريز: آه
     - مشروب: بيبسي
     هيك منيح؟"

  Example (English):
    "Let me confirm your order before we proceed:
     - Sandwich: brioche bun + beef patty + cheddar + lettuce & tomato + garlic sauce
     - Fries: yes
     - Drink: Pepsi
     Does that look right?"

STEP 3 — SEND ACTION + SUMMARY (only after customer confirms):
  Append the CUSTOM_ORDER action, then show the receipt summary.

  Franco example:
    "Perfect! Talab l order. Hayda moukhtasar talab-ak:

     ┌─────────────────────────────┐
     │  SNACK ATTACK — TABLE [X]   │
     ├─────────────────────────────┤
     │  Custom Burger              │
     │  • Bread  : Brioche Bun     │
     │  • Protein: Beef Patty      │
     │  • Cheese : Cheddar         │
     │  • Veggies: Lettuce, Tomato │
     │  • Sauce  : Garlic Sauce    │
     │                             │
     │  + Fries                    │
     │  + Pepsi                    │
     └─────────────────────────────┘
     Mashkour 3ala talabak! Ra7 youssal 2ariban."

  English example:
    "All set! Here's your order summary:

     ┌─────────────────────────────┐
     │  SNACK ATTACK — TABLE [X]   │
     ├─────────────────────────────┤
     │  Custom Burger              │
     │  • Bread  : Brioche Bun     │
     │  • Protein: Beef Patty      │
     │  • Cheese : Cheddar         │
     │  • Veggies: Lettuce, Tomato │
     │  • Sauce  : Garlic Sauce    │
     │                             │
     │  + Fries                    │
     │  + Pepsi                    │
     └─────────────────────────────┘
     Thank you! Your order is on its way."

  Arabic example:
    "تمام! هيدا ملخص طلبك:

     ┌─────────────────────────────┐
     │  SNACK ATTACK — طاولة [X]   │
     ├─────────────────────────────┤
     │  برغر مخصص                  │
     │  • خبز   : بريوش            │
     │  • لحمة  : بيف باتي         │
     │  • جبنة  : شيدر             │
     │  • خضار  : خس وبندورة      │
     │  • صوص   : ثوم              │
     │                             │
     │  + فريز                     │
     │  + بيبسي                    │
     └─────────────────────────────┘
     شكراً لطلبك! رح يوصل قريباً."

IMPORTANT RULES:
1. NEVER skip the confirmation step (Step 2). Always ask before placing.
2. NEVER place the order if the customer hasn't confirmed yet.
3. If customer says "no" or wants to change something, go back and ask what to fix.
4. Always use Lebanese dialect. Never use Fusha. Never say "دابا" or "واش".
5. SANDWICH = BURGER. Same thing. Never say you don't have sandwiches.
6. No emojis. Keep replies short and clear.

═══════════════════════════════════════
ACTIONS — append silently at end of message, never explain to customer
═══════════════════════════════════════

Add a regular menu item to cart:
  CART_ADD:Exact Item Name

Place a confirmed custom burger order:
  CUSTOM_ORDER:{"bread":"...","protein":"...","cheese":"...","veggies":"...","sauce":"...","notes":""}

Escalate to staff:
  NEED_ADMIN:reason
  (reasons: confused / complaint / request / offensive)`;

  try {
    // Map frontend message format to Gemini format
    const mapped = messages.map((m) => ({
      role:  m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content || " " }],
    }));

    // Gemini requires alternating turns — merge consecutive same-role messages
    const contents = [];
    for (const msg of mapped) {
      const last = contents[contents.length - 1];
      if (last && last.role === msg.role) {
        last.parts[0].text += "\n" + msg.parts[0].text;
      } else {
        contents.push({ ...msg, parts: [{ text: msg.parts[0].text }] });
      }
    }

    // Conversation must start with a user turn
    while (contents.length > 0 && contents[0].role !== "user") contents.shift();

    if (contents.length === 0)
      return res.status(400).json({ error: "Conversation empty after cleaning" });

    // Inject language tag into every user turn so the model always knows which language to use
    contents.forEach((msg) => {
      if (msg.role === "user") {
        const lang = detectLanguage(msg.parts[0].text);
        const tag  = lang === "arabic"
          ? "[LANGUAGE:ARABIC] — Reply in Arabic letters ONLY.\n"
          : lang === "franco"
          ? "[LANGUAGE:FRANCO] — Reply in Franco Lebanese ONLY.\n"
          : "[LANGUAGE:ENGLISH] — Reply in pure English ONLY.\n";

        msg.parts[0].text = tag + msg.parts[0].text;
        console.log(`🌐 Language: ${lang.toUpperCase()} — "${msg.parts[0].text.slice(0, 60)}..."`);
      }
    });

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    console.log(`📡 Calling Gemini API (${GEMINI_MODEL})...`);
    console.log(`📍 URL base: https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);


    let response;
    try {
      response = await fetch(GEMINI_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          generationConfig: {
            temperature:     0.5,
            maxOutputTokens: 500,
          },
        }),
      });
    } catch (fetchErr) {
      console.error("❌ Gemini fetch failed:", fetchErr.message);
      return res.status(503).json({ error: "Failed to reach Gemini API. Please try again." });
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      console.error("❌ Gemini response parse error:", parseErr.message);
      console.error("❌ Response status:", response.status);
      return res.status(502).json({ error: "Invalid response from Gemini API." });
    }

    if (!response.ok) {
      const errorMsg = data?.error?.message || JSON.stringify(data);
      console.error(`❌ Gemini API returned ${response.status}:`, errorMsg);
      console.error("❌ Full error response:", JSON.stringify(data, null, 2));
      
      if (response.status === 401 || response.status === 403) {
        return res.status(503).json({ error: "Gemini API authentication failed. Check GEMINI_API_KEY." });
      }
      if (response.status === 429) {
        return res.status(429).json({ error: "Gemini API rate limit exceeded. Please try again soon." });
      }
      
      return res.status(502).json({ error: "Gemini API error. Please try again." });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!reply) {
      console.error("❌ Gemini returned empty reply. Response:", JSON.stringify(data, null, 2));
      return res.status(502).json({ error: "Gemini API returned empty response." });
    }

    console.log(`✅ Gemini replied: "${reply.slice(0, 100)}..."`);
    res.json({ reply });
  } catch (err) {
    console.error("❌ /api/chat route error:", err.message, err.stack);
    res.status(500).json({ error: "Internal server error. Please try again." });
  }
});

/* ================================================================
   SOCKET.IO — Real-time presence tracking per order room
   ================================================================ */

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next();

  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET || "");
    return next();
  } catch (err) {
    return next(new Error("Unauthorized socket connection"));
  }
});

io.on("connection", (socket) => {

  socket.on("chatMessage", ({ tableId, message }) => {
    if (!tableId || typeof message !== "string") return;
    const room = getRoomName("table", tableId);
    const sanitizedMessage = sanitizeText(message);
    io.to(room).emit("chatMessage", {
      message: sanitizedMessage,
      sender: socket.user?.name || "Guest",
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("joinOrder", (orderId) => {
    const room = getRoomName("order", orderId);
    socket.join(room);
    if (!presence[room]) presence[room] = new Set();
    presence[room].add(socket.id);
    io.to(room).emit("presenceUpdate", { count: presence[room].size });
  });

  socket.on("disconnect", () => {
    for (const [room, set] of Object.entries(presence)) {
      if (set.has(socket.id)) {
        set.delete(socket.id);
        if (set.size === 0) {
          delete presence[room];
        } else {
          io.to(room).emit("presenceUpdate", { count: set.size });
        }
      }
    }
  });
});

/* ================================================================
   STRIPE — Create Payment Intent
   ================================================================ */
app.post(
  "/create-payment-intent",
  validateRequest(paymentIntentValidators),
  asyncHandler(async (req, res) => {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: "Payment processing unavailable until STRIPE_SECRET_KEY is configured." });
    }

    const { amount, orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: "orderId is required" });
    }

    const [orderRows] = await pool.query("SELECT total_price FROM orders WHERE id = ?", [orderId]);
    if (!orderRows.length) {
      return res.status(404).json({ error: "Order not found" });
    }

    const expectedAmount = Number(orderRows[0].total_price);
    if (Math.abs(expectedAmount - Number(amount)) > 0.5) {
      return res.status(400).json({ error: "Amount mismatch" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(expectedAmount * 100),
      currency: "usd",
      metadata: { orderId: orderId.toString() },
      automatic_payment_methods: { enabled: true },
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  }),
);

/* ================================================================
   START SERVER
   ================================================================ */
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT} [${getEnvName()}]`);
  const dbOk = await verifyDatabaseConnection();
  if (!dbOk) {
    console.warn("⚠️ Backend is running, but database access is not available. Some routes may fail until DB configuration is fixed.");
  }
});