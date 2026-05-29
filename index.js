require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const { v4: uuidv4 } = require("uuid");

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


app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors(corsOptions));
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature failed:", err.message);
      return res.sendStatus(400);
    }

    // FIX (Issue 4): Idempotency — ignore events we've already processed
    if (webhookEventCache.has(event.id)) {
      console.log(`Webhook event ${event.id} already processed, skipping.`);
      return res.json({ received: true });
    }
    webhookEventCache.add(event.id);

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const orderId = paymentIntent.metadata.orderId;

      if (!orderId) {
        console.error("Webhook: payment_intent.succeeded missing orderId in metadata");
        return res.json({ received: true });
      }

      await pool.query(
        "UPDATE orders SET status = 'Paid' WHERE id = ?",
        [orderId]
      );
      console.log(`✅ Order ${orderId} marked as Paid via webhook`);
    }

    res.json({ received: true });
  }
);
app.use(express.json({ limit: "100kb" }));
app.use("/images", express.static(path.join(__dirname, "images"), { maxAge: "7d", index: false }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 200 : 2000,
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
  max: 10, // ← من 15 لـ 10
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many chat requests. Slow down a bit." },
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2023-08-16" });

// FIX (Issue 4): Cache is now wired into the webhook handler above
const webhookEventCache = new Set();
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
  process.env.GEMINI_API_KEY_6,
  process.env.GEMINI_API_KEY_7,
  process.env.GEMINI_API_KEY_8,
].filter(Boolean);

let geminiKeyIndex = 0;
const getGeminiKey = (offset = 0) => {
  return GEMINI_KEYS[(geminiKeyIndex + offset) % GEMINI_KEYS.length];
};

const dbName = pool.dbName;
const dbHost = pool.dbHost;
const dbPort = pool.dbPort;
const dbUser = pool.dbUser;
const dbWarnings = pool.dbWarnings;

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("WARNING: STRIPE_SECRET_KEY is not set. Stripe payments will not work until configured.");
}
if (GEMINI_KEYS.length === 0) {
  console.warn("WARNING: No GEMINI API keys configured. AI chat will be unavailable.");
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
  if (!process.env.STRIPE_WEBHOOK_SECRET) issues.push("STRIPE_WEBHOOK_SECRET");

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
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

const presence = {}; // { room: Set<socketId> }

// ⭐ MAKE PAYMENT ROUTES ABLE TO ACCESS SOCKET.IO
app.set('io', io);

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

    const extrasTotal = Array.isArray(item.selectedExtras)
      ? item.selectedExtras.reduce((s, e) => s + Number(e.price || 0), 0)
      : 0;

    const selectedExtras = item.selectedExtras ? JSON.stringify(item.selectedExtras) : null;
    const removedExtras = item.removedExtras ? JSON.stringify(item.removedExtras) : null;
    const specialNote = item.specialNote ? sanitizeText(item.specialNote) : null;
    const isCustom = Boolean(item.isCustom);

    let itemPrice = 0;
    if (isCustom) {
      itemPrice = Number(item.price) || 0;
    } else {
      const resolvedId = resolveItemId(item);
      if (!resolvedId || !menuItemMap[resolvedId]) {
        throw new Error(`Menu item ${resolveItemId(item)} not found.`);
      }
      itemPrice = Number(menuItemMap[resolvedId].price) || 0;
    }

    const lineTotal = (itemPrice + extrasTotal) * quantity;
    computedTotal += lineTotal;

    validatedItems.push({
      isCustom,
      ...(isCustom && { customName: item.name }),
      ...(!isCustom && { menu_id: resolveItemId(item) }),
      quantity,
      price: itemPrice,
      extrasTotal,
      lineTotal,
      selectedExtras,
      removedExtras,
      specialNote,
    });
  }
  // أضفه مؤقتاً جوا validateOrderItems قبل التحقق من الـ total
console.log("DEBUG computedTotal:", computedTotal);
console.log("DEBUG totalPrice received:", totalPrice);
console.log("DEBUG with VAT:", computedTotal * 1.11);

