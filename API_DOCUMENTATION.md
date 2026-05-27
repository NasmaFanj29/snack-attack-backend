# 🍔 Snack Attack Backend - API Documentation

## Base URL
```
http://localhost:5000
```

---

## 📋 Table of Contents
1. [Authentication Endpoints](#authentication-endpoints)
2. [Order Management](#order-management)
3. [Menu & Items](#menu--items)
4. [Payment Processing](#payment-processing)
5. [Chat & AI](#chat--ai)
6. [Socket.io Events](#socketio-events)
7. [Error Handling](#error-handling)

---

## Authentication Endpoints

### Staff Login
**POST** `/staff/login`

Login staff members with username and password.

**Request Body:**
```json
{
  "username": "admin",
  "password": "snack2024"
}
```

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "role": "admin",
  "name": "Admin"
}
```

**Status Codes:**
- `200` - Login successful
- `401` - Invalid credentials
- `429` - Too many login attempts (rate limited: 10 attempts per 15 minutes)
- `400` - Validation error

**Default Staff Users:**
| Username | Password | Role | Name |
|----------|----------|------|------|
| admin | snack2024 | admin | Admin |
| waiter1 | waiter123 | waiter | Ahmad |
| waiter2 | waiter456 | waiter | Sara |
| kitchen | kitchen123 | kitchen | Kitchen Team |

**Auth Header Format:**
All protected routes require this header:
```
Authorization: Bearer <token>
```

---

## Order Management

### Place Order
**POST** `/place-order`

Create a new customer order. Server validates all items against menu prices.

**Request Body:**
```json
{
  "customer": {
    "name": "Ahmed Hassan",
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
      "selectedExtras": [{ "id": 1, "name": "Extra Cheese", "price": 1.50 }],
      "removedExtras": [{ "id": 3, "name": "Tomato" }],
      "specialNote": "No onions please"
    }
  ],
  "payment_splits": [
    { "method": "cash", "amount": 20 },
    { "method": "card", "amount": 25.99 }
  ]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "orderId": 42,
  "savedCount": 1
}
```

**Status Codes:**
- `200` - Order created successfully
- `400` - Validation error
- `500` - Server error

**Validation Rules:**
- `customer.name`: optional, string, 1-100 characters
- `customer.phone`: optional, string, 6-25 characters
- `table_id`: optional, positive integer
- `total_price`: required, float > 0
- `items`: required, array with minimum 1 item
- `items[].quantity`: optional, positive integer (default: 1)
- `items[].price`: optional, float > 0

**Security Features:**
- Server-side price verification against menu database
- XSS sanitization on text fields
- Transaction rollback on failure

---

### Get All Orders (Admin)
**GET** `/admin/orders`

Retrieve all orders with full details including items and customer info.

**Auth:** Required - Admin, Waiter, or Kitchen role

**Response (200 OK):**
```json
[
  {
    "id": 1,
    "user_id": 5,
    "table_id": 3,
    "total_price": "45.99",
    "status": "Paid",
    "payment_splits": "[{\"method\":\"cash\",\"amount\":20}]",
    "items": [
      {
        "id": 10,
        "order_id": 1,
        "item_id": 2,
        "quantity": 2,
        "price_at_time": "12.50",
        "special_note": "No onions",
        "removed_extras": "[]",
        "selected_extras": "[{\"id\":1,\"name\":\"Extra Cheese\"}]",
        "name": "Cheese Burger"
      }
    ]
  }
]
```

**Status Codes:**
- `200` - Success
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)

---

### Get Single Order
**GET** `/orders/:id`

Retrieve a specific order with all items and extras.

**Path Parameters:**
- `id` (required): Order ID (positive integer)

**Response (200 OK):**
```json
{
  "order": {
    "id": 42,
    "user_id": 10,
    "table_id": 5,
    "total_price": "45.99",
    "status": "Requested",
    "payment_splits": "[]"
  },
  "items": [
    {
      "id": 100,
      "order_id": 42,
      "item_id": 1,
      "quantity": 2,
      "price_at_time": "12.50",
      "special_note": "No onions please",
      "removed_extras": [],
      "selected_extras": [{ "id": 1, "name": "Extra Cheese", "price": 1.50 }],
      "name": "Cheese Burger"
    }
  ]
}
```

**Status Codes:**
- `200` - Success
- `400` - Invalid order ID format
- `404` - Order not found

---

### Update Order Status (Admin)
**PUT** `/admin/orders/:id/status`

Update order status with optional payment splits and rejection reason.

**Auth:** Required - Admin, Waiter, or Kitchen role

**Path Parameters:**
- `id` (required): Order ID (positive integer)

**Request Body:**
```json
{
  "status": "Preparing",
  "payment_splits": [{ "method": "card", "amount": 45.99 }],
  "reason": "No special requests"
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Valid Status Values:**
- `Requested`
- `Confirmed`
- `Preparing`
- `Ready`
- `Paid`
- `Completed`
- `Cancelled`
- `Payment Failed`

**Status Codes:**
- `200` - Updated successfully
- `400` - Validation error or no fields to update
- `401` - Unauthorized
- `403` - Forbidden
- `500` - Server error

---

### Delete Order (Admin)
**DELETE** `/admin/orders/:id`

Permanently delete an order and all associated items.

**Auth:** Required - Admin role

**Path Parameters:**
- `id` (required): Order ID (positive integer)

**Response (200 OK):**
```json
{
  "success": true
}
```

**Status Codes:**
- `200` - Deleted successfully
- `401` - Unauthorized
- `403` - Forbidden (insufficient permissions)
- `500` - Server error

**Warning:** This operation is irreversible.

---

## Menu & Items

### Get Menu
**GET** `/menu`

Fetch all available menu items.

**Response (200 OK):**
```json
[
  {
    "id": 1,
    "name": "Cheese Burger",
    "category": "Burgers",
    "price": "12.50",
    "description": "Beef patty with melted cheddar cheese",
    "image_url": "/images/cheese_burger.jpg",
    "available": 1
  },
  {
    "id": 2,
    "name": "Fries",
    "category": "Sides",
    "price": "3.99",
    "description": "Golden crispy fries",
    "image_url": "/images/fries.jpg",
    "available": 1
  }
]
```

**Status Codes:**
- `200` - Success
- `500` - Server error

---

### Get Extras/Add-ons
**GET** `/extras`

Fetch all available add-on options.

**Response (200 OK):**
```json
[
  {
    "id": 1,
    "name": "Extra Cheese",
    "price": "1.50"
  },
  {
    "id": 2,
    "name": "Bacon",
    "price": "2.00"
  },
  {
    "id": 3,
    "name": "Mushrooms",
    "price": "1.00"
  }
]
```

**Status Codes:**
- `200` - Success
- `500` - Server error

---

### Get Item Extras
**GET** `/item-extras/:id`

Get all available extras for a specific menu item.

**Path Parameters:**
- `id` (required): Menu item ID (positive integer)

**Response (200 OK):**
```json
{
  "itemId": 1,
  "extras": [
    {
      "id": 1,
      "name": "Extra Cheese",
      "price": "1.50"
    },
    {
      "id": 2,
      "name": "Bacon",
      "price": "2.00"
    }
  ]
}
```

**Status Codes:**
- `200` - Success
- `400` - Invalid item ID format
- `500` - Server error

---

## Payment Processing

### Create Payment Intent
**POST** `/payment-intent`

Create a Stripe payment intent for order processing.

**Request Body:**
```json
{
  "amount": 4599,
  "orderId": 42
}
```

**Response (200 OK):**
```json
{
  "clientSecret": "pi_1A2b3C4d5E6f7G8h_secret_9I0j1K2l3M4n5O6p",
  "publishableKey": "pk_test_..."
}
```

**Status Codes:**
- `200` - Intent created
- `400` - Validation error (amount must be > 0)
- `402` - Stripe error
- `500` - Server error

**Notes:**
- Amount is in cents (e.g., 4599 = $45.99 USD)
- `orderId` is optional but recommended for tracking
- Client uses `clientSecret` to complete payment on frontend

---

### Stripe Webhook
**POST** `/webhook`

Receive Stripe webhook events for payment status updates. This endpoint uses raw body parsing.

**Header Requirements:**
```
Content-Type: application/json
stripe-signature: t_xxx...,v1=yyy...
```

**Handled Events:**
- `payment_intent.succeeded` → Updates order status to "Paid"
- `payment_intent.payment_failed` → Updates order status to "Payment Failed"

**Response (200 OK):**
```json
{
  "received": true
}
```

**Status Codes:**
- `200` - Event processed
- `400` - Signature invalid or missing
- `500` - Webhook secret not configured

**Security:**
- Signature validation required (prevents spoofing)
- Event ID caching prevents duplicate processing
- Server-side order status update validation

---

## Chat & AI

### AI Chat (Gemini)
**POST** `/api/chat`

Send messages to Gemini AI assistant for order processing and menu questions.

**Request Body:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Shu fi 3al menu?"
    },
    {
      "role": "assistant",
      "content": "Fi burgers, fries, drinks, w kteer..."
    }
  ],
  "menuItems": [
    { "name": "Cheese Burger", "price": 12.50 },
    { "name": "Fries", "price": 3.99 }
  ]
}
```

**Response (200 OK):**
```json
{
  "reply": "Marhabaa! Biddet cheese burger? Akher collection yalla :)",
  "actions": []
}
```

**Supported Languages:**
- **Arabic:** Standard Arabic letters (أحرف عربية)
- **Franco Lebanese:** Latin + numbers (3, 2, 7 for special characters)
- **English:** Pure English

**AI Assistant Actions:**
- `CART_ADD:Item Name` → Add item to cart
- `CUSTOM_ORDER:{...}` → Place custom burger order
- `NEED_ADMIN:reason` → Escalate to staff

**Status Codes:**
- `200` - Success
- `400` - Missing messages array
- `500` - Gemini API error

**Rate Limiting:** 15 requests per 60 seconds per IP

**Notes:**
- Language is auto-detected from user message
- System prompt enforces language consistency
- Custom burger options: bread, protein, cheese, veggies, sauce

---

## Socket.io Events

### Connection
**Event:** `connect`

Triggered when a client connects to the server.

```javascript
socket.on('connect', () => {
  console.log('Connected with socket ID:', socket.id);
});
```

---

### Join Room
**Event:** `join`

Join a specific room for real-time updates.

**Emit:**
```javascript
socket.emit('join', { type: 'order', id: 42 });
```

**Room Naming:**
- `order:42` → Order room for order ID 42
- `table:5` → Table room for table ID 5
- `admin` → Admin broadcast room
- `kitchen` → Kitchen display room

---

### Order Update
**Event:** `orderUpdate`

Broadcast when an order status changes.

**Listen:**
```javascript
socket.on('orderUpdate', (data) => {
  console.log('Order updated:', data);
});
```

**Data:**
```json
{
  "orderId": 42,
  "status": "Preparing",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

---

### Chat Message
**Event:** `chatMessage`

Real-time chat messages in specific rooms.

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
  console.log(data.message);
});
```

---

### Presence
**Event:** `presence`

Track who is connected in a room.

**Emit:**
```javascript
socket.emit('presence', { type: 'order', id: 42 });
```

**Response:**
```json
{
  "type": "order",
  "id": 42,
  "userCount": 3
}
```

---

## Error Handling

### Global Error Response Format
All errors follow this structure:

```json
{
  "error": "Descriptive error message"
}
```

### Common HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | OK | Successful request |
| 400 | Bad Request | Missing required fields |
| 401 | Unauthorized | Missing/invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 429 | Rate Limited | Too many requests |
| 500 | Server Error | Database connection failed |

### Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| Global | 200 requests | 15 minutes |
| `/staff/login` | 10 attempts | 15 minutes |
| `/api/chat` | 15 requests | 60 seconds |

---

## Security Features

✅ **Implemented:**
- JWT token authentication
- Role-based access control (RBAC)
- Rate limiting on all endpoints
- XSS sanitization (xss-clean)
- CORS with whitelisted origins
- Helmet security headers
- Request validation with express-validator
- Server-side price verification
- Stripe webhook signature validation
- SQL parameterized queries (prepared statements)
- HTTPS support (configurable)

---

## Example Requests

### cURL - Staff Login
```bash
curl -X POST http://localhost:5000/staff/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"snack2024"}'
```

### cURL - Place Order
```bash
curl -X POST http://localhost:5000/place-order \
  -H "Content-Type: application/json" \
  -d '{
    "customer":{"name":"Ahmed","phone":"+961123456789"},
    "table_id":5,
    "total_price":45.99,
    "items":[{"databaseId":1,"quantity":2,"price":12.50}]
  }'
```

### cURL - Get Menu
```bash
curl -X GET http://localhost:5000/menu
```

### cURL - Protected Route (with Token)
```bash
curl -X GET http://localhost:5000/admin/orders \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Frontend Integration

### JavaScript Fetch Example
```javascript
// Login
const response = await fetch('http://localhost:5000/staff/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'snack2024' })
});
const { token } = await response.json();

// Protected request
const ordersResponse = await fetch('http://localhost:5000/admin/orders', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const orders = await ordersResponse.json();
```

---

## WebSocket (Socket.io) Example
```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:5000', {
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('Connected');
  socket.emit('join', { type: 'order', id: 42 });
});

socket.on('orderUpdate', (data) => {
  console.log('Order status:', data.status);
});
```

---

**Last Updated:** May 15, 2026
**API Version:** 1.0.0
