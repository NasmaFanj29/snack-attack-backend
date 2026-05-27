# 🗄️ Snack Attack - Database Schema

## Database Name
```sql
snack_attack
```

---

## Tables Overview

| Table | Purpose | Records | Key Fields |
|-------|---------|---------|-----------|
| `users` | Customer information | ~1000s | phone_number, qlub_balance |
| `orders` | Order records | ~10000s | status, user_id, table_id, total_price |
| `order_items` | Individual items in orders | ~50000s | order_id, item_id, quantity |
| `menuitems` | Restaurant menu | ~100 | name, category, price, available |
| `extra_options` | Add-on items | ~20 | name, price |
| `staff_users` | Staff account info (deprecated - in-memory) | N/A | username, role |

---

## Detailed Schema

### 1. `users` Table
Stores customer information and loyalty balance.

```sql
CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  phone_number VARCHAR(25) UNIQUE,
  qlub_balance DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  KEY idx_phone (phone_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Columns:**
- `user_id`: Unique identifier, auto-incremented
- `full_name`: Customer name (max 100 characters)
- `phone_number`: Unique phone number for customer identification
- `qlub_balance`: Loyalty points/balance for Qlub rewards program
- `created_at`: Account creation timestamp
- `updated_at`: Last account update timestamp

**Indexes:**
- Primary: `user_id`
- Foreign: `phone_number` (unique, for quick lookups)

**Usage:**
- Link orders to customers by phone number
- Reuse existing customer records if phone matches
- Track loyalty points

---

### 2. `orders` Table
Core order records with status tracking and payment splits.

```sql
CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  table_id INT DEFAULT 1,
  total_price DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'Requested',
  payment_splits JSON,
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  KEY idx_user (user_id),
  KEY idx_table (table_id),
  KEY idx_status (status),
  KEY idx_created (created_at),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Columns:**
- `id`: Unique order identifier
- `user_id`: Reference to customer (foreign key)
- `table_id`: Restaurant table number (default: 1 for delivery/takeout)
- `total_price`: Order total amount
- `status`: Current order state (see below)
- `payment_splits`: JSON array of payment methods and amounts
- `rejection_reason`: Reason if order was rejected
- `created_at`: Order creation timestamp
- `updated_at`: Last modification timestamp

**Status Values:**
```
'Requested'        → Customer submitted order
'Confirmed'        → Staff confirmed order
'Preparing'        → Being prepared in kitchen
'Ready'            → Ready for pickup/serving
'Paid'             → Payment received
'Completed'        → Order fulfilled
'Cancelled'        → Order cancelled
'Payment Failed'   → Payment processing failed
```

**payment_splits Example:**
```json
[
  { "method": "cash", "amount": 20.00 },
  { "method": "card", "amount": 25.99 }
]
```

**Indexes:**
- `user_id`: Fast customer lookups
- `status`: Filter orders by state
- `created_at`: Sort/filter by date

---

### 3. `order_items` Table
Individual items within each order with customization details.

```sql
CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  item_id INT,
  quantity INT DEFAULT 1,
  price_at_time DECIMAL(10, 2),
  special_note TEXT,
  removed_extras JSON,
  selected_extras JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  KEY idx_order (order_id),
  KEY idx_item (item_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES menuitems(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Columns:**
- `id`: Unique order item identifier
- `order_id`: Reference to parent order
- `item_id`: Reference to menu item
- `quantity`: Number of units ordered
- `price_at_time`: Price charged (may differ from current menu price)
- `special_note`: Customer special requests (e.g., "No onions", "Extra spicy")
- `removed_extras`: JSON array of extras NOT included
- `selected_extras`: JSON array of extras added
- `created_at`: Item creation timestamp

**selected_extras Example:**
```json
[
  { "id": 1, "name": "Extra Cheese", "price": 1.50 },
  { "id": 4, "name": "Bacon", "price": 2.00 }
]
```

**removed_extras Example:**
```json
[
  { "id": 3, "name": "Tomato" },
  { "id": 5, "name": "Onions" }
]
```

---

### 4. `menuitems` Table
Restaurant menu items and availability.

```sql
CREATE TABLE menuitems (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(50),
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  image_url VARCHAR(255),
  available TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  KEY idx_category (category),
  KEY idx_available (available)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Columns:**
- `id`: Menu item identifier
- `name`: Item name (e.g., "Cheese Burger")
- `category`: Category for grouping (e.g., "Burgers", "Sides", "Drinks")
- `description`: Item description
- `price`: Current selling price
- `image_url`: Path to item image
- `available`: Boolean flag (1 = available, 0 = unavailable)
- `created_at`: Record creation
- `updated_at`: Last price/availability change

**Sample Data:**
```sql
INSERT INTO menuitems (name, category, price, description, available) VALUES
('Cheese Burger', 'Burgers', 12.50, 'Beef patty with melted cheddar cheese', 1),
('Double Burger', 'Burgers', 15.99, 'Two beef patties with cheese', 1),
('Fries', 'Sides', 3.99, 'Golden crispy fries', 1),
('Pepsi', 'Drinks', 2.50, 'Cold Pepsi', 1);
```

---

### 5. `extra_options` Table
Add-on/extra items that can be added to menu items.

```sql
CREATE TABLE extra_options (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  KEY idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Columns:**
- `id`: Extra option identifier
- `name`: Extra name (e.g., "Extra Cheese", "Bacon")
- `price`: Price to add this extra
- `created_at`: Record creation

**Sample Data:**
```sql
INSERT INTO extra_options (name, price) VALUES
('Extra Cheese', 1.50),
('Bacon', 2.00),
('Mushrooms', 1.00),
('Jalapeños', 0.75),
('Extra Sauce', 0.50);
```

---

## Data Relationships

```
users (1) ──→ (M) orders
  ↓
  └─→ (1) order_items (M) ──→ menuitems

extra_options ─→ order_items (via JSON)
```

### Relationship Diagram:
```
┌─────────────────────┐
│    menuitems        │
│  (id, name, price)  │
└──────────┬──────────┘
           │ 1..M
           │
    ┌──────┴────────────┐
    │                   │
┌───┴─────────────┐  ┌──┴─────────────┐
│  order_items    │  │ extra_options   │
│ (item_id ref)   │  │ (JSON in items) │
└───┬─────────────┘  └─────────────────┘
    │ M..1
    │
┌───┴─────────────┐
│     orders      │
│ (id, user_id)   │
└───┬─────────────┘
    │ M..1
    │
┌───┴─────────────┐
│      users      │
│ (user_id, phone)│
└─────────────────┘
```

---

## Indexes for Performance

### Critical Indexes (Already Defined)
```sql
-- Fast user lookups by phone (customer creation/lookup)
CREATE INDEX idx_phone ON users(phone_number);

-- Fast order retrieval for dashboard
CREATE INDEX idx_status ON orders(status);
CREATE INDEX idx_created ON orders(created_at);

-- Fast order detail retrieval
CREATE INDEX idx_order ON order_items(order_id);
CREATE INDEX idx_item ON order_items(item_id);
```

### Recommended Additional Indexes
```sql
-- For analytics (sales by date range)
CREATE INDEX idx_orders_date_range ON orders(created_at, status);

-- For kitchen display system (filter by status)
CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);