// ✅ AFTER
const computedWithVAT = computedTotal * 1.11;
const totalDifference = Math.abs(computedWithVAT - totalPrice);
if (totalDifference > 0.5) {
  throw new Error(`Cart total mismatch. Expected ${computedWithVAT.toFixed(2)}, got ${totalPrice.toFixed(2)}.`);
}

  return validatedItems;
}

app.get("/", (req, res) => {
  res.json({
    message: "🍽️ Snack Attack backend is running!",
    environment: getEnvName(),
    endpoints: [
      "POST /api/staff/login",
      "GET /api/menu",
      "GET /api/extras",
      "POST /api/orders",
      "GET /api/admin/orders",
      "POST /api/chat",
    ],
  });
});

app.post(
  "/api/staff/login",
  validateRequest(staffLoginValidators),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    
    console.log("\n========== LOGIN START ==========");
    console.log("LOGIN JWT_SECRET:", process.env.JWT_SECRET);
    console.log("JWT_SECRET length:", process.env.JWT_SECRET?.length);
    
    const user = await findStaffUser(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      console.log("❌ Invalid credentials for:", username);
      console.log("========== LOGIN END ==========\n");
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    const token = signToken(user);
    console.log("GENERATED TOKEN:", token);
    console.log("✅ Login successful for:", username, "Role:", user.role);
    console.log("========== LOGIN END ==========\n");
    
    // ✅ FIXED: Send clean response without passwordHash
    res.json({ 
      token, 
      role: user.role,
      name: user.name,
      username: user.username
    });
  }),
);

app.put("/orders/:id/confirm-payment", async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus } = req.body;

    const validStatuses = ["Paid", "Pending", "Failed"];
    if (!validStatuses.includes(paymentStatus)) {
      return res.status(400).json({ error: "Invalid payment status" });
    }

    await pool.query("UPDATE orders SET payment_status = ?, updated_at = NOW() WHERE id = ?", [
      paymentStatus,
      id,
    ]);

    res.json({
      success: true,
      message: `Order ${id} payment status updated to ${paymentStatus}`,
    });
  } catch (err) {
    console.error("Error updating order payment:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/orders", authenticateJWT, requireRole("admin", "waiter", "kitchen"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
         o.*,
         GROUP_CONCAT(
           JSON_OBJECT(
             'payment_id', ps.payment_id,
             'payer_name', ps.payer_name,
             'payer_phone', ps.payer_phone,
             'amount_usd', ps.amount_usd,
             'currency', ps.currency,
             'method', ps.method,
             'payment_status', ps.payment_status,
             'stripe_card_brand', ps.stripe_card_brand,
             'stripe_card_last4', ps.stripe_card_last4,
             'confirmed_at', ps.confirmed_at
           )
         ) as payment_splits_json
       FROM orders o
       LEFT JOIN payment_splits ps ON o.id = ps.order_id
       GROUP BY o.id
       ORDER BY o.created_at DESC`
    );

    const orders = rows.map((order) => {
      const items = parseJsonSafe(order.items, []);
      let paymentSplits = [];
      if (order.payment_splits_json) {
        try {
          const splitStr = `[${order.payment_splits_json}]`;
          paymentSplits = JSON.parse(splitStr);
        } catch (e) {
          paymentSplits = [];
        }
      }
      return {
        id: order.id,
        table_id: order.table_id,
        status: order.status,
        items,
        total_price: order.total_price,
        special_notes: order.special_notes,
        created_at: order.created_at,
        payment_splits: paymentSplits,
        tip_amount: order.tip_amount || 0,
      };
    });

    res.json({ success: true, orders });
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/orders/:id/status",
  authenticateJWT,
  requireRole("admin", "waiter", "kitchen"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["Requested", "Accepted", "PaymentPending", "Paid-Accepted", "Paid-Preparing", "Paid-Ready", "Paid", "Rejected", "Cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    await pool.query("UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?", [status, id]);

    io.emit("order:status-updated", { orderId: id, status });

    res.json({ success: true, message: `Order ${id} status updated to ${status}` });
  }),
);

app.delete("/api/admin/orders/:id",
  authenticateJWT,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await pool.query("DELETE FROM orders WHERE id = ?", [id]);
    io.emit("order:deleted", { orderId: id });
    res.json({ success: true, message: `Order ${id} deleted` });
  }),
);

app.get("/api/menu", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM menuitems ORDER BY name");
    res.json({
      success: true,
      menu: rows,
    });
  } catch (err) {
    console.error("Error fetching menu:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/extras", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM extra_options");
    res.json({
      success: true,
      extras: rows,
    });
  } catch (err) {
    console.error("Error fetching extras:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get(
  "/api/orders/:orderId",
  asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const [orders] = await pool.query("SELECT * FROM orders WHERE id = ?", [orderId]);
    if (orders.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    const order = orders[0];
    order.items = parseJsonSafe(order.items, []);
    res.json({ success: true, order });
  }),
);

app.post(
  "/api/orders",
  validateRequest(placeOrderValidators),
  asyncHandler(async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { tableNumber, items, totalPrice, specialNotes } = req.body;


      const itemsData = JSON.stringify(items);
      const notes = specialNotes ? sanitizeText(specialNotes) : null;

      const validatedItems = await validateOrderItems(conn, items, totalPrice);

      // Resolve table_number → actual table id
      const [tableRow] = await conn.query(
        'SELECT id FROM tables WHERE table_number = ?',
        [parseInt(tableNumber) || 1]
      );
      if (tableRow.length === 0) {
        return res.status(400).json({ success: false, error: 'Table not found' });
      }
      const actualTableId = tableRow[0].id;

      const [result] = await conn.query(
        `INSERT INTO orders (table_id, items, total_price, special_notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Requested', NOW(), NOW())`,
        [actualTableId, itemsData, totalPrice, notes],
      );

      const orderId = result.insertId;

      io.emit("order:placed", {
        id: orderId,
        tableId: actualTableId,
        items: validatedItems,
        totalPrice,
        specialNotes: notes,
        createdAt: new Date(),
      });

      res.status(201).json({
        success: true,
        message: "Order placed successfully",
        orderId,
      });
    } finally {
      conn.release();
    }
  }),
);

