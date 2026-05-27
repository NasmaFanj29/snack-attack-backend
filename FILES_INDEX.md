# 📑 Complete Project Files Index

## All Backend Files & Documentation

```
snack-attack/backend/
├── 🚀 EXECUTABLE FILES
│   ├── index.js                          (687 lines) Main server - ALL routes & Socket.io
│   ├── db.js                             (20 lines)  MySQL connection pool
│   └── utils.js                          (50 lines)  Helper utilities
│
├── ⚙️ CONFIGURATION FILES
│   ├── package.json                      (30 lines)  Dependencies & npm scripts
│   ├── package-lock.json                 Auto-generated - Lock file
│   ├── .env                              PRIVATE - Your secrets (DO NOT SHARE)
│   ├── .env.example                      (40 lines)  PUBLIC - Template for .env
│   └── .gitignore                        Git ignore rules
│
├── 🔐 MIDDLEWARE FILES
│   └── middleware/
│       ├── auth.js                       (70 lines)  JWT auth & role checking
│       └── validation.js                 (50 lines)  Express-validator rules
│
├── 📚 DOCUMENTATION (2000+ lines total)
│   ├── README.md                         (300 lines) ⭐ START HERE - Project overview
│   ├── QUICK_REFERENCE.md                (300 lines) API cheatsheet & commands
│   ├── API_DOCUMENTATION.md              (600 lines) Complete API reference
│   ├── DATABASE_SCHEMA.md                (500 lines) DB tables & queries
│   ├── ARCHITECTURE.md                   (700 lines) Auth/Payment/Socket.io flows
│   ├── DEPLOYMENT.md                     (600 lines) Setup & deployment guide
│   ├── PROJECT_SUMMARY.md                (400 lines) Complete project overview
│   └── FILES_INDEX.md                    (This file) Project structure index
│
├── 📁 STATIC FILES
│   └── images/                           Menu item images
│
└── 🗂️ SYSTEM FILES
    ├── .git/                             Git version control
    └── node_modules/                     Installed npm packages

```

---

## File-by-File Overview

### Core Application Files

#### `index.js` - Main Server (687 lines)
**Purpose:** Express server with ALL routes, middleware setup, and Socket.io

**Key Sections:**
1. Imports & Setup (lines 1-35)
2. Express & CORS Configuration (lines 35-65)
3. Middleware Stack (lines 65-100)
4. Helper Functions (lines 100-180)
5. Order Validation (lines 180-240)
6. **Order Routes:** (lines 240-400)
   - POST /place-order
   - GET /admin/orders
   - GET /orders/:id
   - PUT /admin/orders/:id/status
   - DELETE /admin/orders/:id
7. **Menu Routes:** (lines 400-430)
   - GET /menu
   - GET /extras
   - GET /item-extras/:id
8. **Staff Routes:** (lines 430-470)
   - POST /staff/login
9. **AI Chat Route:** (lines 470-700)
   - POST /api/chat (Gemini integration)
10. **Socket.io Setup** (lines throughout)
11. **Stripe Webhook:** (lines near 768)
    - POST /webhook
12. **Error Handling & Startup** (end of file)

**You Will Use:** Review this to understand all API routes

---

#### `db.js` - Database Connection (20 lines)
**Purpose:** MySQL connection pool configuration

**Contents:**
- MySQL pool setup with configurable host/port/user/password
- SSL support for cloud databases
- Connection limits (default: 10)
- Warning if credentials missing

**You Will Use:** Called by index.js for all database queries

---

#### `utils.js` - Utilities (50 lines)
**Purpose:** Helper functions used throughout

**Functions:**
1. `parseJsonSafe(str)` - Safe JSON parsing
2. `detectLanguage(text)` - Arabic/Franco/English detection
3. `sanitizeText(value)` - HTML entity escaping (XSS prevention)
4. `asyncHandler(fn)` - Express async error catching

**You Will Use:** Called by routes for data processing

---

### Configuration Files

#### `package.json` - NPM Configuration (30 lines)
**Purpose:** Project metadata and dependency management

**Contains:**
- Project name/version
- npm scripts (start, dev)
- 12 production dependencies
- 1 dev dependency (nodemon)

**Key Dependencies:**
```json
{
  "express": "^5.2.1",
  "mysql2": "^3.16.0",
  "socket.io": "^4.8.3",
  "stripe": "^22.1.1",
  "jsonwebtoken": "^9.0.0",
  "bcryptjs": "^2.4.3",
  "helmet": "^7.0.0",
  "express-rate-limit": "^7.0.0",
  "cors": "^2.8.6",
  "express-validator": "^7.0.1",
  "xss-clean": "^0.1.1",
  "dotenv": "^17.4.2"
}
```

**You Will Use:** `npm install` to install all packages

---

#### `.env` - Environment Variables (Private)
**⚠️ DO NOT COMMIT TO GIT**

**Contains:**
- Database credentials
- API keys (Stripe, Gemini)
- JWT secret
- Server configuration

