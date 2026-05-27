# 🏗️ Snack Attack - Architecture & Flows

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                             │
│  ├─ Customer Dashboard (menu, ordering, chat)                  │
│  ├─ Staff Portal (admin, kitchen, waiter views)                │
│  └─ Payment UI (Stripe integration)                            │
└──────────────┬──────────────────────────────────────────────────┘
               │ HTTP/WebSocket
               │
┌──────────────▼──────────────────────────────────────────────────┐
│                   NODEJS/EXPRESS SERVER                         │
│  ├─ REST API Routes (orders, menu, payments)                   │
│  ├─ WebSocket (Socket.io) real-time events                     │
│  ├─ Middleware (auth, validation, rate limiting)               │
│  ├─ AI Integration (Gemini chat bot)                           │
│  └─ Payment Processing (Stripe client)                         │
└──────────────┬──────────────────────────────────────────────────┘
               │
      ┌────────┴──────────┬──────────────────────┐
      │                   │                      │
┌─────▼─────┐   ┌─────────▼────────┐   ┌────────▼─────────┐
│  MySQL    │   │  Stripe API      │   │  Gemini API      │
│ Database  │   │  - Payments      │   │  - Chat/Orders   │
│           │   │  - Webhooks      │   │  - AI responses  │
└───────────┘   └──────────────────┘   └──────────────────┘
```

---

## 1. Authentication Flow

### Overview
- **Type:** JWT (JSON Web Tokens)
- **For:** Staff members only (admin, waiter, kitchen)
- **Customers:** No authentication (anonymous orders)

### JWT Authentication Architecture

```
┌─────────────────────────────────────────────────────────┐
│  1. STAFF LOGIN REQUEST                                 │
│     POST /staff/login                                   │
│     { username: "admin", password: "snack2024" }        │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│  2. SERVER VERIFICATION                                 │
│     - Find staff user in memory/env                      │
│     - Hash check password with bcrypt                    │
│     - Compare stored hash vs input                       │
└─────────────────────┬───────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │ Match ✓                    │ No Match ✗
        │                            │
        ▼                            ▼
┌──────────────────────┐      ┌──────────────────────┐
│ Create JWT Token     │      │ Return 401           │
│ - username           │      │ "Invalid credentials"│
│ - role               │      │                      │
│ - name               │      │ (No token)           │
│ - expiresIn: 8h      │      └──────────────────────┘
└──────────┬───────────┘
           │
┌──────────▼───────────────────────────────────────────────┐
│  3. RESPONSE                                             │
│     {                                                   │
│       "token": "eyJhbGc...",                           │
│       "role": "admin",                                 │
│       "name": "Admin"                                  │
│     }                                                  │
└──────────┬───────────────────────────────────────────────┘
           │
┌──────────▼───────────────────────────────────────────────┐
│  4. CLIENT STORES TOKEN                                  │
│     localStorage.setItem('token', token)               │
└──────────┬───────────────────────────────────────────────┘
           │
┌──────────▼───────────────────────────────────────────────┐
│  5. FUTURE REQUESTS                                      │
│     GET /admin/orders                                   │
│     Authorization: Bearer eyJhbGc...                   │
└──────────┬───────────────────────────────────────────────┘
           │
┌──────────▼───────────────────────────────────────────────┐
│  6. SERVER VERIFIES TOKEN                                │
│     - Extract from "Authorization: Bearer <token>"      │
│     - Verify signature with JWT_SECRET                  │
│     - Check expiration                                  │
│     - Attach user to req.user                           │
└──────────┬───────────────────────────────────────────────┘
           │
    ┌──────┴──────────┐
    │ Valid ✓         │ Invalid ✗
    │                 │
    ▼                 ▼
