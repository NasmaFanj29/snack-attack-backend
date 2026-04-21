const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());  // ← CRITICAL - enables JSON parsing

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

    // 1. User Handling
    let [userRows] = await conn.query("SELECT user_id FROM users WHERE phone_number = ?", [phone]);
    let userId;
    if (!userRows.length) {
      const [u] = await conn.query("INSERT INTO users (full_name, phone_number, qlub_balance) VALUES (?, ?, 0)", [name, phone]);
      userId = u.insertId;
    } else {
      userId = userRows[0].user_id;
    }

    // 2. Insert Order
    const [order] = await conn.query(
      `INSERT INTO orders (table_id, total_price, status, user_id, payment_splits) VALUES (?, ?, 'Requested', ?, ?)`,
      [table_id || 1, total_price, userId, JSON.stringify(payment_splits || [])]
    );
    const orderId = order.insertId;

    // 3. Insert Items (Smart Logic)
    let savedCount = 0;
    
    for (const item of items || []) {
      // أ. محاولة جلب ID من الفرونت إند
      let itemId = item.databaseId || item.item_id || item.menu_id || item.id || null;

      // ب. حل سحري: إذا ID مش موجود، ندور عليه بالقاعدة عن طريق الاسم
      if (!itemId && item.name) {
         const [menuRows] = await conn.query("SELECT id FROM menuitems WHERE name = ? LIMIT 1", [item.name]);
         if (menuRows.length) {
           itemId = menuRows[0].id;
           console.log(`🔍 Found ID for "${item.name}": ${itemId}`);
         }
      }

      if (!itemId) {
        console.warn(`⚠️ SKIPPED "${item.name}" — no ID found in DB or Request`);
        continue;
      }

      // ج. تجهيز البيانات
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

/* ================= ADMIN DASHBOARD (Debugged) ================= */
// ✅ REPLACE the /admin/orders endpoint in server.js with this:

app.get("/admin/orders", async (req, res) => {
  try {
    console.log("📦 Fetching all orders...");
    
    // 1. Fetch Orders
    const [orders] = await pool.query(`
      SELECT 
        o.id, 
        o.total_price, 
        o.status, 
        o.created_at, 
        o.table_id, 
        o.payment_splits,
        u.full_name, 
        u.phone_number 
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.user_id 
      ORDER BY o.created_at DESC
    `);

    if (orders.length === 0) {
      console.log("ℹ️ No orders found");
      return res.json([]);
    }

    console.log(`📋 Found ${orders.length} orders`);

    // 2. Fetch ALL Items for ALL orders in ONE query
    const orderIds = orders.map(o => o.id);
    
    let [allItems] = await pool.query(`
      SELECT 
        oi.id,
        oi.order_id, 
        oi.item_id, 
        oi.quantity, 
        oi.price_at_time,
        oi.special_note,
        oi.removed_extras,
        oi.selected_extras,
        m.name,
        m.image,
        m.description
      FROM order_items oi
      LEFT JOIN menuitems m ON oi.item_id = m.id
      WHERE oi.order_id IN (${orderIds.map(() => '?').join(',')})
      ORDER BY oi.order_id, oi.id
    `, orderIds);

    console.log(`🔍 Found ${allItems.length} items total across all orders`);

    // 3. Map items and parse JSON fields
    const itemsMap = {};
    
    (allItems || []).forEach(item => {
      const parsed = {
        id: item.id,
        item_id: item.item_id,
        order_id: item.order_id,
        name: item.name || `Item #${item.item_id}`,
        image: item.image,
        description: item.description,
        quantity: item.quantity || 1,
        price_at_time: item.price_at_time || 0,
        special_note: item.special_note || null,
        selected_extras: item.selected_extras 
          ? (typeof item.selected_extras === 'string' 
              ? JSON.parse(item.selected_extras) 
              : item.selected_extras)
          : [],
        removed_extras: item.removed_extras 
          ? (typeof item.removed_extras === 'string' 
              ? JSON.parse(item.removed_extras) 
              : item.removed_extras)
          : []
      };
      
      if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
      itemsMap[item.order_id].push(parsed);
    });

    // 4. Combine orders with their items
    const result = orders.map(order => ({
      id: order.id,
      table_id: order.table_id,
      status: order.status,
      created_at: order.created_at,
      total_price: order.total_price,
      payment_splits: order.payment_splits,
      full_name: order.full_name || 'Guest',
      phone_number: order.phone_number,
      // ✅ Include items in multiple formats for compatibility
      items: itemsMap[order.id] || [],
      order_items: itemsMap[order.id] || []  // Backup name
    }));

    console.log(`✅ Returning ${result.length} orders with items`);
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
//  /api/chat  —  Groq (Llama 3) endpoint
//  ENV variable required on Render:
//    GROQ_API_KEY = gsk_...
// ═══════════════════════════════════════════════════════════════════

const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are "Sami", a friendly AI assistant for Snack Attack restaurant.

PERSONALITY:
- Warm, fun, uses emojis naturally
- Understands Lebanese Arabizi: bde = I want, shu = what, kifak = how are you,
  la2 = no, aywa/ee = yes, ktir = very, mnee7 = good, habibi = my friend,
  yalla = let's go, tayeb = okay, eza = if, maa = with
- Keep replies SHORT and punchy (2-4 sentences max)
- Never say "I'm an AI" — just be Sami

MENU (use these exact names):
- Classic Smash Burger — $9.99
- Crispy Chicken Sandwich — $10.99
- Double Smash — $12.99
- Fries — $3.99
- Onion Rings — $4.49
- Milkshake — $5.99

ACTIONS (append to your reply when needed):
1. Add to cart:         CART_ADD:Item Name
2. Custom burger order: CUSTOM_ORDER:{"bread":"brioche","protein":"beef","cheese":"cheddar","veggies":"lettuce,tomato","sauce":"special","notes":""}
   - bread options: brioche, sesame, sourdough
   - protein: beef, chicken, veggie
   - cheese: cheddar, american, none
   - sauce: special, bbq, mayo, none
3. Escalate to staff:   NEED_ADMIN:reason
   - reasons: confused | complaint | offensive | help

RULES:
- Only use CART_ADD when customer clearly wants to order something
- Only use CUSTOM_ORDER when they describe a custom/build-your-own burger
- Only use NEED_ADMIN if you truly can't help or they ask for a human
- Never add multiple CART_ADD lines — one per message
- Never make up menu items not listed above`;

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  if (!process.env.GROQ_API_KEY) {
    console.error('❌ GROQ_API_KEY missing from environment!');
    return res.status(500).json({ error: 'Server configuration error — API key missing' });
  }

  try {
    // 1. Format messages for Groq (OpenAI style format)
    const formattedMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map((m) => ({
        role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content || ' ' 
      }))
    ];

    console.log(`📤 Groq request — ${formattedMessages.length} messages`);

    // 2. Call Groq SDK
    const chatCompletion = await groq.chat.completions.create({
      messages: formattedMessages,
      model: "llama3-8b-8192", // Fast Llama 3 model
      temperature: 0.75,
      max_tokens: 400,
    });

    const reply = chatCompletion.choices[0]?.message?.content?.trim();

    if (!reply) {
      console.warn('⚠️ Groq returned empty reply:', chatCompletion);
      return res.status(500).json({ error: 'Empty response from Groq' });
    }

    console.log(`✅ Groq reply (${reply.length} chars)`);
    res.json({ reply });

  } catch (err) {
    console.error('❌ /api/chat crash:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));