require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const pool = require('./db');
const path = require("path");
const Stripe = require("stripe");
const app = express();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
app.use(cors());
app.use(express.json());
app.use("/images", express.static(path.join(__dirname, "images")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

/* ================================================================
   PLACE ORDER
   ================================================================ */
app.post("/place-order", async (req, res) => {
  const { customer, table_id, total_price, items, payment_splits } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "No items in order" });
  if (isNaN(Number(total_price)) || Number(total_price) <= 0)
    return res.status(400).json({ error: "Invalid total price" });
  console.log("📦 Place Order Request Received");

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const name  = customer?.name  || "Guest";
const phone = customer?.phone || "0000000000";

// ✅ ADD THIS LINE BACK
let [userRows] = await conn.query(
  "SELECT user_id FROM users WHERE phone_number = ?", [phone]
);

let userId;
if (!userRows.length) {
  const [u] = await conn.query(
    "INSERT INTO users (full_name, phone_number, qlub_balance) VALUES (?, ?, 0)",
    [name, phone]
  );
  userId = u.insertId;
} else {
  userId = userRows[0].user_id;
}

    // Create order record
    const [order] = await conn.query(
      `INSERT INTO orders (table_id, total_price, status, user_id, payment_splits)
       VALUES (?, ?, 'Requested', ?, ?)`,
      [table_id || 1, total_price, userId, JSON.stringify(payment_splits || [])]
    );
    const orderId = order.insertId;

    let savedCount = 0;

    for (const item of items || []) {
      let itemId = item.databaseId || item.item_id || item.menu_id || item.id || null;

      // Custom burger IDs contain the word "custom" — treat as null
      if (typeof itemId === 'string' && itemId.includes('custom')) {
        itemId = null;
      }

      if (!itemId && item.isCustom) {
        // Save custom burger with null item_id
        console.log(`🍔 Custom burger: "${item.name}" — saving with null item_id`);
        const selectedExtras = item.selectedExtras
          ? JSON.stringify(item.selectedExtras) : null;
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
        console.warn(`⚠️ SKIPPED "${item.name}" — no item ID`);
        continue;
      }

      // Regular menu item
      const selectedExtras = item.selectedExtras ? JSON.stringify(item.selectedExtras) : null;
      const removedExtras  = item.removedExtras  ? JSON.stringify(item.removedExtras)  : null;
      const specialNote    = item.specialNote    || null;

      await conn.query(
        `INSERT INTO order_items
           (order_id, item_id, quantity, price_at_time, special_note, removed_extras, selected_extras)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, itemId, item.quantity || 1, item.price || 0, specialNote, removedExtras, selectedExtras]
      );
      savedCount++;
    }

    await conn.commit();
    console.log(`✅ Order #${orderId} saved — ${savedCount} item(s).`);
    res.json({ success: true, orderId });

  } catch (err) {
    if (conn) await conn.rollback();
    console.error("❌ Place Order Error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

/* ================================================================
   ADMIN — GET ALL ORDERS
   ================================================================ */
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

    const [allItems] = await pool.query(`
      SELECT oi.*, m.name
      FROM order_items oi
      LEFT JOIN menuitems m ON oi.item_id = m.id
      WHERE oi.order_id IN (${orderIds.map(() => '?').join(',')})
      ORDER BY oi.order_id, oi.id
    `, orderIds);

    // Group items by order
    const itemsMap = {};
    (allItems || []).forEach(item => {
      const parsed = {
        ...item,
        name: item.name
          || (item.special_note?.startsWith('Custom:') ? 'Custom Burger' : `Item #${item.item_id || item.id}`),
        selected_extras: parseJsonSafe(item.selected_extras) || [],
        removed_extras:  parseJsonSafe(item.removed_extras)  || [],
      };
      if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
      itemsMap[item.order_id].push(parsed);
    });

    const result = orders.map(order => ({
      ...order,
      full_name:   order.full_name || 'Guest',
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
app.put("/admin/orders/:id/status", async (req, res) => {
  try {
    const { status, payment_splits, replace_splits, reason } = req.body;
    const updates = [];
    const values  = [];

    if (status)                         { updates.push("status = ?");           values.push(status); }
    if (payment_splits && replace_splits){ updates.push("payment_splits = ?");   values.push(JSON.stringify(payment_splits)); }
    if (reason)                         { updates.push("rejection_reason = ?");  values.push(reason); }

    if (updates.length === 0) return res.json({ success: true });

    values.push(req.params.id);
    await pool.query(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Update Status Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================
   ADMIN — DELETE ORDER
   ================================================================ */
app.delete("/admin/orders/:id", async (req, res) => {
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
   GET MENU ITEMS
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
   GET ITEM EXTRAS
   ================================================================ */
// ✅ Fix — filter by item if you have a join table, or keep global but be intentional
// If extras are global (same for all items), just rename the route to /extras
app.get("/extras", async (req, res) => {
  const [extras] = await pool.query("SELECT * FROM extra_options");
  res.json(extras);
});

// ضيفه بعد route الـ /extras الموجود
app.get("/item-extras/:id", async (req, res) => {
  try {
    const [extras] = await pool.query("SELECT * FROM extra_options");
    res.json(extras);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* ================================================================
   GET SINGLE ORDER
   ================================================================ */
app.get("/orders/:id", async (req, res) => {
  try {
    const [order] = await pool.query("SELECT * FROM orders WHERE id = ?", [req.params.id]);
    if (!order.length) return res.status(404).json({ error: "Not found" });

    const [items] = await pool.query(`
      SELECT oi.*, m.name
      FROM order_items oi
      LEFT JOIN menuitems m ON oi.item_id = m.id
      WHERE oi.order_id = ?
    `, [req.params.id]);

    const parsedItems = items.map(item => ({
      ...item,
      selected_extras: parseJsonSafe(item.selected_extras),
      removed_extras:  parseJsonSafe(item.removed_extras),
    }));

    res.json({ order: order[0], items: parsedItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ✅ server.js — add a simple login endpoint
app.post("/staff/login", (req, res) => {
  const { username, password } = req.body;
  const USERS = [
  { username: 'admin',    password: 'snack2024',   role: 'admin',   name: 'Admin' },
  { username: 'waiter1',  password: 'waiter123',   role: 'waiter',  name: 'Ahmad' },
  { username: 'waiter2',  password: 'waiter456',   role: 'waiter',  name: 'Sara' },
  { username: 'kitchen',  password: 'kitchen123',  role: 'kitchen', name: 'Kitchen Team' },];

  const found = USERS.find(u => u.username === username && u.password === password);
  if (!found) return res.status(401).json({ error: "Invalid credentials" });
  res.json({ role: found.role, name: found.name });
});
/* ================================================================
   HELPERS
   ================================================================ */
function parseJsonSafe(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}

function detectLanguage(text) {
  // Arabic Unicode block
  if (/[\u0600-\u06FF]/.test(text)) return 'arabic';

  // Franco Lebanese: digits used as sounds (3=ع, 2=أ, 7=ح, 5=خ, 8=غ)
  // or common Lebanese Franco vocabulary
  const francoNumbers = /\b\w*[32785640]\w*\b/.test(text);
  const francoWords   = /\b(shu|yalla|kif|kifak|kifek|marhaba|ahla|ahlan|salam|3andi|3andak|baddak|bade|badi|hala2|halla2|hl2|kteer|kter|ktir|ma3|m3|la2|laa|fi|men|min|mn|3al|3l|lal|bl|bel|bil|byeji|bes|bas|shi|hek|inno|enno|yane|ya3ne|iza|lamma|kaman|kmn|3am|mshe|raye7|jaye|nhar|kel|eno|ana|inta|hiye|huwwe|howwe|mish|msh|ta2|2abel|sa7|ma7al|saret|7elo|7elwe|3anjad|tfaddal|yislam|yalla|zo2|wlek|wle|ya|habibi|habibte|ma32oul|2akid|akid|mbala|tfe|yiii|awww|heik|heidk)\b/i.test(text);

  if (francoNumbers || francoWords) return 'franco';

  return 'english';
}

app.post('/api/chat', async (req, res) => {
  const { messages, menuItems } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // ── Fetch extras from DB ──────────────────────────────────────
 let extrasText = "AVAILABLE ADD-ON EXTRAS:\n";
try {
  const [extras] = await pool.query("SELECT name, price FROM extra_options");
  if (extras.length > 0) {
    extras.forEach(ext => { extrasText += `- ${ext.name} (+$${ext.price})\n`; });
  } else {
    extrasText += "No extras currently available.\n";
  }
} catch (err) {
  console.error("❌ Error fetching extras:", err.message);
}

  // ── Build menu list ───────────────────────────────────────────
  let menuList = "AVAILABLE MENU ITEMS:\n";
  if (menuItems && menuItems.length > 0) {
    menuItems.forEach(item => { menuList += `- ${item.name} — $${item.price}\n`; });
  } else {
    menuList += "Menu currently unavailable.\n";
  }

  // ── System prompt ─────────────────────────────────────────────
  const SYSTEM_PROMPT = `You are "Sami", the friendly assistant at Snack Attack restaurant in Lebanon.

════════════════════════════════════════
LANGUAGE RULE — HIGHEST PRIORITY
════════════════════════════════════════
You will receive a [LANGUAGE:xxx] tag before every user message. Always reply in that language.

[LANGUAGE:ARABIC]  → Arabic letters only. No English or Franco.
[LANGUAGE:FRANCO]  → Franco Lebanese only (Latin + numbers like 3,2,7). No Arabic letters.
[LANGUAGE:ENGLISH] → Pure English only.

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

STEP 3 — SEND ACTION + SUMMARY (only after customer confirms):
  Append CUSTOM_ORDER action then show the receipt box.

  Franco example:
    "Perfect! Hayda moukhtasar talab-ak:
     ┌─────────────────────────────┐
     │  SNACK ATTACK — TABLE [X]   │
     ├─────────────────────────────┤
     │  Custom Burger              │
     │  • Bread : Brioche Bun      │
     │  • Protein: Beef Patty      │
     │  • Cheese : Cheddar         │
     │  • Veggies: Lettuce, Tomato │
     │  • Sauce  : Garlic Sauce    │
     │  + Fries                    │
     │  + Pepsi                    │
     └─────────────────────────────┘
     Mashkour 3ala talabak! Ra7 youssal 2ariban."

IMPORTANT RULES:
1. NEVER skip the confirmation step. Always ask before placing.
2. NEVER place the order if the customer hasn't confirmed.
3. SANDWICH = BURGER. Same thing. Never say you don't have sandwiches.
4. Always use Lebanese dialect. Never use Fusha.
5. No emojis. Keep replies short and clear.

═══════════════════
ACTIONS (append at end of message, never explain to customer)
═══════════════════
Add regular item:        CART_ADD:Exact Item Name
Place confirmed order:   CUSTOM_ORDER:{"bread":"...","protein":"...","cheese":"...","veggies":"...","sauce":"...","notes":""}
Call staff:              NEED_ADMIN:reason   (reasons: confused / complaint / request / offensive)`;


  // ── Inject language tag into user messages ────────────────────
  const processedMessages = messages.map((msg) => {
    if (msg.role !== 'user') return msg;
    const lang = detectLanguage(msg.content);
    const tag =
      lang === 'arabic'  ? '[LANGUAGE:ARABIC] — Reply in Arabic ONLY.\n' :
      lang === 'franco'  ? '[LANGUAGE:FRANCO] — Reply in Franco Lebanese ONLY.\n' :
                           '[LANGUAGE:ENGLISH] — Reply in English ONLY.\n';
    return { role: 'user', content: tag + msg.content };
  });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: processedMessages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Claude API Error:', JSON.stringify(data, null, 2));
      return res.status(500).json({ error: 'Claude API error', details: data?.error?.message });
    }

    const reply = data.content?.[0]?.text?.trim();
    if (!reply) return res.status(500).json({ error: 'Empty response from Claude' });

    console.log(`✅ Claude replied: "${reply.slice(0, 80)}..."`);
    res.json({ reply });

  } catch (err) {
    console.error('❌ /api/chat crash:', err.message);
    res.status(500).json({ error: err.message });
  }
});
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));