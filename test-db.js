// test-db.js
require('dotenv').config();
const pool = require('./db');

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ DATABASE CONNECTION SUCCESS');
    const [tables] = await conn.query('SHOW TABLES;');
    console.log('📋 TABLES IN DATABASE:', tables.map(t => Object.values(t)[0]));
    conn.release();
    process.exit(0);
  } catch (err) {
    console.error('❌ DATABASE CONNECTION FAILED:', err.message);
    process.exit(1);
  }
}
testConnection();
