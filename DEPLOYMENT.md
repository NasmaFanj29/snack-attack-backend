# 🚀 Deployment & Getting Started

## Quick Start (Development)

### Prerequisites
- Node.js 16+ (or higher)
- MySQL 5.7+ (local or cloud)
- npm or yarn

### 1. Clone & Install

```bash
cd c:\Users\User\Desktop\webbbbb\backend
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_DATABASE=snack_attack
JWT_SECRET=your_super_secret_key_min_32_chars
STRIPE_SECRET_KEY=sk_test_...
GEMINI_API_KEY=your_api_key
```

### 3. Database Setup

Create database and tables:
```sql
CREATE DATABASE snack_attack CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE snack_attack;

-- See DATABASE_SCHEMA.md for full SQL scripts
```

### 4. Start Server

**Development (with hot reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Expected output:
```
🚀 Server running on port 5000
✅ Database connected
```

### 5. Test API

```bash
# Get menu
curl http://localhost:5000/menu

# Staff login
curl -X POST http://localhost:5000/staff/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"snack2024"}'
```

---

## Project Structure

```
backend/
├── index.js                 # Main server file, all routes
├── db.js                    # MySQL connection pool
├── utils.js                 # Helper functions
├── package.json             # Dependencies
├── .env                     # Environment variables (KEEP SECRET)
├── .env.example             # Template (safe to share)
├── middleware/
│   ├── auth.js              # JWT & staff authentication
│   └── validation.js        # Express-validator rules
├── API_DOCUMENTATION.md     # API endpoint reference
├── DATABASE_SCHEMA.md       # Database structure
├── ARCHITECTURE.md          # Auth, payment, Socket.io flows
└── images/                  # Static images for menu items
```

---

## Environment Variables

### Database
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=secure_password_here
DB_DATABASE=snack_attack
DB_CONNECTION_LIMIT=10
DB_REQUIRE_SSL=false
DB_REJECT_UNAUTHORIZED=true
```

### Authentication
```env
JWT_SECRET=your_minimum_32_character_secret_key
JWT_EXPIRES_IN=8h
```

### Payment (Stripe)
```env
STRIPE_SECRET_KEY=sk_test_your_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

### AI (Gemini)
```env
GEMINI_API_KEY=your_google_api_key
```

### Security
```env
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,https://yourdomain.com
NODE_ENV=development
PORT=5000
```

### Staff Users (Optional)
```env
# If not set, uses default hardcoded users
# STAFF_USERS_JSON=[{"username":"admin","password":"pass","role":"admin","name":"Admin"}]
```

---

## Running

### Development
```bash
# With auto-reload (requires nodemon)
npm run dev

# Or manually
node index.js
```

### Production
```bash
NODE_ENV=production npm start
```

### Docker (Optional)

**Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

EXPOSE 5000
CMD ["node", "index.js"]
```

**Build & Run:**
```bash
docker build -t snack-attack-backend .
docker run -p 5000:5000 --env-file .env snack-attack-backend
```

---

## Deployment Options

### Option 1: Heroku

```bash
# Install Heroku CLI
npm install -g heroku

# Login
heroku login

# Create app
heroku create snack-attack-backend

# Set environment variables
heroku config:set JWT_SECRET=your_secret
heroku config:set STRIPE_SECRET_KEY=sk_test_...
heroku config:set DB_HOST=your_db_host
# ... other vars

# Deploy
git push heroku main

# View logs
heroku logs --tail
```

**Procfile:**
```
web: node index.js
```

### Option 2: AWS EC2

```bash
# SSH into EC2 instance
ssh -i your-key.pem ec2-user@your-instance.com

# Install Node.js
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Install MySQL client (if separate DB)
sudo yum install -y mysql

# Clone repo
git clone https://github.com/yourusername/snack-attack.git
cd snack-attack/backend

# Install dependencies
npm install --production

# Create .env
nano .env
# ... paste configuration

# Install PM2 for process management
sudo npm install -g pm2

# Start with PM2
pm2 start index.js --name "snack-attack"
pm2 startup
pm2 save

# Setup Nginx reverse proxy (optional)
sudo yum install -y nginx
# ... configure nginx
```

### Option 3: DigitalOcean App Platform

```bash
# Connect GitHub repo
# Select app.yaml configuration
# Deploy automatically on push
```

**app.yaml:**
```yaml
name: snack-attack
services:
  - name: backend
    github:
      repo: yourusername/snack-attack
      branch: main
    build_command: npm install
    run_command: node index.js
    http_port: 5000
    envs:
      - key: NODE_ENV
        value: production
      - key: JWT_SECRET
        scope: RUN_AND_BUILD_TIME
      - key: DB_HOST
        scope: RUN_TIME
      # ... other vars
databases:
  - name: snack-attack-db
    engine: MYSQL
    version: 8
    production: true
```

### Option 4: Railway.app

1. Connect GitHub repo
2. Add MySQL plugin
3. Set environment variables
4. Deploy

---

## Monitoring & Logging

### Production Checklist

✅ **Before Going Live:**
- [ ] Change all default passwords
- [ ] Set strong JWT_SECRET (32+ chars)
- [ ] Enable SSL/HTTPS
- [ ] Set CORS_ORIGINS to specific domains only
- [ ] Configure error logging service
- [ ] Setup database backups
- [ ] Monitor for rate limiting effectiveness
- [ ] Test webhook signature verification
- [ ] Enable database SSL if supported

### Error Tracking

**Example: Sentry Integration**

```bash
npm install @sentry/node @sentry/tracing
```

```javascript
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
});

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