┌─────────────────┐ ┌────────────────────┐
│ Process request │ │ Return 401         │
│ req.user = {..} │ │ "Invalid or expired│
│                 │ │  token"            │
└─────────────────┘ └────────────────────┘
```

### JWT Token Structure

**Header:**
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Payload:**
```json
{
  "username": "admin",
  "role": "admin",
  "name": "Admin",
  "iat": 1705329000,
  "exp": 1705365000
}
```

**Signature:**
```
HMACSHA256(
  base64(header) + "." + base64(payload),
  "your_jwt_secret_key"
)
```

### Implementation Details

**File:** [middleware/auth.js](middleware/auth.js)

**Key Functions:**
- `findStaffUser(username)` - Locate staff member
- `verifyPassword(user, password)` - Bcrypt comparison
- `signToken(payload)` - Create JWT
- `authenticateJWT(req, res, next)` - Middleware verification
- `requireRole(...roles)` - Role-based access control

**Stored Staff Users (Default):**
```javascript
[
  { username: "admin", password: "snack2024", role: "admin", name: "Admin" },
  { username: "waiter1", password: "waiter123", role: "waiter", name: "Ahmad" },
  { username: "waiter2", password: "waiter456", role: "waiter", name: "Sara" },
  { username: "kitchen", password: "kitchen123", role: "kitchen", name: "Kitchen Team" }
]
```

### Token Expiration
- **Duration:** 8 hours (configurable via `JWT_EXPIRES_IN`)
- **Refresh:** Client must login again to get new token
- **Security:** Expired tokens are rejected

### Protected Routes Example
```javascript
app.get(
  "/admin/orders",
  authenticateJWT,           // Verify token
  requireRole("admin", "waiter", "kitchen"),  // Check role
  async (req, res) => {
    // Access req.user for user info
    console.log(`Admin: ${req.user.name}`);
  }
);
```

### Role-Based Access Control (RBAC)

| Route | Admin | Waiter | Kitchen | Customer |
|-------|-------|--------|---------|----------|
| POST /place-order | ✅ | ✅ | ✅ | ✅ |
| GET /admin/orders | ✅ | ✅ | ✅ | ❌ |
| PUT /admin/orders/:id/status | ✅ | ✅ | ✅ | ❌ |
| DELETE /admin/orders/:id | ✅ | ❌ | ❌ | ❌ |
| GET /staff/login | ✅ | ✅ | ✅ | ❌ |

---

## 2. Payment Flow

### Overview
- **Provider:** Stripe
- **Type:** Server-side processing
- **Frontend:** Stripe React/JS library (not in this repo)
- **Webhook:** Stripe → Backend for event handling

### Payment Process Flow

```
┌─────────────────────────────────────────────────┐
│  CUSTOMER INTERACTION (Frontend)                │
│  1. Customer adds items to cart                 │
│  2. Customer clicks "Pay with Card"             │
│  3. Stripe.js payment form appears              │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│  FRONTEND → BACKEND                             │
│  POST /payment-intent                           │
│  {                                              │
│    "amount": 4599,        (in cents)            │
│    "orderId": 42                                │
│  }                                              │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│  BACKEND → STRIPE API                           │
│  stripe.paymentIntents.create({                 │
│    amount: 4599,                                │
│    currency: "usd",                             │
│    metadata: { orderId: 42 }                    │
│  })                                             │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│  STRIPE RETURNS Payment Intent                  │
│  {                                              │
│    id: "pi_1A2b3C4d5E6f7G8h",                  │
│    clientSecret: "pi_...secret_xyz",           │
│    status: "requires_payment_method"            │
│  }                                              │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│  BACKEND → FRONTEND (Response)                  │
│  {                                              │
│    "clientSecret": "pi_...secret_xyz",         │
│    "publishableKey": "pk_test_..."             │
│  }                                              │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│  FRONTEND (Stripe.js)                           │
│  1. Stripe elements capture card details        │
│  2. confirmCardPayment(clientSecret, {          │
│       payment_method: {                         │
│         card: element                           │
│       }                                         │
│     })                                          │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│  STRIPE PAYMENT PROCESSING                      │
│  1. Charges card                                │
│  2. Validates card                              │
│  3. Processes transaction                       │
└─────────────┬───────────────────────────────────┘
              │
        ┌─────┴──────────┐
        │ Success        │ Failure
        │ (charge)       │ (decline/error)
        ▼                ▼
┌────────────────┐  ┌──────────────────┐
│ Stripe creates │  │ Stripe sends      │
│ payment_intent │  │ payment_intent.  │
│ succeeded event│  │ payment_failed    │
│                │  │ event             │
└────────┬───────┘  └────────┬──────────┘
         │                   │
   ┌─────▼───────────────────▼─────┐
   │  STRIPE WEBHOOK                │
   │  POST /webhook                 │
   │  (Signed with webhook secret)  │
   └─────┬───────────────────────────┘
         │
   ┌─────▼───────────────────────────┐
   │  BACKEND WEBHOOK HANDLER        │
   │  1. Verify signature            │
   │  2. Check for duplicate event   │
   │  3. Handle event                │
   └─────┬───────────────────────────┘
         │
    ┌────┴──────────────┐
    │ payment_intent.   │ payment_intent.
    │ succeeded         │ payment_failed
    │                   │
    ▼                   ▼
┌─────────────────┐  ┌──────────────────┐
│ UPDATE ORDERS   │  │ UPDATE ORDERS    │
│ SET status =    │  │ SET status =     │
│ 'Paid'          │  │ 'Payment Failed' │
│ WHERE id = 42   │  │ WHERE id = 42    │
└─────────────────┘  └──────────────────┘
         │                   │
         └───────┬───────────┘
                 │
         ┌───────▼────────┐
         │ Frontend polls │
         │ or Socket.io   │
         │ notifies of    │
         │ status change  │
         └────────────────┘
