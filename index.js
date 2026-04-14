const express = require('express');
const cors = require('cors');
const pool = require('./db'); 
const path = require("path");

// 🔥 NEW
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// 🔥 create server بدل app.listen
const server = http.createServer(app);

// 🔥 socket setup
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// نخلي io متاح بكل مكان
app.set("io", io);

/* ================= MIDDLEWARE ================= */

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());
app.use("/images", express.static(path.join(__dirname, "images")));

app.get('/', (req, res) => {
  res.send("Backend is running 🚀");
});

/* ================= SOCKET CONNECTION ================= */

io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  socket.on("joinOrder", (orderId) => {
    socket.join(orderId);
    console.log("📦 Joined order room:", orderId);
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.id);
  });
});

/* ================= AUTH ================= */

app.post('/api/admin/login', async (req, res) => {
  const { phone_number, password } = req.body;
  try {
    const [rows] = await pool.query(
      'SELECT user_id, full_name, phone_number FROM users WHERE phone_number = ?', 
      [phone_number]
    );

    if (rows.length > 0) {
      const user = rows[0];
      if (password === "snack123") { 
        res.json({ 
          success: true, 
          admin: { id: user.user_id, name: user.full_name } 
        });
      } else {
        res.status(401).json({ success: false, message: "Wrong password" });
      }
    } else {
      res.status(403).json({ success: false, message: "Access Denied" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= MENU ================= */

app.get('/menu', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM menuitems'); 
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/item-extras/:id", async (req, res) => {
  try {
    const [results] = await pool.query(
      `SELECT eo.id, eo.name, eo.price FROM extra_options eo 
       JOIN item_extras ie ON eo.id = ie.extra_id WHERE ie.item_id = ?`, 
      [req.params.id]
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= PLACE ORDER ================= */

app.post('/place-order', async (req, res) => {
  const { customer, table_id, total_price, items, payment_splits } = req.body;

  const customerPhone = customer?.phone || "000000";
  const customerName = customer?.name || "Guest";

  try {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      let [userRows] = await connection.query(
        'SELECT user_id FROM users WHERE phone_number = ?', 
        [customerPhone]
      );

      let userId;

      if (userRows.length === 0) {
        const [newUser] = await connection.query(
          'INSERT INTO users (full_name, phone_number, qlub_balance) VALUES (?, ?, 0)',
          [customerName, customerPhone]
        );
        userId = newUser.insertId;
      } else {
        userId = userRows[0].user_id;
      }

      const [orderResult] = await connection.query(
        'INSERT INTO orders (table_id, total_price, status, user_id, payment_splits) VALUES (?, ?, ?, ?, ?)',
        [
          table_id || 1,
          total_price,
          "Requested",
          userId,
          JSON.stringify(payment_splits || [])
        ]
      );

      const orderId = orderResult.insertId;

      for (const item of items || []) {
        const itemId = item.databaseId || item.item_id || item.menu_id || item.id;

        if (!itemId || isNaN(itemId)) continue;

        await connection.query(
          'INSERT INTO order_items (order_id, item_id, quantity, price_at_time) VALUES (?, ?, ?, ?)',
          [orderId, itemId, item.quantity || 1, item.price || 0]
        );
      }

      await connection.commit();

      res.json({ success: true, orderId });

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= GET ORDER ================= */

app.get('/orders/:id', async (req, res) => {
  try {
    const [order] = await pool.query(
      'SELECT * FROM orders WHERE id = ?',
      [req.params.id]
    );

    const [items] = await pool.query(
      `SELECT oi.*, m.name 
       FROM order_items oi
       LEFT JOIN menuitems m ON oi.item_id = m.id
       WHERE oi.order_id = ?`,
      [req.params.id]
    );

    res.json({
      order: order[0],
      items
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= UPDATE ITEM (🔥 WITH SOCKET BROADCAST) ================= */

app.post('/orders/:id/update-item', async (req, res) => {
  const orderId = req.params.id;
  const { action, item } = req.body;

  const itemId = item.item_id || item.databaseId || item.id || item.menu_id;

  if (!itemId || isNaN(itemId)) {
    return res.status(400).json({ error: "Invalid item ID" });
  }

  try {
    const [existingRows] = await pool.query(
      'SELECT id, quantity FROM order_items WHERE order_id = ? AND item_id = ? LIMIT 1',
      [orderId, itemId]
    );

    if (action === 'add') {
      if (existingRows.length > 0) {
        await pool.query(
          'UPDATE order_items SET quantity = quantity + 1 WHERE id = ?',
          [existingRows[0].id]
        );
      } else {
        await pool.query(
          'INSERT INTO order_items (order_id, item_id, quantity, price_at_time) VALUES (?, ?, 1, ?)',
          [orderId, itemId, item.price || 0]
        );
      }
    } else if (action === 'remove') {
      if (existingRows.length > 0) {
        if (existingRows[0].quantity > 1) {
          await pool.query(
            'UPDATE order_items SET quantity = quantity - 1 WHERE id = ?',
            [existingRows[0].id]
          );
        } else {
          await pool.query(
            'DELETE FROM order_items WHERE id = ?',
            [existingRows[0].id]
          );
        }
      }
    }

    const [sumResult] = await pool.query(
      'SELECT SUM(quantity * price_at_time) as newTotal FROM order_items WHERE order_id = ?', 
      [orderId]
    );

    const newTotal = sumResult[0].newTotal || 0;

    await pool.query(
      'UPDATE orders SET total_price = ? WHERE id = ?', 
      [newTotal, orderId]
    );

    // 🔥🔥🔥 SOCKET BROADCAST
    io.to(orderId).emit("cartUpdated");

    res.json({ success: true, newTotal });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Snack Attack Backend running on port ${PORT}`);
});