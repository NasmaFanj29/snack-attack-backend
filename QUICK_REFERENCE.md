# 📋 Quick Reference Card

## API Endpoints Cheat Sheet

### Authentication
```bash
# Login
curl -X POST http://localhost:5000/staff/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"snack2024"}'
```

### Orders - Public
```bash
# Create order
curl -X POST http://localhost:5000/place-order \
  -H "Content-Type: application/json" \
  -d '{
    "customer":{"name":"John","phone":"+961123456"},
    "table_id":5,
    "total_price":45.99,
    "items":[{"databaseId":1,"quantity":2,"price":12.50}]
  }'

# Get order details
curl http://localhost:5000/orders/42

# Get menu
curl http://localhost:5000/menu

# Get extras
curl http://localhost:5000/extras
```

### Orders - Protected (Need Token)
```bash
# Get all orders
curl http://localhost:5000/admin/orders \
  -H "Authorization: Bearer YOUR_TOKEN"

# Update order status
curl -X PUT http://localhost:5000/admin/orders/42/status \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"Preparing"}'

# Delete order
curl -X DELETE http://localhost:5000/admin/orders/42 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Payment
```bash
# Create payment intent
curl -X POST http://localhost:5000/payment-intent \
  -H "Content-Type: application/json" \
  -d '{"amount":4599,"orderId":42}'
```

### Chat
```bash
# Send message to AI
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages":[{"role":"user","content":"Shu fi 3al menu?"}],
    "menuItems":[{"name":"Burger","price":12.50}]
  }'
```

---

## Database Commands Cheat Sheet

### Connection
```bash
# Connect to MySQL
mysql -u root -p

# Show databases
SHOW DATABASES;

# Use snack_attack
USE snack_attack;

# Show tables
SHOW TABLES;
```

### Common Queries
```sql
-- Get menu items
SELECT id, name, category, price FROM menuitems;

-- Get all orders
SELECT * FROM orders ORDER BY created_at DESC;

-- Get order with items
SELECT o.*, oi.quantity, m.name 
FROM orders o
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN menuitems m ON oi.item_id = m.id
WHERE o.id = 42;

-- Get recent paid orders
SELECT * FROM orders WHERE status = 'Paid' AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY);

-- Customer order history
SELECT * FROM orders WHERE user_id = 10 ORDER BY created_at DESC;

-- Export orders
SELECT * FROM orders INTO OUTFILE '/tmp/orders.csv' FIELDS TERMINATED BY ',';
```

### Backup & Restore
```bash
# Backup
mysqldump -u root -p snack_attack > backup.sql
gzip backup.sql

# Restore
mysql -u root -p snack_attack < backup.sql
```

---

## Environment Variables Reference

```env
# REQUIRED
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=password
JWT_SECRET=minimum_32_character_secret
STRIPE_SECRET_KEY=sk_test_xxx

# OPTIONAL
DB_PORT=3306 (default)
NODE_ENV=development
PORT=5000
CORS_ORIGINS=http://localhost:3000
DB_CONNECTION_LIMIT=10
```

---

## Status Codes Quick Reference

| Code | Meaning | Example |
|------|---------|---------|
| 200 | OK | Request successful |
| 400 | Bad Request | Missing required field |
| 401 | Unauthorized | Missing/invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 429 | Too Many Requests | Rate limited |
| 500 | Server Error | Database connection failed |

---

## JWT Token Structure

**Format:** `eyJhbGc...eyJudXs...MTE0NDM...`

**Parts:**
1. Header: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`
2. Payload: `eyJVc2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIn0`
3. Signature: `SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`

**Payload Contains:**
```json
{
  "username": "admin",
  "role": "admin",
  "name": "Admin",
  "iat": 1705329000,
  "exp": 1705365000
}
```

**Using Token:**
```
Authorization: Bearer eyJhbGc...
```

---

## Order Status Flow

```
Requested → Confirmed → Preparing → Ready → Paid → Completed
    ↓                                              ↓
    └─→ Cancelled                    Payment Failed
```

**Valid Statuses:**
- `Requested` - Initial state
- `Confirmed` - Staff approved
- `Preparing` - Being made
- `Ready` - Ready for pickup
- `Paid` - Payment received
- `Completed` - Fulfilled
- `Cancelled` - Cancelled
- `Payment Failed` - Payment error

---

## Socket.io Events Quick Reference

### Connect
```javascript
socket.on('connect', () => {
  console.log('Connected:', socket.id);
});
```

### Join Room
```javascript
socket.emit('join', { type: 'order', id: 42 });
// Rooms: 'order:42', 'table:5', 'admin', 'kitchen'
```

### Listen for Updates
```javascript
socket.on('orderUpdate', (data) => {
  // { orderId, status, updatedAt, updatedBy }
});

socket.on('chatMessage', (data) => {
  // { room, message, sender }
});

socket.on('presenceUpdate', (data) => {
  // { room, userCount }
});
```

### Emit Event
```javascript
socket.emit('chatMessage', {
  room: 'order:42',
  message: 'Ready!',
  sender: 'kitchen'
});
```

---

## Request/Response Examples

