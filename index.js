const express = require('express');
const cors = require('cors');
const pool = require('./db'); 
const path = require("path");
const app = express();

// ✅ 1. Middleware: Lezem y-koun bi-awal el-fayl kirmal el-browser ma ya3mel block
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

      // 2. Insert Order as 'Requested' (Wait for Admin Approval)
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
      console.log("ITEMS RECEIVED:", items);

      // 3. Insert Items
     for (const item of items || []) {
    // 💡 Check every possible ID field coming from React
   const itemId = item.id || item.menu_id || item.databaseId;

if (!itemId || isNaN(itemId)) {
    console.log("BAD ITEM:", item);
    continue;
}

    await connection.query(
        'INSERT INTO order_items (order_id, item_id, quantity, price_at_time) VALUES (?, ?, ?, ?)',
        [orderId, itemId, item.quantity || 1, item.price || 0]
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

/* ✅ Unified Order Route */


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

/* --- SHARED CART UPDATES --- */
app.post('/orders/:id/update-item', async (req, res) => {
  const orderId = req.params.id;
  const { action, item } = req.body; // action rah tkoun ya 'add' ya 'remove'
  
  // 💡 Njeeb el ID taba3 el item (metel ma 3melti bl place-order)
  const itemId = item.id || item.menu_id || item.databaseId;

  if (!itemId || isNaN(itemId)) {
    return res.status(400).json({ error: "Invalid item ID" });
  }

  try {
    // 1. Nshouf eza el item aslan mawjoud bhal order
    const [existingRows] = await pool.query(
      'SELECT * FROM order_items WHERE order_id = ? AND item_id = ?',
      [orderId, itemId]
    );

    if (action === 'add') {
      if (existingRows.length > 0) {
        // Zid el quantity 1
        await pool.query(
          'UPDATE order_items SET quantity = quantity + 1 WHERE order_id = ? AND item_id = ?',
          [orderId, itemId]
        );
      } else {
        // Zid el item kello eza mesh mawjoud (law 7ada mna22i shi jdid)
        await pool.query(
          'INSERT INTO order_items (order_id, item_id, quantity, price_at_time) VALUES (?, ?, 1, ?)',
          [orderId, itemId, item.price || 0]
        );
      }
    } else if (action === 'remove') {
      if (existingRows.length > 0) {
        const currentQty = existingRows[0].quantity;
        if (currentQty > 1) {
           // Na2es el quantity 1
           await pool.query(
            'UPDATE order_items SET quantity = quantity - 1 WHERE order_id = ? AND item_id = ?',
            [orderId, itemId]
          );
        } else {
           // Eza sefr, m7i el item men el order
           await pool.query(
            'DELETE FROM order_items WHERE order_id = ? AND item_id = ?',
            [orderId, itemId]
          );
        }
      }
    }

    // 2. E3adet 7isab el total_price taba3 el order la ydal sa7 100%
    const [sumResult] = await pool.query(
      'SELECT SUM(quantity * price_at_time) as newTotal FROM order_items WHERE order_id = ?', 
      [orderId]
    );
    const newTotal = sumResult[0].newTotal || 0;
    
    await pool.query('UPDATE orders SET total_price = ? WHERE id = ?', [newTotal, orderId]);

    res.json({ success: true, newTotal });
  } catch (err) {
    console.error("Shared Cart Update Error:", err);
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
    const [orderRows] = await pool.query(
      'SELECT total_price, payment_splits FROM orders WHERE id = ?',
      [id]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const order = orderRows[0];

    // ✅ THE FIX: Safe Parse kirmal ma ya3mel crash!
    let oldSplits = [];
    try {
      if (order.payment_splits) {
        const parsed = typeof order.payment_splits === 'string'
          ? JSON.parse(order.payment_splits)
          : order.payment_splits;
        
        oldSplits = Array.isArray(parsed) ? parsed : [];
      }
    } catch (err) {
      oldSplits = []; // Eza fi error, n5alliha array fadeye
    }

    const newSplits = payment_splits || [];
    const allSplits = [...oldSplits, ...newSplits];

    const totalPaid = allSplits.reduce(
      (sum, s) => sum + Number(s.amount || 0),
      0
    );
    
    if (status === "Paid" && totalPaid < Number(order.total_price)) {
      return res.status(400).json({
        success: false,
        message: "Payment not complete yet!"
      });
    }

    // Update orders
    await pool.query(
      'UPDATE orders SET status = ?, payment_splits = ? WHERE id = ?',
      [status, JSON.stringify(allSplits), id]
    );

    // Update users
    if (customer && customer.name) {
      const [userRows] = await pool.query(
        'SELECT user_id FROM orders WHERE id = ?',
        [id]
      );

      if (userRows.length > 0 && userRows[0].user_id) {
        await pool.query(
          'UPDATE users SET full_name = ?, phone_number = ? WHERE user_id = ?',
          [customer.name, customer.phone || "000000", userRows[0].user_id]
        );
      }
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