app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const { message, orderId } = req.body;
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }
    if (message.length > 1000) {
      return res.status(400).json({ error: "Message is too long (max 1000 characters)" });
    }

    const detectedLang = detectLanguage(message);

    io.emit("chat:message", {
      message,
      orderId,
      language: detectedLang,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: "Message sent",
      language: detectedLang,
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post(
  "/api/payment-intent",
  validateRequest(paymentIntentValidators),
  asyncHandler(async (req, res) => {
    const { orderId } = req.body;

    const [orders] = await pool.query("SELECT * FROM orders WHERE id = ?", [orderId]);
    if (orders.length === 0) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    const order = orders[0];

    if (order.status === "Paid") {
      return res.status(400).json({
        error: "Order already paid",
      });
    }

    const total = Number(order.total_price);

    if (isNaN(total) || total <= 0) {
      return res.status(400).json({
        error: "Invalid order total",
      });
    }

    const amountInCents = Math.round(total * 100);

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCents,
        currency: "usd",
        payment_method_types: ["card"],
        metadata: {
          orderId: String(order.id),
        },
      },
      {
        idempotencyKey: `order_${orderId}_${Date.now()}`,
      }
    );

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
    });
  })
);

/* ================================================================
   PAYMENT SYSTEM ROUTES - INTEGRATED PAYMENT HANDLERS
   ================================================================ */

// ============================================
// HELPER: Get order by ID
// ============================================
async function getOrder(orderId) {
  const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
  return orders[0] || null;
}

