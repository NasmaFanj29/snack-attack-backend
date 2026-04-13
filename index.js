const express = require('express');
const cors = require('cors');
const pool = require('./db'); 
const path = require("path");
const app = express();

// ✅ 1. Middleware ma3 el-CORS Fix kirmal ma ya3te Block mnel-browser
app.use(cors({
  origin: ["http://localhost:3000", "https://snackattacknasma.netlify.app"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());
app.use("/images", express.static(path.join(__dirname, "images")));

/* --- 1. AUTHENTICATION --- */
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

/* --- 2. MENU & EXTRAS --- */
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

/* --- 3. ORDER PLACEMENT (Step 1: Requested) --- */
app.post('/place-order', async (req, res) => {
  const { customer, table_id, total_price, items, payment_splits } = req.body;
  
  // Handle missing customer info for 'Requested' initial step
  const customerPhone = customer?.phone || "000000";
  const customerName = customer?.name || "Guest";

  try {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 1. User Logic - ✅ FIXED: Removed 'role' column from INSERT
      let [userRows] = await connection.query('SELECT user_id FROM users WHERE phone_number = ?', [customerPhone]);
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

      // 2. Insert Order as 'Requested' (Needs Admin Acceptance)
      const [orderResult] = await connection.query(
        'INSERT INTO orders (table_id, total_price, status, user_id, payment_splits) VALUES (?, ?, "Requested", ?, ?)',
        [table_id || 1, total_price, userId, JSON.stringify(payment_splits || [])] 
      );
      const orderId = orderResult.insertId;

      // 3. Insert Items
      for (const item of items) {
        const finalId = (item.id && item.id < 1000000) ? item.id : null;
        await connection.query(
          'INSERT INTO order_items (order_id, item_id, quantity, price_at_time) VALUES (?, ?, ?, ?)',
          [orderId, finalId, item.quantity, item.price]
        );
      }

      await connection.commit();
      res.json({ success: true, orderId: orderId });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("ORDER ERROR:", err.message); 
    res.status(500).json({ error: err.message });
  }
});

app.get('/order-status/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT status FROM orders WHERE id = ?', [req.params.id]);
    if (rows.length > 0) {
      res.json({ status: rows[0].status });
    } else {
      res.status(404).json({ message: "Order not found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* --- 4. ADMIN DASHBOARD --- */
app.get('/admin/orders', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT o.id, o.total_price, o.status, o.created_at, o.table_id, o.payment_splits,
             u.full_name, u.phone_number FROM orders o
      LEFT JOIN users u ON o.user_id = u.user_id ORDER BY o.created_at DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/orders/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM order_items WHERE order_id = ?", [id]);
    const [result] = await pool.query("DELETE FROM orders WHERE id = ?", [id]);
    res.json({ success: result.affectedRows > 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/admin/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, customer, payment_splits } = req.body; 

  try {
    if (status === "Paid" && customer) {
        await pool.query(
            'UPDATE orders SET status = ?, payment_splits = ? WHERE id = ?',
            [status, JSON.stringify(payment_splits || []), id]
        );
        await pool.query('CALL UpdateUserQlub(?, ?)', [customer.phone, 0]); 
    } else {
        await pool.query('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE ERROR:", err.message); 
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/admin/stats', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT COUNT(id) as total_orders, IFNULL(SUM(total_price), 0) as total_sales 
      FROM orders WHERE DATE(created_at) = CURDATE() AND status != 'Cancelled'`);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Snack Attack Backend running on port ${PORT}`));