**You Will Use:** Set values specific to your environment

---

#### `.env.example` - Environment Template (40 lines)
**Purpose:** Safe template showing what variables are needed

**You Will Use:** Copy this to `.env` and fill in your values

---

### Middleware Files

#### `middleware/auth.js` - Authentication (70 lines)
**Purpose:** JWT token generation and verification, staff user management

**Exports:**
1. `findStaffUser(username)` - Locate staff member
2. `verifyPassword(user, password)` - Bcrypt password check
3. `signToken(payload)` - Create JWT token
4. `authenticateJWT(req, res, next)` - Express middleware
5. `requireRole(...roles)` - Role-based access middleware

**Default Staff:**
```javascript
[
  { username: "admin", password: "snack2024", role: "admin" },
  { username: "waiter1", password: "waiter123", role: "waiter" },
  { username: "waiter2", password: "waiter456", role: "waiter" },
  { username: "kitchen", password: "kitchen123", role: "kitchen" }
]
```

**You Will Use:** Import in index.js for protected routes

---

#### `middleware/validation.js` - Input Validation (50 lines)
**Purpose:** Express-validator rules for all inputs

**Validators Defined:**
1. `validateRequest()` - Middleware to run validators
2. `placeOrderValidators` - Order fields
3. `staffLoginValidators` - Login credentials
4. `paymentIntentValidators` - Payment amount
5. `chatValidators` - Chat messages
6. `orderIdParamValidator` - ID format

**You Will Use:** Applied to routes for input validation

---

### Documentation Files

| File | Purpose | Read Time | Lines |
|------|---------|-----------|-------|
| **README.md** | ⭐ Start here - Overview | 5 min | 300 |
| **QUICK_REFERENCE.md** | API cheatsheet | 5 min | 300 |
| **API_DOCUMENTATION.md** | Complete endpoint ref | 20 min | 600 |
| **DATABASE_SCHEMA.md** | DB structure | 20 min | 500 |
| **ARCHITECTURE.md** | System design | 20 min | 700 |
| **DEPLOYMENT.md** | Setup & deployment | 20 min | 600 |
| **PROJECT_SUMMARY.md** | Complete overview | 10 min | 400 |

---

## Database Files

### Database: `snack_attack`

#### Tables (6 total)

**1. `users`** - Customer information
```sql
Columns: user_id, full_name, phone_number, qlub_balance
```

**2. `orders`** - Order records
```sql
Columns: id, user_id, table_id, total_price, status, 
         payment_splits, rejection_reason, created_at, updated_at
```

**3. `order_items`** - Items in orders
```sql
Columns: id, order_id, item_id, quantity, price_at_time, 
         special_note, removed_extras, selected_extras
```

**4. `menuitems`** - Menu items
```sql
Columns: id, name, category, price, description, image_url, available
```

**5. `extra_options`** - Add-on items
```sql
Columns: id, name, price
```

**6. `staff_users`** - (Deprecated, now in-memory in auth.js)

---

## API Routes Quick Map

### Public Routes (No Auth Required)
```
POST   /place-order                 → Create order
GET    /menu                        → Get menu items
GET    /extras                      → Get add-ons
GET    /item-extras/:id             → Get item extras
GET    /orders/:id                  → Get order details
POST   /payment-intent              → Stripe payment
POST   /webhook                     → Stripe webhook
POST   /api/chat                    → Gemini chat
POST   /staff/login                 → Staff authentication
```

### Protected Routes (Auth Required)
```
GET    /admin/orders                → List all orders
PUT    /admin/orders/:id/status     → Update status
DELETE /admin/orders/:id            → Delete order
```

---

## Middleware Stack (Applied in Order)

1. `helmet()` - Security headers
2. `cors()` - CORS handling
3. `xssClean()` - XSS protection
4. `express.json()` - JSON parsing
5. `express.static()` - Image serving
6. `globalLimiter` - Rate limiting (200/15min)
7. `authLimiter` - Auth limiter (10/15min)
8. `chatLimiter` - Chat limiter (15/60sec)
9. Route handlers
10. 404 handler
11. Error handler

---

## Authentication Flow

```
/staff/login
    ↓
findStaffUser() → verifyPassword() → signToken()
    ↓
Return JWT token
    ↓
Client stores in localStorage
    ↓
Protected route with authenticateJWT
    ↓
Verify token signature
    ↓
Check token expiration
    ↓
Extract user claims
    ↓
requireRole() checks authorization
    ↓
Proceed or return 403
```

---

## Socket.io Events

### Available Events
1. `connect` - Client connects
2. `join` - Subscribe to room
3. `orderUpdate` - Status change
4. `chatMessage` - Room chat
5. `presence` - User count

### Room Names
- `order:42` - Order room
- `table:5` - Table room
- `admin` - Admin broadcast
- `kitchen` - Kitchen display

---

## Environment Variables Summary

### Database (Required)
```
DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE
```