```

### Payment Intent Route

**File:** [index.js](index.js#L768)

```javascript
app.post(
  "/payment-intent",
  validateRequest(paymentIntentValidators),
  asyncHandler(async (req, res) => {
    const { amount, orderId } = req.body;
    
    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be positive" });
    }
    
    // Create Stripe Payment Intent
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),  // Convert to cents
      currency: "usd",
      metadata: { orderId: orderId || null }
    });
    
    // Return to frontend
    res.json({
      clientSecret: intent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
  })
);
```

### Webhook Handler

**File:** [index.js](index.js) (near `/webhook` route)

```javascript
app.post(
  "/webhook",
  rawWebhookParser,
  asyncHandler(async (req, res) => {
    const signature = req.headers["stripe-signature"];
    
    // Verify Stripe signature
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Prevent duplicate processing
    if (webhookEventCache.has(event.id)) {
      return res.status(200).json({ received: true });
    }
    webhookEventCache.add(event.id);
    
    // Handle events
    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata.orderId;
        if (orderId) {
          await pool.query(
            "UPDATE orders SET status = ? WHERE id = ?",
            ["Paid", orderId]
          );
        }
        break;
        
      case "payment_intent.payment_failed":
        const failedIntent = event.data.object;
        const failedOrderId = failedIntent.metadata.orderId;
        if (failedOrderId) {
          await pool.query(
            "UPDATE orders SET status = ? WHERE id = ?",
            ["Payment Failed", failedOrderId]
          );
        }
        break;
    }
    
    res.json({ received: true });
  })
);
```

### Security Measures

✅ **Implemented:**
- Stripe signature verification (prevents spoofing)
- Webhook event deduplication (idempotency)
- Server-side order amount validation
- Amount in cents to prevent floating-point errors
- Environment variable for API keys

⚠️ **Configuration Required:**
- `STRIPE_SECRET_KEY` - Backend API key
- `STRIPE_WEBHOOK_SECRET` - Webhook signing key
- `STRIPE_PUBLISHABLE_KEY` - Frontend key

---

## 3. Socket.io Real-Time Events

### Overview
- **Purpose:** Real-time order updates, chat, presence
- **Transport:** WebSocket + fallback polling
- **Rooms:** Channel-based subscriptions

### Connection Flow

```
┌──────────────────────────────────┐
│  CLIENT CONNECTS                 │
│  io('http://localhost:5000')     │
└─────────────────┬────────────────┘
                  │
┌─────────────────▼────────────────┐
│  'connect' EVENT                 │
│  socket.id = "abc123xyz"         │
└─────────────────┬────────────────┘
                  │
┌─────────────────▼────────────────┐
│  EMIT 'join'                     │
│  socket.emit('join', {           │
│    type: 'order',                │
│    id: 42                        │
│  })                              │
└─────────────────┬────────────────┘
                  │
┌─────────────────▼────────────────┐
│  SERVER RECEIVES 'join'          │
│  Room: "order:42"                │
│  socket.join("order:42")         │
└─────────────────┬────────────────┘
                  │
┌─────────────────▼────────────────┐
│  LISTEN FOR EVENTS               │
│  - orderUpdate                   │
│  - chatMessage                   │
│  - presence                      │
└──────────────────────────────────┘
```

### Supported Events

#### 1. `connect`
**Triggered:** When client connects
```javascript
socket.on('connect', () => {
  console.log('Socket ID:', socket.id);
});
```

#### 2. `join`
**Purpose:** Subscribe to a room
**Emit:**
```javascript
socket.emit('join', {
  type: 'order',      // or 'table', 'admin', 'kitchen'
  id: 42              // order/table ID
});
```

**Room Names:**
- `order:42` - Specific order room
- `table:5` - Specific table room
- `admin` - Admin broadcast room
- `kitchen` - Kitchen display room

#### 3. `orderUpdate`
**Purpose:** Broadcast when order status changes
**Listen:**
```javascript
socket.on('orderUpdate', (data) => {
  console.log(`Order ${data.orderId} is now ${data.status}`);
});
```

**Data Structure:**
```json
{
  "orderId": 42,
  "status": "Preparing",
  "updatedAt": "2024-01-15T10:30:00Z",
  "updatedBy": "waiter1"
}
```

**Broadcast (Server):**
```javascript
io.to(`order:${orderId}`).emit('orderUpdate', {
  orderId: orderId,
  status: newStatus,
  updatedAt: new Date().toISOString(),
  updatedBy: req.user.username
});
```

#### 4. `chatMessage`
**Purpose:** Real-time chat in order/table rooms
**Emit:**
```javascript
socket.emit('chatMessage', {
  room: 'order:42',
  message: 'Order is ready!',
  sender: 'kitchen'
});
```

**Listen:**
```javascript
socket.on('chatMessage', (data) => {
  console.log(`${data.sender}: ${data.message}`);
});
```

#### 5. `presence`
**Purpose:** Track connected users in a room
**Emit:**
```javascript
socket.emit('presence', {
  type: 'order',
  id: 42
});
```

**Response:**
```javascript
socket.on('presenceUpdate', (data) => {
  console.log(`${data.userCount} people viewing this order`);
});
```

### Room Management

```javascript
// Join a room
socket.join('order:42');

