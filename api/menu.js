const pool = require("../lib/db");
const { handleCors, ensureMethod, internalError } = require("../lib/utils");

module.exports = async function handler(req, res) {
  if (!ensureMethod(req, res, ["GET", "OPTIONS"])) return;
  if (handleCors(req, res)) return;

  try {
    const [items] = await pool.query("SELECT * FROM menuitems");
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify(items));
  } catch (err) {
    internalError(res, "Failed to fetch menu items");
  }
};