// ============================================
// HELPER: Create payment in database
// ============================================
async function createPaymentSplit(orderId, paymentData) {
  const paymentId = `payment_${uuidv4()}`;
  
  const [result] = await pool.query(
    `INSERT INTO payment_splits 
     (order_id, payment_id, payer_name, payer_phone, amount_usd, currency, method, payment_status, owner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      orderId,
      paymentId,
      paymentData.payer_name,
      paymentData.payer_phone,
      paymentData.amount_usd,
      paymentData.currency,
      paymentData.method,
      paymentData.owner_id,
    ]
  );
  
  return paymentId;
}

// ============================================
// HELPER: Get payment by ID
// ============================================
async function getPayment(paymentId) {
  const [payments] = await pool.query('SELECT * FROM payment_splits WHERE payment_id = ?', [paymentId]);
  return payments[0] || null;
}

// ============================================
// ENDPOINT 1: POST /api/orders/:orderId/payment/initiate
// Customer initiates payment (cash or card)
// ============================================
app.post('/api/orders/:orderId/payment/initiate', async (req, res) => {
  try {
    const { orderId } = req.params;
    const {
      method,
      amount_usd,
      currency,
      payer_name,
      payer_phone,
      owner_id,
    } = req.body;

    if (!['cash', 'card'].includes(method)) {
      return res.status(400).json({ success: false, error: 'Invalid payment method' });
    }
    if (amount_usd <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be greater than 0' });
    }
    if (!payer_name || !payer_phone) {
      return res.status(400).json({ success: false, error: 'Payer name and phone required' });
    }

    const order = await getOrder(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

   const paymentId = await createPaymentSplit(orderId, {
  payer_name,
  payer_phone,
  amount_usd,
  currency,
  method,
  owner_id,
});

// ✅ UPDATE ORDER STATUS TO PaymentPending
await pool.query(
  'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
  ['PaymentPending', orderId]
);



    let stripeClientSecret = null;
    if (method === 'card') {
      const intent = await stripe.paymentIntents.create({
        amount: Math.round(amount_usd * 100),
        currency: 'usd',
        description: `Order #${orderId}`,
        metadata: {
          orderId: orderId.toString(),
          paymentId,
        },
      });
      stripeClientSecret = intent.client_secret;
    }

    io.emit('order:payment-initiated', {
      orderId,
      paymentId,
      method,
      amount_usd,
      payer_name,
      created_at: new Date(),
    });

    console.log('💳 Payment initiated:', { orderId, method, amount_usd });

    return res.json({
      success: true,
      payment: {
        id: paymentId,
        status: 'pending',
        method,
        amount_usd,
        payer_name,
      },
      stripe: {
        clientSecret: stripeClientSecret,
      },
    });
  } catch (error) {
    // 👇 BETTER logging
    console.error('💥 Payment initiate ERROR:');
    console.error('  Message:', error.message);
    console.error('  Code:', error.code);
    console.error('  Stack:', error.stack);
    console.error('  Full:', error);
    
    return res.status(500).json({ 
      success: false, 
      error: error.message || error.code || 'Unknown error' 
    });
  }
});

