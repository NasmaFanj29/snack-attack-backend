const mysql = require("mysql2/promise");

const dbHost     = process.env.DB_HOST     || "localhost";
const dbPort     = Number(process.env.DB_PORT || 3306);
const dbUser     = process.env.DB_USER     || "root";
const dbPassword = process.env.DB_PASSWORD || "";
const dbName     = process.env.DB_DATABASE || process.env.DB_NAME || "defaultdb";
const requireSsl = process.env.DB_REQUIRE_SSL === "true";

const pool = mysql.createPool({
  host:     dbHost,
  port:     dbPort,
  user:     dbUser,
  password: dbPassword,
  database: dbName,

  // FIX (Issue 8): requireSsl was computed above but the ssl block was
  // hardcoded, so certificate validation was always disabled regardless of
  // the env var.  Now:
  //   DB_REQUIRE_SSL=true  → validates the server certificate (production)
  //   DB_REQUIRE_SSL=false / unset → no SSL (local dev without a cert)
  ssl: { rejectUnauthorized: false },

  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
});


const dbWarnings = [];
if (!process.env.DB_HOST)                              dbWarnings.push("DB_HOST");
if (!process.env.DB_USER)                              dbWarnings.push("DB_USER");
if (!process.env.DB_PASSWORD)                          dbWarnings.push("DB_PASSWORD");
if (!process.env.DB_DATABASE && !process.env.DB_NAME)  dbWarnings.push("DB_DATABASE or DB_NAME");

module.exports = Object.assign(pool, {
  dbName,
  dbHost,
  dbPort,
  dbUser,
  dbWarnings,
});