const mysql = require("mysql2/promise");

const pool = globalThis.__mysqlPool || mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "snack_attack",
  
  // ✅ AIVEN SSL CONFIGURATION - Allows self-signed certificates
  ssl: process.env.DB_REQUIRE_SSL === "true"
    ? {
        rejectUnauthorized: false,  // Allow self-signed certificates
        minVersion: "TLSv1.2",      // Minimum TLS version for Aiven
      }
    : false,  // Disable SSL if DB_REQUIRE_SSL is not "true"
  
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
});

if (!globalThis.__mysqlPool) {
  globalThis.__mysqlPool = pool;
}

// Database connection metadata for logging
pool.dbName = process.env.DB_DATABASE || "snack_attack";
pool.dbHost = process.env.DB_HOST || "localhost";
pool.dbPort = Number(process.env.DB_PORT) || 3306;
pool.dbUser = process.env.DB_USER || "root";
pool.dbWarnings = [];

module.exports = pool;