require('dotenv').config();

const mysql = require('mysql2/promise');
const enabled = String(process.env.DB_MODE || 'json').toLowerCase() === 'mysql';
const pool = enabled ? mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'pedeia',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'pedeia',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}) : null;

async function testConnection() {
  if (!pool) throw new Error('DB_MODE nao esta configurado como mysql');
  const connection = await pool.getConnection();
  try { await connection.ping(); return true; } finally { connection.release(); }
}

module.exports = { enabled, pool, testConnection };