### Place Order Request
```json
{
  "customer": {
    "name": "Ahmed",
    "phone": "+961123456789"
  },
  "table_id": 5,
  "total_price": 45.99,
  "items": [
    {
      "databaseId": 1,
      "name": "Cheese Burger",
      "quantity": 2,
      "price": 12.50,
      "selectedExtras": [
        { "id": 1, "name": "Extra Cheese", "price": 1.50 }
      ]
    }
  ],
  "payment_splits": [
    { "method": "cash", "amount": 20.00 },
    { "method": "card", "amount": 25.99 }
  ]
}
```

### Login Response
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "role": "admin",
  "name": "Admin"
}
```

### Order Response
```json
{
  "order": {
    "id": 42,
    "user_id": 10,
    "table_id": 5,
    "total_price": "45.99",
    "status": "Preparing",
    "created_at": "2024-01-15T10:30:00Z"
  },
  "items": [
    {
      "id": 100,
      "quantity": 2,
      "price_at_time": "12.50",
      "special_note": "No onions",
      "name": "Cheese Burger"
    }
  ]
}
```

### Error Response
```json
{
  "error": "Invalid credentials"
}
```

---

## Important Constants

### Default Staff Users
```javascript
{
  "admin": "snack2024",
  "waiter1": "waiter123",
  "waiter2": "waiter456",
  "kitchen": "kitchen123"
}
```

### Rate Limits
```javascript
Global: 200 requests per 15 minutes
Login: 10 attempts per 15 minutes
Chat: 15 requests per 60 seconds
```

### Token Expiration
```
8 hours (28,800 seconds)
```

### Max Payload Size
```
10 KB (10240 bytes)
```

### Database Pool
```
Min: 1 connection
Max: 10 connections
Queue: unlimited
```

---

## Middleware Stack Order

```
1. helmet()                    # Security headers
2. cors()                      # CORS handling
3. xssClean()                 # XSS protection
4. express.json()             # JSON parsing
5. express.static()           # Image serving
6. globalLimiter              # Rate limiting
7. authLimiter                # Auth rate limiting
8. chatLimiter                # Chat rate limiting
9. authenticateJWT            # Token verification
10. requireRole()             # Role checking
11. validateRequest()         # Input validation
12. Route handlers
13. 404 handler
14. Error handler
```

---

## Common Issues & Fixes

### Token Expired (401)
```
❌ {"error": "Invalid or expired token"}
✓ Solution: Login again with /staff/login
```

### Rate Limited (429)
```
❌ {"error": "Too many requests..."}
✓ Solution: Wait 15 minutes or adjust limits
```

### Validation Error (400)
```
❌ {"errors": [{"field": "email", "msg": "..."}]}
✓ Solution: Check required fields in request
```

### No Database (500)
```
❌ {"error": "Error executing..."}
✓ Solution: Check DB_HOST, DB_USER, DB_PASSWORD
```

---

## Performance Tips

1. **Use indexes** on frequently queried columns
2. **Batch operations** instead of individual queries
3. **Cache menu items** (doesn't change often)
4. **Use connection pooling** (already configured)
5. **Limit JSON payload** to 10KB
6. **Enable gzip** compression
7. **Use CDN** for images
8. **Monitor slow queries** (>1 second)

---

## Security Checklist

- [ ] Change all default passwords
- [ ] Set strong JWT_SECRET (32+ chars)
- [ ] Enable HTTPS in production
- [ ] Whitelist CORS origins
- [ ] Verify Stripe webhook secret
- [ ] Use environment variables (not hardcoded)
- [ ] Rotate secrets regularly
- [ ] Enable database SSL
- [ ] Setup error logging
- [ ] Monitor for unusual activity

---

## Useful NPM Commands

```bash
npm list                    # Show installed packages
npm update                  # Update all packages
npm audit                   # Check for vulnerabilities
npm audit fix              # Auto-fix vulnerabilities
npm outdated               # Show outdated packages
npm search <package>       # Search npm registry
npm info <package>         # Get package info
```

---

## Git Quick Commands

```bash
git status                 # Check what changed
git add .                 # Stage all changes
git commit -m "msg"       # Commit changes
git push origin main      # Push to main
git pull origin main      # Pull latest
git log --oneline         # View history
git diff                  # See changes
git reset --hard HEAD~1   # Undo last commit
```

---

## Testing Curl Examples

### Full Order Workflow
```bash
# 1. Get menu
curl http://localhost:5000/menu | jq

# 2. Get extras
curl http://localhost:5000/extras | jq

# 3. Place order
ORDER=$(curl -X POST http://localhost:5000/place-order \
  -H "Content-Type: application/json" \
  -d '{
    "customer":{"name":"Test","phone":"+961000000"},
    "total_price":25.50,
    "items":[{"databaseId":1,"quantity":1,"price":12.50}]
  }')
echo $ORDER | jq

# 4. Get order
ORDER_ID=$(echo $ORDER | jq -r '.orderId')
curl http://localhost:5000/orders/$ORDER_ID | jq

# 5. Login
TOKEN=$(curl -X POST http://localhost:5000/staff/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"snack2024"}' \
  | jq -r '.token')
echo $TOKEN

# 6. View all orders
curl http://localhost:5000/admin/orders \
  -H "Authorization: Bearer $TOKEN" | jq

# 7. Update status
curl -X PUT http://localhost:5000/admin/orders/$ORDER_ID/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"Preparing"}' | jq
```

---

**Last Updated:** May 15, 2026  
**Quick Reference Version:** 1.0