### Logging

**Console logging (built-in):**
```javascript
console.log("✅ Success message");
console.error("❌ Error message");
console.warn("⚠️ Warning message");
```

**Example: Winston Logger Integration**

```bash
npm install winston
```

```javascript
const logger = require('winston').createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
```

---

## Database Backups

### Manual Backup

```bash
# Full backup
mysqldump -u root -p snack_attack > backup_$(date +%Y%m%d).sql

# Compress
gzip backup_$(date +%Y%m%d).sql

# Store securely
cp backup_*.sql.gz /backup/location/
```

### Automated Backups (Cron)

```bash
# Add to crontab (runs daily at 2 AM)
0 2 * * * mysqldump -u root -p$DB_PASSWORD snack_attack | gzip > /backups/snack_attack_$(date +\%Y\%m\%d).sql.gz
```

### Restore from Backup

```bash
gunzip backup_20240115.sql.gz
mysql -u root -p snack_attack < backup_20240115.sql
```

---

## Performance Optimization

### Database

```javascript
// Connection pooling (already configured)
const pool = mysql.createPool({
  connectionLimit: 10,
  queueLimit: 0,
});

// Add indexes for slow queries
CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);
CREATE INDEX idx_orders_user_created ON orders(user_id, created_at DESC);
```

### Caching

```bash
npm install redis
```

```javascript
const redis = require('redis');
const client = redis.createClient();

// Cache menu items
app.get('/menu', async (req, res) => {
  const cached = await client.get('menu');
  if (cached) return res.json(JSON.parse(cached));
  
  const [items] = await pool.query("SELECT * FROM menuitems");
  await client.setex('menu', 3600, JSON.stringify(items));
  res.json(items);
});
```

### Load Balancing

Use Nginx or HAProxy:

```nginx
upstream backend {
  server localhost:5000;
  server localhost:5001;
  server localhost:5002;
}

server {
  listen 80;
  location / {
    proxy_pass http://backend;
  }
}
```

---

## Troubleshooting

### Port Already in Use

```bash
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :5000
kill -9 <PID>
```

### Database Connection Error

```bash
# Test connection
mysql -h $DB_HOST -u $DB_USER -p$DB_PASSWORD -D $DB_DATABASE

# Check credentials in .env
# Verify database exists: SHOW DATABASES;
```

### JWT Token Issues

```
ERROR: Invalid or expired token
→ Check JWT_SECRET is same on all instances
→ Verify token hasn't expired (8 hours)
→ Ensure Authorization header format: "Bearer <token>"
```

### Stripe Webhook Not Working

```
→ Verify STRIPE_WEBHOOK_SECRET is correct
→ Check webhook endpoint URL in Stripe dashboard
→ Ensure POST /webhook is accessible (not behind auth)
→ Check Stripe logs for failure details
```

### Memory Leaks

```bash
# Monitor with clinic.js
npm install -g clinic
clinic doctor -- node index.js
```

---

## Security Hardening (Production)

### 1. Environment Variables
✅ Never commit `.env` to git
✅ Use strong secrets (32+ chars)
✅ Rotate secrets regularly

### 2. HTTPS/SSL
✅ Get certificate from Let's Encrypt
✅ Redirect HTTP → HTTPS
✅ Enable HSTS

```javascript
app.use(helmet());
app.use(
  helmet.hsts({
    maxAge: 31536000,
    includeSubDomains: true,
  })
);
```

### 3. Rate Limiting
✅ Already configured globally
✅ Adjust limits based on usage

### 4. CORS
✅ Whitelist specific origins only
```env
CORS_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com
```

### 5. Input Validation
✅ Use express-validator (configured)
✅ Sanitize all text fields
✅ Limit JSON payload size

### 6. SQL Injection Prevention
✅ Use parameterized queries (already done)
```javascript
pool.query("SELECT * FROM users WHERE phone = ?", [phone]);  // ✓ Safe
pool.query(`SELECT * FROM users WHERE phone = '${phone}'`);  // ✗ Dangerous
```

### 7. XSS Prevention
✅ Use xss-clean middleware
✅ Sanitize before database
✅ Escape output in frontend

---

## API Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Response Time | <100ms | ? |
| Concurrent Users | 100+ | ? |
| Database Queries | <50ms | ? |
| Availability | 99.9% | ? |

---

## Useful Commands

```bash
# Check Node version
node --version

# Check installed packages
npm list

# Update packages (careful!)
npm update

# Audit for security issues
npm audit

# Install dev dependencies
npm install --save-dev

# Run tests (if added)
npm test

# Profile performance
node --prof index.js
```

---

## Support & Resources

- **Express.js:** https://expressjs.com
- **Socket.io:** https://socket.io
- **Stripe Docs:** https://stripe.com/docs
- **MySQL:** https://dev.mysql.com/doc/
- **JWT:** https://jwt.io

---

**Last Updated:** May 15, 2026
**Maintainer:** Snack Attack Development Team