-- For customer order history
CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);

-- For menu availability
CREATE INDEX idx_menuitems_available ON menuitems(available, category);
```

---

## Key Constraints

### Foreign Keys
```sql
-- Order must reference existing user
ALTER TABLE orders ADD CONSTRAINT fk_orders_user
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- Order item must reference existing order
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_order
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

-- Order item may reference menu item
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_menu
  FOREIGN KEY (item_id) REFERENCES menuitems(id) ON DELETE SET NULL;
```

### Unique Constraints
```sql
-- Phone numbers must be unique (one user per phone)
ALTER TABLE users ADD CONSTRAINT uk_phone UNIQUE (phone_number);
```

---

## Typical Queries

### Get Order with All Details
```sql
SELECT 
  o.id, o.total_price, o.status, o.created_at,
  u.full_name, u.phone_number,
  oi.quantity, oi.price_at_time, oi.special_note,
  m.name, m.category,
  oi.selected_extras, oi.removed_extras
FROM orders o
JOIN users u ON o.user_id = u.user_id
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN menuitems m ON oi.item_id = m.id
WHERE o.id = ?;
```

### Get Recent Orders by Status
```sql
SELECT o.id, o.total_price, o.status, o.created_at,
       u.full_name, COUNT(oi.id) as item_count
FROM orders o
JOIN users u ON o.user_id = u.user_id
LEFT JOIN order_items oi ON o.id = oi.order_id
WHERE o.status = 'Requested'
  AND o.created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
GROUP BY o.id
ORDER BY o.created_at DESC;
```

### Get Customer Order History
```sql
SELECT o.id, o.total_price, o.status, o.created_at
FROM orders o
WHERE o.user_id = ?
ORDER BY o.created_at DESC
LIMIT 10;
```

### Verify Menu Item Pricing (For Order Validation)
```sql
SELECT id, name, price FROM menuitems WHERE id = ?;
```

### Get All Available Menu Items
```sql
SELECT id, name, category, price, image_url
FROM menuitems
WHERE available = 1
ORDER BY category, name;
```

---

## Data Integrity

### Transaction Safety
All order creation uses transactions:
```sql
START TRANSACTION;
  INSERT INTO users ...;
  INSERT INTO orders ...;
  INSERT INTO order_items ... (multiple rows);
COMMIT;
-- or ROLLBACK on error
```

### Price Tracking
- Menu item prices can change
- `order_items.price_at_time` stores the price charged
- Enables historical accuracy and auditing

### Customer Deduplication
- Phone number used as unique identifier
- Prevents duplicate user records
- Enables loyalty tracking

---

## Backup & Recovery

### Critical Tables for Backup
1. **orders** - Core business data (highest priority)
2. **order_items** - Order detail
3. **users** - Customer base
4. **menuitems** - Business configuration

### Recommended Backup Strategy
```bash
# Daily full backup
mysqldump -u root -p snack_attack > snack_attack_$(date +%Y%m%d).sql

# Weekly with all databases
mysqldump -u root -p --all-databases > full_backup_$(date +%Y%m%d).sql
```

### Retention Policy
- Daily backups: 7 days
- Weekly backups: 4 weeks
- Monthly: 12 months

---

## Scaling Considerations

### Current Limitations
- Single database server
- No replication
- Limited to single region

### For High Volume (100K+ orders/month)
1. Add read replicas for analytics
2. Partition orders by date
3. Archive old orders to separate table
4. Implement caching (Redis) for menu items
5. Use connection pooling (already in place)

### Partition Strategy (Optional)
```sql
-- Partition orders by year
ALTER TABLE orders PARTITION BY RANGE (YEAR(created_at)) (
  PARTITION p2024 VALUES LESS THAN (2025),
  PARTITION p2025 VALUES LESS THAN (2026),
  PARTITION pfuture VALUES LESS THAN MAXVALUE
);
```

---

## Encoding & Collation

All tables use:
```sql
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci
```

This supports:
- Arabic letters (العربية)
- Franco Lebanese (3, 2, 7 notation)
- English
- Emoji

---

**Last Updated:** May 15, 2026
**Database Version:** MySQL 5.7+