// Leave a room
socket.leave('order:42');

// Send to one person
socket.emit('event', data);

// Send to room (except sender)
socket.to('order:42').emit('event', data);

// Send to room (including sender)
io.to('order:42').emit('event', data);

// Broadcast to all
io.emit('event', data);
```

### Presence Tracking

```javascript
const presence = {};  // { "order:42": Set<socketId> }

function getRoomName(type, id) {
  return `${type}:${id}`;
}

socket.on('join', ({ type, id }) => {
  const room = getRoomName(type, id);
  socket.join(room);
  
  if (!presence[room]) presence[room] = new Set();
  presence[room].add(socket.id);
  
  io.to(room).emit('presenceUpdate', {
    room,
    userCount: presence[room].size
  });
});

socket.on('disconnect', () => {
  for (const room in presence) {
    presence[room].delete(socket.id);
    io.to(room).emit('presenceUpdate', {
      room,
      userCount: presence[room].size
    });
  }
});
```

### Security Considerations

✅ **Current Measures:**
- CORS configured for allowed origins
- Can add JWT verification in Socket.io connection

⚠️ **Recommendations:**
```javascript
// Add authentication to Socket.io
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Auth error'));
    socket.user = decoded;
    next();
  });
});
```

### Kitchen Display System (KDS) Example

```javascript
// Kitchen staff joins
socket.emit('join', { type: 'kitchen' });

// Kitchen receives new orders
socket.on('orderUpdate', (data) => {
  if (data.status === 'Confirmed') {
    displayOnKitchenScreen(data.orderId);
  }
});

// Kitchen updates status
socket.emit('orderUpdate', {
  orderId: 42,
  status: 'Ready'
});
```

---

## 4. Order Processing Pipeline

### Complete Order Journey

```
1. CUSTOMER PLACES ORDER
   ├─ POST /place-order (with validation)
   ├─ Create user if new (by phone)
   ├─ Validate items against menu prices
   ├─ Create order record (status: "Requested")
   ├─ Create order_items records
   └─ Return orderId to frontend

2. PAYMENT (Optional)
   ├─ POST /payment-intent
   ├─ Stripe processes payment
   ├─ Webhook updates order status → "Paid"
   └─ Socket.io notifies all clients

3. STAFF CONFIRMATION
   ├─ Waiter/Admin views orders
   ├─ PUT /admin/orders/:id/status (→ "Confirmed")
   ├─ Socket.io notifies order viewers
   └─ Kitchen sees on display system

4. KITCHEN PREPARATION
   ├─ Kitchen views confirmed orders
   ├─ Staff prepares items
   ├─ PUT /admin/orders/:id/status (→ "Preparing")
   ├─ Socket.io updates customer UI
   └─ Estimated time calculated

5. ORDER READY
   ├─ PUT /admin/orders/:id/status (→ "Ready")
   ├─ Socket.io notifies customer
   ├─ Notification sent (SMS/Push if configured)
   └─ Customer collects or receives

6. COMPLETION
   ├─ PUT /admin/orders/:id/status (→ "Completed")
   ├─ Receipt generated
   ├─ Loyalty points credited (if registered)
   └─ Order archived
```

---

## 5. Error Handling Strategy

### Error Hierarchy

```
┌─────────────────────────────────┐
│  Client Error (4xx)             │
│  ├─ 400 Bad Request             │
│  ├─ 401 Unauthorized            │
│  ├─ 403 Forbidden               │
│  ├─ 404 Not Found               │
│  └─ 429 Too Many Requests       │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  Server Error (5xx)             │
│  ├─ 500 Internal Error          │
│  └─ Database/External API error │
└─────────────────────────────────┘
```

### Error Response Format

```json
{
  "error": "Descriptive error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### Middleware Error Handler

```javascript
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});
```

---

**Last Updated:** May 15, 2026
