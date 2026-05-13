const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: "mysql-3d11ed7-fanjnasma-4923.a.aivencloud.com",
  port: 26847,
  user: "avnadmin",
  password: process.env.DB_PASSWORD,
  database: "defaultdb",

  ssl: {
    rejectUnauthorized: false
  },

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;