// ============================================
// ENDPOINT 2: POST /api/orders/:orderId/payment/stripe-confirm
// Stripe has successfully charged - THIS IS THE FIX FOR ADMIN!
// ============================================
app.post('/api/orders/:orderId/payment/stripe-confirm', async (req, res) => {
  try {
    const { orderId } = req.params;
    const {
      paymentId,
      stripeChargeId,
      stripeIntentId,
      cardBrand,
      cardLast4,
      receiptUrl,
    } = req.body;

    const [existing] = await pool.query(
      'SELECT * FROM payment_splits WHERE stripe_charge_id = ?',
      [stripeChargeId]
    );
    if (existing.length > 0) {
      return res.json({
        success: true,
        message: 'Payment already processed',
        payment: existing[0],
      });
    }

    const transactionRef = `${cardBrand.toUpperCase()} ••••${cardLast4}`;
    
    await pool.query(
      `UPDATE payment_splits 
       SET 
         stripe_charge_id = ?,
         stripe_payment_intent_id = ?,
         stripe_card_brand = ?,
         stripe_card_last4 = ?,
         stripe_receipt_url = ?,
         transaction_ref = ?,
         payment_status = ?,
         transaction_details = ?,
         updated_at = NOW()
       WHERE payment_id = ?`,
      [
        stripeChargeId,
        stripeIntentId,
        cardBrand,
        cardLast4,
        receiptUrl,
        transactionRef,
        'paid',
        JSON.stringify({
          stripe_charge_id: stripeChargeId,
          card_brand: cardBrand,
          card_last4: cardLast4,
          receipt_url: receiptUrl,
          confirmed_at: new Date(),
        }),
        paymentId,
      ]
    );

    await pool.query(
      'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
      ['PaymentPending', orderId]
    );

    const payment = await getPayment(paymentId);
    
    io.emit('order:payment-confirmed-stripe', {
      orderId,
      payment,
      transactionRef,
      message: `✅ Card payment confirmed: ${transactionRef}`,
    });

    console.log('✅ Stripe confirmed:', { orderId, paymentId, cardBrand, cardLast4 });

    return res.json({
      success: true,
      payment,
      message: 'Stripe payment confirmed',
    });
  } catch (error) {
    console.error('Stripe confirm error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 3: POST /api/orders/:orderId/payment/cash-confirm
// ============================================
app.post('/api/orders/:orderId/payment/cash-confirm', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentId } = req.body;

    const payment = await getPayment(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    await pool.query(
      'UPDATE payment_splits SET payment_status = ?, updated_at = NOW() WHERE payment_id = ?',
      ['paid', paymentId]
    );

    await pool.query(
      'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
      ['PaymentPending', orderId]
    );

    io.emit('order:payment-initiated', {
      orderId,
      paymentId,
      method: 'cash',
      amount_usd: payment.amount_usd,
      payer_name: payment.payer_name,
    });

    return res.json({
      success: true,
      message: 'Cash payment confirmed',
      payment,
    });
  } catch (error) {
    console.error('Cash confirm error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 4: PUT /api/orders/:orderId/payment/confirm
// Admin confirms payment
// ============================================
app.put('/api/orders/:orderId/payment/confirm', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentId, adminId } = req.body;

    const [existing] = await pool.query(
      'SELECT * FROM payment_splits WHERE payment_id = ? AND confirmed_at IS NOT NULL',
      [paymentId]
    );
    if (existing.length > 0) {
      return res.json({
        success: true,
        message: 'Payment already confirmed',
        payment: existing[0],
      });
    }

    await pool.query(
      `UPDATE payment_splits 
       SET confirmed_at = NOW(), confirmed_by_admin = ?, updated_at = NOW()
       WHERE payment_id = ?`,
      [adminId, paymentId]
    );

    const [allPayments] = await pool.query(
      'SELECT * FROM payment_splits WHERE order_id = ?',
      [orderId]
    );

    const allConfirmed = allPayments.every(p => p.confirmed_at);

    if (allConfirmed) {
      await pool.query(
        `UPDATE orders SET 
         status = ?, 
         payment_confirmed_at = NOW(),
         payment_confirmed_by = ?,
         updated_at = NOW()
         WHERE id = ?`,
        ['Paid-Accepted', adminId, orderId]
      );
    }

    io.to(`order-${orderId}`).emit('payment:confirmed', {
      orderId,
      status: 'Paid-Accepted',
      confirmedAt: new Date(),
    });

    io.emit('order:payment-admin-confirmed', {
      orderId,
      paymentId,
    });

    console.log('👨‍💼 Admin confirming payment:', { orderId, paymentId });

    return res.json({
      success: true,
      message: 'Payment confirmed by admin',
      order: { id: orderId, status: 'Paid-Accepted' },
    });
  } catch (error) {
    console.error('Payment confirm error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 5: PUT /api/orders/:orderId/payment/reject
// ============================================
app.put('/api/orders/:orderId/payment/reject', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentId, adminId, reason } = req.body;

    await pool.query(
      `UPDATE payment_splits 
       SET payment_status = ?, confirmed_at = NOW(), confirmed_by_admin = ?, 
           confirmation_notes = ?, updated_at = NOW()
       WHERE payment_id = ?`,
      ['rejected', adminId, reason, paymentId]
    );

    await pool.query(
      'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
      ['Rejected', orderId]
    );

    io.to(`order-${orderId}`).emit('payment:rejected', {
      orderId,
      reason,
    });

    console.log('❌ Admin rejecting payment:', { orderId, paymentId, reason });

    return res.json({
      success: true,
      message: 'Payment rejected',
    });
  } catch (error) {
    console.error('Payment reject error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 6: GET /api/admin/orders?status=payment-pending
// ============================================
app.get('/api/admin/orders-payment', async (req, res) => {
  try {
    const { status = 'PaymentPending', limit = 20 } = req.query;

    const [rows] = await pool.query(
      `SELECT 
         o.id, o.status, o.table_id, o.total_price, o.created_at,
         ps.id as ps_id, ps.payment_id, ps.payer_name, ps.method, ps.amount_usd, 
         ps.stripe_card_brand, ps.stripe_card_last4, ps.transaction_ref,
         ps.stripe_receipt_url, ps.payment_status, ps.confirmed_at, ps.confirmed_by_admin,
         ps.created_at as payment_created_at
       FROM orders o
       LEFT JOIN payment_splits ps ON o.id = ps.order_id
       WHERE o.status = ?
       ORDER BY o.created_at DESC
       LIMIT ?`,
      [status, parseInt(limit)]
    );

    const orders = {};
    rows.forEach(row => {
      if (!orders[row.id]) {
        orders[row.id] = {
          id: row.id,
          status: row.status,
          table_id: row.table_id,
          total_price: row.total_price,
          created_at: row.created_at,
          payments: [],
        };
      }
      
      if (row.ps_id) {
        orders[row.id].payments.push({
          id: row.payment_id,
          payer_name: row.payer_name,
          method: row.method,
          amount_usd: row.amount_usd,
          status: row.payment_status,
          transaction_ref: row.transaction_ref,
          stripe: {
            card_brand: row.stripe_card_brand,
            card_last4: row.stripe_card_last4,
            receipt_url: row.stripe_receipt_url,
          },
          confirmed_at: row.confirmed_at,
          confirmed_by_admin: row.confirmed_by_admin,
          created_at: row.payment_created_at,
        });
      }
    });

    console.log('📋 Admin fetching orders with status:', status);

    return res.json({
      success: true,
      orders: Object.values(orders),
    });
  } catch (error) {
    console.error('Get admin orders error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 7: GET /api/orders/:orderId/payments
// ============================================
app.get('/api/orders/:orderId/payments', async (req, res) => {
  try {
    const { orderId } = req.params;

    const [orderRows] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (orderRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const order = orderRows[0];

    const [paymentRows] = await pool.query(
      'SELECT * FROM payment_splits WHERE order_id = ?',
      [orderId]
    );

    return res.json({
      success: true,
      order: {
        ...order,
        payments: paymentRows,
      },
    });
  } catch (error) {
    console.error('Get order error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/orders/:orderId/splits', asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { payment_splits, tip_amount } = req.body;

  await pool.query(
    'UPDATE orders SET payment_splits = ?, tip_amount = ?, updated_at = NOW() WHERE id = ?',
    [
      payment_splits ? JSON.stringify(payment_splits) : null,
      tip_amount || 0,
      orderId
    ]
  );

  res.json({ success: true, message: 'Splits updated' });
}));
// ============================================
// ENDPOINT: POST /api/ai-chat
// AI chatbot via Anthropic Claude
// ============================================
app.post("/api/ai-chat", chatLimiter, asyncHandler(async (req, res) => {
 console.log("🤖 AI chat request received");
  console.log("GEMINI_KEYS count:", GEMINI_KEYS.length);
  console.log("Messages count:", req.body?.messages?.length);
  const { messages, menuContext } = req.body;

 if (GEMINI_KEYS.length === 0) {
  return res.status(503).json({ success: false, error: "AI chat not configured" });
}

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, error: "Messages required" });
  }

  
 const systemPrompt = `You are Snack, a smart friendly assistant at Snack Attack restaurant in Hamra, Beirut.
${menuContext || "Menu not available yet."}

=== LANGUAGE RULES ===
Detect the customer's language from their messages and reply in the SAME language. Never mix languages.
- Franco/Arabizi words (bde, shu, 3andi, kifak, yalla, mni7, ktir, hek, wallah, 3anna, kmn, tyb, eza, la2, akid, msh) -> reply in Franco only. NEVER use Arabic script (ا ب ت).
- Arabic script -> reply in Arabic only.
- English only -> reply in English only.
Once the customer establishes a language, STAY in that language. Short words like "hi", "ok", "yes" do NOT change the established language.
NEVER use markdown, asterisks, bold, or bullet points. Plain text only. Always complete your sentences.

=== RESTAURANT RULES ===
No vegan items. No fish or seafood. If asked, apologize politely and suggest available alternatives from the menu.
Only mention items that exist in the menu provided. Never invent items.
When the customer asks about available options (cheese, sauces, vegetables, extras), list ALL items from the AVAILABLE EXTRAS section. Never list only a few if more exist.
If the customer is rude or insulting, reply: "Sorry, that's not appropriate." then on a new line write NEED_ADMIN:offensive

=== WHAT THE CUSTOMER WANTS ===
When the customer wants food, ask: "Would you like to pick something from the menu, or build your own custom burger?"

--- MENU ITEM PATH ---
If they pick a menu item, confirm it briefly then on a new line write CART_ADD:ExactItemName
For multiple quantities, repeat the action. Example "2 Pepsi" -> CART_ADD:Pepsi then CART_ADD:Pepsi

--- CUSTOM BURGER PATH ---
Ask ONE question at a time, in this order. Wait for the answer before the next question:
Step 1 - Protein: beef or chicken?
Step 2 - Cheese: offer the cheese options from the available extras.
Step 3 - Sauce: offer the sauce options from the available extras.
Step 4 - Vegetables: what veggies to add?
Step 5 - Anything else to add?

After step 5, you are DONE collecting. In your VERY NEXT reply you MUST do BOTH of these together in the same message:
1. Write a short order summary of everything the customer chose (protein, cheese, sauce, veggies).
2. On a new line at the end, write the action in EXACTLY this format (real values, no placeholders):
CUSTOM_ORDER:{"protein":"Beef","cheese":"Mozzarella","sauce":"BBQ Sauce","veggies":"Onions","bread":"brioche","notes":"","price":0}

Do not ask any more questions after step 5. Do not wait for another confirmation. Summarize and add to cart in the same reply.
NEVER write CART_ADD:Custom Burger. The custom burger is ALWAYS added using CUSTOM_ORDER with the full JSON.

=== ACTIONS (write on their own line, exactly) ===
CART_ADD:ItemName      -> adds a menu item to the cart
CUSTOM_ORDER:{...}     -> adds a finished custom burger to the cart (with full details)
NEED_ADMIN:reason      -> calls a staff member

=== STYLE ===
Keep replies to 2-3 short sentences. Sound natural and friendly. Plain text only.`;



  const validMessages = messages
    .slice(-8)
    .filter(m => m.content && m.content.trim())
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content.slice(0, 500) }],
    }));

  const firstUserIdx = validMessages.findIndex(m => m.role === "user");
  const contents = firstUserIdx >= 0 ? validMessages.slice(firstUserIdx) : validMessages;

  if (contents.length === 0) {
    return res.status(400).json({ success: false, error: "No valid messages" });
  }

  // ✅ Retry up to 3 times on 429
  let lastError = null;
for (let attempt = 1; attempt <= GEMINI_KEYS.length; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey(attempt - 1)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
           generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
          }),
        }
      );

      clearTimeout(timeout);
      const data = await response.json();
console.log("Gemini status:", response.status, "| error:", data?.error?.code, data?.error?.message);
       if (!response.ok) {
  const code = data?.error?.code;
  
  // ✅ كل error بيجرب key تاني
  if (attempt < GEMINI_KEYS.length) {
    await new Promise(r => setTimeout(r, 1000 * attempt));
    continue;
  }
  
  if (code === 429 || code === 503) {
    return res.status(429).json({ success: false, error: "AI is busy, please try again in a moment" });
  }
  return res.status(500).json({ success: false, error: "AI service error" });
}

      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!reply) return res.status(500).json({ success: false, error: "Empty AI response" });

      return res.json({ success: true, reply });

    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        return res.status(504).json({ success: false, error: "AI response timeout" });
      }
      lastError = err;
    }
  }

  return res.status(500).json({ success: false, error: lastError?.message || "AI service unavailable" });
}));

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