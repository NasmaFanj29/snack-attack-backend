const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const pool = require('./db');
const path = require("path");
const app = express();
app.use(cors());
app.use(express.json());
app.use("/images", express.static(path.join(__dirname, "images")));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });



/* ================= PLACE ORDER (Robust) ================= */
app.post("/place-order", async (req, res) => {
  const { customer, table_id, total_price, items, payment_splits } = req.body;
  const phone = customer?.phone || "000000";
  const name = customer?.name || "Guest";

  console.log("📦 Place Order Request Received");

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    let [userRows] = await conn.query("SELECT user_id FROM users WHERE phone_number = ?", [phone]);
    let userId;
    if (!userRows.length) {
      const [u] = await conn.query("INSERT INTO users (full_name, phone_number, qlub_balance) VALUES (?, ?, 0)", [name, phone]);
      userId = u.insertId;
    } else {
      userId = userRows[0].user_id;
    }

    const [order] = await conn.query(
      `INSERT INTO orders (table_id, total_price, status, user_id, payment_splits) VALUES (?, ?, 'Requested', ?, ?)`,
      [table_id || 1, total_price, userId, JSON.stringify(payment_splits || [])]
    );
    const orderId = order.insertId;

    let savedCount = 0;

    for (const item of items || []) {
      let itemId = item.databaseId || item.item_id || item.menu_id || item.id || null;

      if (typeof itemId === 'string' && itemId.includes('custom')) {
        itemId = null;
      }

      // 3. Eza l ID NULL w hayda custom burger, byeghla2o bl order_items
      if (!itemId && item.isCustom) {
        console.log(`🍔 Custom order: "${item.name}" — saving with null item_id`);
        }
      

      // Handle custom burger orders (no DB item ID)
      if (!itemId && item.isCustom) {
        console.log(`🍔 Custom order: "${item.name}" — saving with null item_id`);
        const selectedExtras = item.selectedExtras ? JSON.stringify(item.selectedExtras) : null;
        const specialNote = item.customOrderData
          ? `Custom: ${JSON.stringify(item.customOrderData)}`
          : item.specialNote || null;

        await conn.query(
          `INSERT INTO order_items 
            (order_id, item_id, quantity, price_at_time, special_note, removed_extras, selected_extras)
           VALUES (?, NULL, ?, ?, ?, NULL, ?)`,
          [orderId, item.quantity || 1, item.price || 12.99, specialNote, selectedExtras]
        );
        savedCount++;
        continue;
      }

      if (!itemId) {
        console.warn(`⚠️ SKIPPED "${item.name}" — no ID found`);
        continue;
      }

      const selectedExtras = item.selectedExtras ? JSON.stringify(item.selectedExtras) : null;
      const removedExtras = item.removedExtras ? JSON.stringify(item.removedExtras) : null;
      const specialNote = item.specialNote || null;

      await conn.query(
        `INSERT INTO order_items 
          (order_id, item_id, quantity, price_at_time, special_note, removed_extras, selected_extras)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, itemId, item.quantity || 1, item.price || 0, specialNote, removedExtras, selectedExtras]
      );
      savedCount++;
    }

    await conn.commit();
    console.log(`✅ Order #${orderId} saved with ${savedCount} items.`);
    res.json({ success: true, orderId });

  } catch (err) {
    if (conn) await conn.rollback();
    console.error("❌ Place Order Error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

/* ================= ADMIN DASHBOARD ================= */
app.get("/admin/orders", async (req, res) => {
  try {
    const [orders] = await pool.query(`
      SELECT o.*, u.full_name, u.phone_number 
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.user_id 
      ORDER BY o.created_at DESC
    `);

    if (orders.length === 0) return res.json([]);

    const orderIds = orders.map(o => o.id);

    let [allItems] = await pool.query(`
      SELECT oi.*, m.name 
      FROM order_items oi
      LEFT JOIN menuitems m ON oi.item_id = m.id
      WHERE oi.order_id IN (${orderIds.map(() => '?').join(',')})
      ORDER BY oi.order_id, oi.id
    `, orderIds);

    const itemsMap = {};
    (allItems || []).forEach(item => {
      const parsed = {
        ...item,
        name: item.name || (item.special_note?.startsWith('Custom:') ? 'Custom Burger' : `Item #${item.item_id || item.id}`),
        selected_extras: parseJsonSafe(item.selected_extras) || [],
        removed_extras: parseJsonSafe(item.removed_extras) || []
      };
      if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
      itemsMap[item.order_id].push(parsed);
    });

    const result = orders.map(order => ({
      ...order,
      full_name: order.full_name || 'Guest',
      items: itemsMap[order.id] || [],
      order_items: itemsMap[order.id] || []
    }));

    res.json(result);
  } catch (err) {
    console.error("❌ Admin Fetch Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= HELPERS & OTHER ROUTES ================= */
function parseJsonSafe(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}

/* ================= UPDATE ORDER STATUS ================= */
app.put("/admin/orders/:id/status", async (req, res) => {
  try {
    const { status, payment_splits, replace_splits, reason } = req.body;
    let updates = [];
    let values = [];

    if (status) { updates.push("status = ?"); values.push(status); }
    if (payment_splits && replace_splits) { updates.push("payment_splits = ?"); values.push(JSON.stringify(payment_splits)); }
    if (reason) { updates.push("rejection_reason = ?"); values.push(reason); }

    if (updates.length === 0) return res.json({ success: true });

    values.push(req.params.id);
    await pool.query(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Update Status Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= DELETE ORDER ================= */
app.delete("/admin/orders/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM order_items WHERE order_id = ?", [req.params.id]);
    await pool.query("DELETE FROM orders WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Delete Order Error:", err);
    res.status(500).json({ error: err.message });
  }
});
/* ================= GET MENU ITEMS ================= */
app.get("/menu", async (req, res) => {
  try {
    // T2akkadi inno esem l table 3endek bl DB howe 'menuitems'
    const [items] = await pool.query("SELECT * FROM menuitems");
    res.json(items);
  } catch (err) {
    console.error("❌ Error fetching menu:", err);
    res.status(500).json({ error: "Failed to fetch menu items" });
  }
});

/* ================= GET ITEM EXTRAS ================= */
// L React 3m yotlob hayda l link, fa badna nrodd 3ley:
app.get("/item-extras/:id", async (req, res) => {
  try {
    // 3m nes7ab l data mn l table taba3ek l 7a2i2e yalli esmo 'extra_options'
    const [extras] = await pool.query("SELECT * FROM extra_options");
    res.json(extras);
  } catch (err) {
    console.error("❌ Error fetching item extras:", err.message);
    res.status(500).json({ error: "Failed to fetch extras" });
  }
});

app.get("/orders/:id", async (req, res) => {
  try {
    const [order] = await pool.query("SELECT * FROM orders WHERE id = ?", [req.params.id]);
    if (!order.length) return res.status(404).json({ error: "Not found" });
    const [items] = await pool.query(`SELECT oi.*, m.name FROM order_items oi LEFT JOIN menuitems m ON oi.item_id = m.id WHERE oi.order_id = ?`, [req.params.id]);
    const parsedItems = items.map(item => ({ ...item, selected_extras: parseJsonSafe(item.selected_extras), removed_extras: parseJsonSafe(item.removed_extras) }));
    res.json({ order: order[0], items: parsedItems });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


io.on("connection", (socket) => console.log("Socket connected:", socket.id));

// ═══════════════════════════════════════════════════════════════════
//  /api/chat  —  Gemma 3 (27B)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
//  /api/chat  —  Gemma 3 (27B)  — FIXED language detection
// ═══════════════════════════════════════════════════════════════════

const GEMINI_MODEL = 'gemma-3-27b-it';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

// ── 3-way language detector ──────────────────────────────────────
// Returns: 'arabic' | 'franco' | 'english'
function detectLanguage(text) {
  // 1. Arabic Unicode letters present → Arabic mode
  if (/[\u0600-\u06FF]/.test(text)) return 'arabic';

  // 2. Franco Lebanese markers:
  //    - Numbers used as Arabic sounds: 3(ع) 2(أ) 7(ح) 5(خ) 8(غ) 6(ط) 4(غ)
  //    - Common Lebanese Franco words
  const francoNumbers = /\b\w*[32785640]\w*\b/.test(text);
  const francoWords   = /\b(shu|yalla|kif|kifak|kifek|marhaba|ahla|ahlan|salam|3andi|3andak|baddak|bade|badi|hala2|halla2|hl2|kteer|kter|ktir|ma3|m3|la2|laa|fi|men|min|mn|3al|3l|lal|bl|bel|bil|byeji|bes|bas|shi|hek|inno|enno|yane|ya3ne|iza|lamma|kaman|kmn|3am|mshe|raye7|jaye|nhar|kel|eno|ana|inta|hiye|huwwe|howwe|mish|msh|ta2|2abel|sa7|ma7al|saret|7elo|7elwe|3anjad|tfaddal|yislam|yalla|zo2|wlek|wle|ya|habibi|habibte|ma32oul|2akid|akid|mbala|tfe|yiii|awww|heik|heidk)\b/i.test(text);

  if (francoNumbers || francoWords) return 'franco';

  // 3. Otherwise pure English
  return 'english';
}

app.post('/api/chat', async (req, res) => {
  const { messages, menuItems } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // ── 1. Fetch Custom Options from Database ─────────────────────
  let extrasText = "AVAILABLE CUSTOM OPTIONS (Bread, Protein, Cheese, Veggies, Sauce):\n";
  try {
    const [extras] = await pool.query("SELECT category, name FROM extra_options");
    if (extras.length > 0) {
      extras.forEach(ext => { extrasText += `- ${ext.category}: ${ext.name}\n`; });
    } else {
      extrasText += "Custom options are currently unavailable.\n";
    }
  } catch (err) {
    console.error("❌ Error fetching extras:", err.message);
  }

  // ── 2. Build dynamic menu list ────────────────────────────────
  let menuList = "AVAILABLE MENU ITEMS:\n";
  if (menuItems && menuItems.length > 0) {
    menuItems.forEach(item => { menuList += `- ${item.name} — $${item.price}\n`; });
  } else {
    menuList += "Menu is currently unavailable.\n";
  }

  // ── 3. System Prompt ──────────────────────────────────────────
  const DYNAMIC_SYSTEM_PROMPT = `You are "Sami", the friendly assistant at Snack Attack restaurant in Lebanon.

════════════════════════════════════════
LANGUAGE RULE — THE MOST IMPORTANT RULE
════════════════════════════════════════
You will receive a [LANGUAGE:xxx] tag before every user message. You MUST reply ONLY in that language.

[LANGUAGE:ARABIC]  → Reply using ONLY Arabic letters (أحرف عربية فقط). Zero English or Franco letters allowed.
[LANGUAGE:FRANCO]  → Reply using ONLY Franco Lebanese (Latin letters + numbers like 3,2,7). Zero Arabic letters allowed.
[LANGUAGE:ENGLISH] → Reply using ONLY pure English. Zero Arabic or Franco words allowed.

This rule overrides everything. Even if the previous messages were in another language, always match the LATEST [LANGUAGE:xxx] tag.
Never mix. Never explain. Just reply in the correct language.
════════════════════════════════════════

RESTAURANT INFORMATION:
- Name: Snack Attack, Hamra - Bliss Street
- Hours: Open every day, 11:00 AM to 11:00 PM
- Phone: 03 231 506

${menuList}
${extrasText}

CORE RULES:
1. Always use Lebanese dialect. Never use Fusha Arabic. Never say "دابا" or "واش".
2. SANDWICH = BURGER. They are the same thing. Never say you don't have sandwiches.
3. When customer asks for a sandwich/burger, FIRST ask for bread type only. Then collect: protein → cheese → veggies → sauce.
4. After order confirmed, ask: "Baddak fries ma3o?" then "Shu baddak teshrab?"
5. No emojis. Keep replies short and friendly.

ACTIONS — append silently at end of reply when needed:

1. Add a menu item to cart:
   CART_ADD:Exact Item Name

2. Place a custom order (collect ALL details first):
   CUSTOM_ORDER:{"bread":"brioche bun","protein":"beef patty","cheese":"cheddar","veggies":"lettuce,tomato","sauce":"garlic sauce","notes":""}

3. Connect to staff:
   NEED_ADMIN:reason
   (reasons: confused / complaint / request / offensive)

IMPORTANT: Never explain or mention the action tags to the customer.`;

  try {
    const mapped = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || ' ' }],
    }));

    // Merge consecutive same-role messages (Gemma requirement)
    const contents = [];
    for (const msg of mapped) {
      const last = contents[contents.length - 1];
      if (last && last.role === msg.role) {
        last.parts[0].text += '\n' + msg.parts[0].text;
      } else {
        contents.push({ ...msg, parts: [{ text: msg.parts[0].text }] });
      }
    }

    // Must start with user role
    while (contents.length > 0 && contents[0].role !== 'user') {
      contents.shift();
    }

    if (contents.length === 0) {
      return res.status(400).json({ error: 'Conversation empty after cleaning' });
    }

    // ── Inject [LANGUAGE:xxx] tag into every user turn ────────────
    // This is the key fix: clear, explicit tag the AI cannot ignore
    contents.forEach((msg) => {
      if (msg.role === 'user') {
        const lang = detectLanguage(msg.parts[0].text);
        const tag  = lang === 'arabic'  ? '[LANGUAGE:ARABIC] — Reply in Arabic letters ONLY. No Franco. No English.\n'
                   : lang === 'franco'  ? '[LANGUAGE:FRANCO] — Reply in Franco Lebanese ONLY. No Arabic letters. No pure English.\n'
                   :                      '[LANGUAGE:ENGLISH] — Reply in pure English ONLY. No Arabic. No Franco.\n';
        msg.parts[0].text = tag + msg.parts[0].text;
        console.log(`🌐 Detected: ${lang.toUpperCase()} for: "${msg.parts[0].text.slice(0, 60)}..."`);
      }
    });

    // Inject system prompt into the first message
    const firstText = contents[0].parts[0].text.replace(/\[LANGUAGE:.*?\].*?\n/, '');
    const langTag   = contents[0].parts[0].text.match(/\[LANGUAGE:.*?\].*?\n/)?.[0] || '';
    contents[0].parts[0].text =
      "SYSTEM INSTRUCTIONS:\n" +
      DYNAMIC_SYSTEM_PROMPT +
      "\n\n---\n" +
      langTag +
      "CUSTOMER MESSAGE: " +
      firstText;

    const body = {
      contents,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 400,
      },
    };

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Gemini API Error:', JSON.stringify(data, null, 2));
      return res.status(500).json({
        error: 'Gemini API error',
        details: data?.error?.message || data,
      });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!reply) {
      return res.status(500).json({ error: 'Empty response from Gemini' });
    }

    res.json({ reply });

  } catch (err) {
    console.error('❌ /api/chat crash:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));