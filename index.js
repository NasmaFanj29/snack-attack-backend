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

        // ✅ NEW: Store specialNote and removedExtras
        const specialNote = item.specialNote || null;
        const removedExtras = item.removedExtras 
          ? JSON.stringify(item.removedExtras) 
          : null;

        await conn.query(
          `INSERT INTO order_items (order_id, item_id, quantity, price_at_time, special_note, removed_extras)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            orderId, 
            itemId, 
            item.quantity || 1, 
            item.price || 0,
            specialNote,
            removedExtras
          ]
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

/* ================= GET ORDER (Updated) ================= */

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

  // ✅ Parse special_note and removed_extras for frontend
  const parsedItems = items.map(item => ({
    ...item,
    special_note: item.special_note || null,
    removed_extras: item.removed_extras 
      ? JSON.parse(item.removed_extras) 
      : null
  }));

  res.json({ order: order[0], items: parsedItems });
});

/* ================= UPDATE ITEM WITH NOTES ================= */

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
      // ✅ NEW: Support special_note and removed_extras
      const specialNote = item.specialNote || null;
      const removedExtras = item.removedExtras 
        ? JSON.stringify(item.removedExtras) 
        : null;

      await pool.query(
        `INSERT INTO order_items (order_id, item_id, quantity, price_at_time, special_note, removed_extras) 
         VALUES (?, ?, 1, ?, ?, ?)`,
        [orderId, itemId, item.price || 0, specialNote, removedExtras]
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
  io.to(String(orderId)).emit("cartUpdated");

  res.json({ success: true, newTotal });
});

/* ================= ADMIN DASHBOARD (Display Notes) ================= */

app.get("/admin/orders", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT o.id, o.total_price, o.status, o.created_at, o.table_id, o.payment_splits,
             u.full_name, u.phone_number FROM orders o
      LEFT JOIN users u ON o.user_id = u.user_id ORDER BY o.created_at DESC`);
    
    // ✅ Enhance with items including notes
    const enrichedRows = await Promise.all(
      rows.map(async (order) => {
        const [items] = await pool.query(
          `SELECT oi.*, m.name FROM order_items oi
           LEFT JOIN menuitems m ON oi.item_id = m.id
           WHERE oi.order_id = ?`,
          [order.id]
        );
        
        const parsedItems = items.map(item => ({
          ...item,
          special_note: item.special_note || null,
          removed_extras: item.removed_extras 
            ? JSON.parse(item.removed_extras) 
            : null
        }));

        return { ...order, items: parsedItems };
      })
    );

    res.json(enrichedRows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
