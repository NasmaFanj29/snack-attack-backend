<<<<<<< HEAD
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: "mysql-3d11ed7-fanjnasma-4923.a.aivencloud.com",
  port: 26847,
  user: "avnadmin",
  password: process.env.DB_PASSWORD,// 👈 Check el-password el-7a2i2iye
  database: "defaultdb",
  ssl: { 
    rejectUnauthorized: false // 👈 DARURE ktīr kirmal Aiven
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

=======
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: "mysql-3d11ed7-fanjnasma-4923.a.aivencloud.com",
  port: 26847,
  user: "avnadmin",
  password: "AVNS_naebXmyEzZIlic1Xuaf", // 👈 Check el-password el-7a2i2iye
  database: "defaultdb",
  ssl: { 
    rejectUnauthorized: false // 👈 DARURE ktīr kirmal Aiven
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

>>>>>>> 6e694a2 (Initial backend commit)
module.exports = pool;