const express = require("express");
const cors = require("cors");
const pool = require("./db");
const path = require("path");

// 🔥 Socket
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

app.set("io", io);

/* ================= MIDDLEWARE ================= */

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());
app.use("/images", express.static(path.join(__dirname, "images")));

/* ================= SOCKET ================= */

io.on("connection", (socket) => {
  console.log("🟢 connected:", socket.id);

  // join order room
  socket.on("joinOrder", (orderId) => {
    socket.join(orderId);
  });

  /* ================= STEP 3.1 FIXED ================= */
  /* ================= STEP 3.1 FIXED ================= */
socket.on("scanJoin", async ({ orderId }) => {
  try {
    const [rows] = await pool.query(
      "SELECT payment_splits FROM orders WHERE id = ?",
      [orderId]
    );

    if (!rows.length) return;

    let splits = [];
    try {
      splits = rows[0].payment_splits ? JSON.parse(rows[0].payment_splits) : [];
    } catch { splits = []; }

    // Badel ma ncheck el socket.id (yali byetghayar), fine nzid "New Guest" 
    // aw n5alle el user huwe yzid 7alo. 
    // Eza badik yeha automatic dghere:
    const newPayer = {
      id: Date.now(),
      deviceId: socket.id, 
      name: "Guest " + (splits.length + 1), // Kirmal tbayin dghere
      amount: 0,
      method: "cash"
    };

    const updatedSplits = [...splits, newPayer];

    await pool.query(
      "UPDATE orders SET payment_splits = ? WHERE id = ?",
      [JSON.stringify(updatedSplits), orderId]
    );

    // ✅ Emitted to everyone including the person who scanned
    io.to(orderId).emit("payersUpdated", updatedSplits);

  } catch (err) {
    console.error("SCAN ERROR:", err.message);
  }
});

  socket.on("disconnect", () => {
    console.log("🔴 disconnected:", socket.id);
  });
});

/* ================= BASIC ROUTES ================= */

app.get("/", (req, res) => {
  res.send("Backend running 🚀");
});

/* ================= MENU ================= */

app.get("/menu", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM menuitems");
  res.json(rows);
});

/* ================= ORDER PLACE ================= */

app.post("/place-order", async (req, res) => {
  const { customer, table_id, total_price, items, payment_splits } = req.body;

  const phone = customer?.phone || "000000";
  const name = customer?.name || "Guest";

  try {
    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      let [userRows] = await conn.query(
        "SELECT user_id FROM users WHERE phone_number = ?",
        [phone]
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

      const [order] = await conn.query(
        `INSERT INTO orders (table_id, total_price, status, user_id, payment_splits)
         VALUES (?, ?, ?, ?, ?)`,
        [
          table_id || 1,
          total_price,
          "Requested",
          userId,
          JSON.stringify(payment_splits || [])
        ]
      );

      const orderId = order.insertId;

      for (const item of items || []) {
        const itemId =
          item.databaseId || item.item_id || item.menu_id || item.id;

        if (!itemId) continue;

        await conn.query(
          `INSERT INTO order_items (order_id, item_id, quantity, price_at_time)
           VALUES (?, ?, ?, ?)`,
          [orderId, itemId, item.quantity || 1, item.price || 0]
        );
      }

      await conn.commit();
      res.json({ success: true, orderId });

    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= GET ORDER ================= */

app.get("/orders/:id", async (req, res) => {
  const [order] = await pool.query(
    "SELECT * FROM orders WHERE id = ?",
    [req.params.id]
  );

  const [items] = await pool.query(
    `SELECT oi.*, m.name
     FROM order_items oi
     LEFT JOIN menuitems m ON oi.item_id = m.id
     WHERE oi.order_id = ?`,
    [req.params.id]
  );

  res.json({ order: order[0], items });
});

/* ================= UPDATE ITEM + SOCKET ================= */

app.post("/orders/:id/update-item", async (req, res) => {
  const orderId = req.params.id;
  const { action, item } = req.body;

  const itemId =
    item.item_id || item.databaseId || item.id || item.menu_id;

  if (!itemId) {
    return res.status(400).json({ error: "Invalid item" });
  }

  const [existing] = await pool.query(
    "SELECT id, quantity FROM order_items WHERE order_id = ? AND item_id = ? LIMIT 1",
    [orderId, itemId]
  );

  if (action === "add") {
    if (existing.length) {
      await pool.query(
        "UPDATE order_items SET quantity = quantity + 1 WHERE id = ?",
        [existing[0].id]
      );
    } else {
      await pool.query(
        "INSERT INTO order_items (order_id, item_id, quantity, price_at_time) VALUES (?, ?, 1, ?)",
        [orderId, itemId, item.price || 0]
      );
    }
  }

  if (action === "remove" && existing.length) {
    if (existing[0].quantity > 1) {
      await pool.query(
        "UPDATE order_items SET quantity = quantity - 1 WHERE id = ?",
        [existing[0].id]
      );
    } else {
      await pool.query(
        "DELETE FROM order_items WHERE id = ?",
        [existing[0].id]
      );
    }
  }

  const [sum] = await pool.query(
    "SELECT SUM(quantity * price_at_time) as total FROM order_items WHERE order_id = ?",
    [orderId]
  );

  const newTotal = sum[0].total || 0;

  await pool.query(
    "UPDATE orders SET total_price = ? WHERE id = ?",
    [newTotal, orderId]
  );

  // 🔥 REALTIME UPDATE
  io.to(orderId).emit("cartUpdated");

  res.json({ success: true, newTotal });
});

/* ================= START ================= */

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log("🚀 running on", PORT)
);