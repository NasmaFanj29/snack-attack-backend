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

      if (!itemId && item.name) {
        const [menuRows] = await conn.query("SELECT id FROM menuitems WHERE name = ? LIMIT 1", [item.name]);
        if (menuRows.length) {
          itemId = menuRows[0].id;
          console.log(`🔍 Found ID for "${item.name}": ${itemId}`);
        }
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
      SELECT 
        o.id, o.total_price, o.status, o.created_at, o.table_id, o.payment_splits,
        u.full_name, u.phone_number 
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.user_id 
      ORDER BY o.created_at DESC
    `);

    if (orders.length === 0) return res.json([]);

    const orderIds = orders.map(o => o.id);

    let [allItems] = await pool.query(`
      SELECT 
        oi.id, oi.order_id, oi.item_id, oi.quantity, oi.price_at_time,
        oi.special_note, oi.removed_extras, oi.selected_extras,
        m.name, m.image, m.description
      FROM order_items oi
      LEFT JOIN menuitems m ON oi.item_id = m.id
      WHERE oi.order_id IN (${orderIds.map(() => '?').join(',')})
      ORDER BY oi.order_id, oi.id
    `, orderIds);

    const itemsMap = {};
    (allItems || []).forEach(item => {
      const parsed = {
        id: item.id,
        item_id: item.item_id,
        order_id: item.order_id,
        name: item.name || (item.special_note?.startsWith('Custom:') ? 'Custom Burger' : `Item #${item.item_id}`),
        image: item.image,
        description: item.description,
        quantity: item.quantity || 1,
        price_at_time: item.price_at_time || 0,
        special_note: item.special_note || null,
        selected_extras: item.selected_extras
          ? (typeof item.selected_extras === 'string' ? JSON.parse(item.selected_extras) : item.selected_extras)
          : [],
        removed_extras: item.removed_extras
          ? (typeof item.removed_extras === 'string' ? JSON.parse(item.removed_extras) : item.removed_extras)
          : [],
      };
      if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
      itemsMap[item.order_id].push(parsed);
    });

    const result = orders.map(order => ({
      id: order.id,
      table_id: order.table_id,
      status: order.status,
      created_at: order.created_at,
      total_price: order.total_price,
      payment_splits: order.payment_splits,
      full_name: order.full_name || 'Guest',
      phone_number: order.phone_number,
      items: itemsMap[order.id] || [],
      order_items: itemsMap[order.id] || [],
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

const GEMINI_MODEL = 'gemma-3-27b-it';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

app.post('/api/chat', async (req, res) => {
  const { messages, menuItems } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // ── 1. Fetch Custom Options from Database ─────────────────────
 let extrasText = "AVAILABLE CUSTOM OPTIONS (Bread, Protein, Cheese, Veggies, Sauce):\n";
  try {
    // T2akkadi mn esem l table hon b phpMyAdmin!
    const [extras] = await pool.query("SELECT category, name FROM extra_options"); 
    
    if (extras.length > 0) {
      extras.forEach(ext => {
        extrasText += `- ${ext.category}: ${ext.name}\n`;
      });
    } else {
      extrasText += "Custom options are currently unavailable.\n";
    }
  } catch (err) {
    console.error("❌ Error fetching extras:", err.message);
  }

  // ZIDI HAYDA L SATR LA TSHOUFI SHOU 3M YOUSAL LAL AI:
  console.log("🍔 EXTRAS SENT TO AI: \n", extrasText);

  // ── 2. Build dynamic menu list ────────────────────────────────
  let menuList = "AVAILABLE MENU ITEMS:\n";
  if (menuItems && menuItems.length > 0) {
    menuItems.forEach(item => {
      menuList += `- ${item.name} — $${item.price}\n`;
    });
  } else {
    menuList += "Menu is currently unavailable.\n";
  }

  // ── System Prompt ────────────────────────────────────────────
 // ── System Prompt ────────────────────────────────────────────
  const DYNAMIC_SYSTEM_PROMPT = `You are "Sami", the friendly and helpful assistant at Snack Attack restaurant.

CRITICAL RULE 1: LANGUAGE LOCK (NO ENGLISH ALLOWED)
- YOU MUST REPLY IN LEBANESE ARABIZI (Franco-Arabic) 100% OF THE TIME.
- EVEN IF THE USER WRITES IN PERFECT ENGLISH, YOU MUST REPLY IN LEBANESE ARABIZI.
- NEVER reply in formal English. NEVER.
- Use words like: "Tekram", "Ehh akid", "Shu 3abelak", "Sa7ten", "Yalla", "3a rasi".
- Keep replies short and conversational (1-3 sentences). Never write long paragraphs.
- ABSOLUTELY NO EMOJIS. Not a single one, ever.

CRITICAL RULE 2: SANDWICHES AND BURGERS ARE THE SAME
- WE SELL SANDWICHES AND BURGERS. They are the exact same thing here.
- IF A CUSTOMER ASKS FOR A SANDWICH, YOU MUST SAY "Ehh akid! Fina n3melak sandwich."
- NEVER EVER say "we don't have sandwiches". This is strictly forbidden.

CRITICAL RULE 3: CUSTOM INGREDIENTS
- READ the "AVAILABLE CUSTOM OPTIONS" carefully! 
- If a customer asks for chicken, turkey, or anything listed there, YOU MUST OFFER IT.
- Do not say "we only have beef" if chicken is in the options.
- Never invent ingredients that are not in the lists.

RESTAURANT INFORMATION:
- Name: Snack Attack
- Hours: Open every day, 11:00 AM to 11:00 PM

${menuList}
${extrasText}

ACTIONS — append silently at the end of your reply when needed:

1. Add a menu item to cart:
   CART_ADD:Exact Item Name
   (Use ONLY for items listed in AVAILABLE MENU ITEMS above)

2. Place a custom order:
   CUSTOM_ORDER:{"bread":"brioche","protein":"beef patty","cheese":"cheddar","veggies":"lettuce,tomato","sauce":"special sauce","notes":""}
   (Use ONLY when customer has described all parts of their custom order)

3. Connect customer to staff:
   NEED_ADMIN:reason
   (Use ONLY when customer explicitly asks for a person, or has a serious complaint)

IMPORTANT RULES FOR ACTIONS:
- For custom orders, collect all details first (bread, protein, cheese, veggies, sauce) before using CUSTOM_ORDER. If any detail is missing, ask for it first.
- One CART_ADD per message maximum.
- Never combine CART_ADD and CUSTOM_ORDER in the same response.
- Do not explain or mention the action tags to the customer — they are invisible backend signals.`;
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

    // Inject system prompt into first user message (Gemma has no system role)
    contents[0].parts[0].text =
      "SYSTEM INSTRUCTIONS:\n" +
      DYNAMIC_SYSTEM_PROMPT +
      "\n\n---\nCUSTOMER MESSAGE: " +
      contents[0].parts[0].text;

    const body = {
      contents,
      generationConfig: {
        temperature: 0.6,
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