### Security (Required)
```
JWT_SECRET (32+ chars)
STRIPE_SECRET_KEY
```

### Optional
```
NODE_ENV, PORT, CORS_ORIGINS, DB_CONNECTION_LIMIT, etc.
```

---

## Deployment Files

| Platform | Files Needed |
|----------|-------------|
| Heroku | Procfile |
| Docker | Dockerfile |
| AWS EC2 | package.json |
| Railway | app.yaml |

---

## Git Repository Structure

```
.git/
├── objects/          → Compressed data
├── refs/             → Branch pointers
├── HEAD              → Current branch
├── config            → Git config
└── logs/             → Commit history

.gitignore contains:
- .env               (private secrets)
- node_modules/      (installed packages)
- *.log              (log files)
- .DS_Store          (Mac files)
```

---

## File Size Summary

| Component | Lines | Size |
|-----------|-------|------|
| Core Code | ~750 | 25 KB |
| Middleware | ~120 | 4 KB |
| Config | ~100 | 3 KB |
| Documentation | 2000+ | 150 KB |
| **TOTAL** | **2970+** | **182 KB** |

---

## Reading Guide by Role

### 👨‍💻 Backend Developer
1. README.md (project overview)
2. index.js (main code)
3. middleware/ (auth & validation)
4. API_DOCUMENTATION.md (endpoints)
5. DATABASE_SCHEMA.md (queries)

### 🔌 Frontend Developer
1. README.md (overview)
2. QUICK_REFERENCE.md (cheatsheet)
3. API_DOCUMENTATION.md (endpoints)
4. ARCHITECTURE.md (auth/payment flows)

### 🚀 DevOps/Deployment
1. DEPLOYMENT.md (setup guide)
2. .env.example (configuration)
3. package.json (dependencies)
4. db.js (database config)

### 👨‍⚖️ Project Manager
1. PROJECT_SUMMARY.md (overview)
2. README.md (features)
3. ARCHITECTURE.md (system design)

### 🧪 QA/Tester
1. QUICK_REFERENCE.md (test commands)
2. API_DOCUMENTATION.md (endpoints)
3. Test curl examples section

---

## Quick Access Guide

### "I want to..."

**...understand the project**
→ README.md → PROJECT_SUMMARY.md

**...use the API**
→ QUICK_REFERENCE.md → API_DOCUMENTATION.md

**...modify the database**
→ DATABASE_SCHEMA.md

**...understand how auth works**
→ ARCHITECTURE.md (Section 1)

**...process payments**
→ ARCHITECTURE.md (Section 2)

**...setup real-time features**
→ ARCHITECTURE.md (Section 3)

**...deploy to production**
→ DEPLOYMENT.md

**...test the API**
→ QUICK_REFERENCE.md (curl examples)

**...add a new endpoint**
→ index.js (review similar route) → middleware/ (add validation)

**...troubleshoot an issue**
→ DEPLOYMENT.md (troubleshooting section)

---

## Critical Files (Edit Carefully)

⚠️ **High Impact - Review twice before changing:**
1. `index.js` - All routes
2. `db.js` - Database connection
3. `middleware/auth.js` - Authentication

✅ **Safe to modify:**
1. `.env` - Configuration values
2. Documentation files
3. `utils.js` - Helper functions

🔒 **Never commit:**
1. `.env` - Contains secrets
2. `node_modules/` - Should use npm install

---

## Dependencies Map

```
express.js
├─ helmet() - Security headers
├─ cors() - CORS middleware
├─ xss-clean - XSS protection
├─ express-rate-limit - Rate limiting
├─ express-validator - Input validation
└─ express.static() - Image serving

socket.io
└─ Real-time WebSocket communication

mysql2/promise
└─ Database queries

jsonwebtoken
└─ JWT token management

bcryptjs
└─ Password hashing

stripe
└─ Payment processing

dotenv
└─ Environment variables
```

---

## Common File Operations

### View File
```bash
cat filename.md
less filename.md
```

### Edit File
```bash
nano filename.js
vim filename.js
```

### Search in File
```bash
grep "search_term" filename.js
```

### Check File Size
```bash
wc -l filename.js          # Line count
du -h filename.js          # File size
```

---

## Backup Strategy

### Files to Backup
```
✅ .env (CRITICAL - contains secrets)
✅ index.js (main code)
✅ middleware/ (auth logic)
✅ package.json (dependencies)
```

### Files NOT to Backup
```
❌ node_modules/ (use npm install)
❌ .git/ (version control)
❌ *.log (temporary)
```

---

## Version Control (Git)

### Tracked Files
```
✅ index.js, db.js, utils.js
✅ middleware/
✅ package.json (but NOT package-lock.json)
✅ .env.example
✅ Documentation (.md files)
```

### Ignored Files
```
❌ .env (secrets)
❌ node_modules/
❌ *.log
❌ .DS_Store
```

---

**Last Updated:** May 15, 2026  
**Total Documentation:** 2000+ lines  
**Total Project:** ~3000 lines code + docs

