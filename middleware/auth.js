const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

const defaultStaffPlain = [
  { username: "admin",   password: "admin123",   role: "admin",   name: "Admin" },
  { username: "waiter1", password: "waiter123",   role: "waiter",  name: "Ahmad" },
  { username: "waiter2", password: "waiter456",   role: "waiter",  name: "Sara" },
  { username: "kitchen", password: "kitchen123",  role: "kitchen", name: "Kitchen Team" },
];

const staffUsers = (() => {
  if (process.env.STAFF_USERS_JSON) {
    try {
      const parsed = JSON.parse(process.env.STAFF_USERS_JSON);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("STAFF_USERS_JSON must be a non-empty array.");
      }
      return parsed;
    } catch (err) {
      console.error("❌ STAFF_USERS_JSON is set but invalid:", err.message);
      process.exit(1);
    }
  }

  if (process.env.NODE_ENV === "production") {
    console.error(
      "❌ FATAL: STAFF_USERS_JSON is not set in production.\n" +
      "   Default credentials are publicly known and must NOT be used in production.\n" +
      "   Set STAFF_USERS_JSON in your environment variables and restart."
    );
    process.exit(1);
  }

  console.warn(
    "⚠️  STAFF_USERS_JSON not set — using default dev credentials.\n" +
    "   Never run this way in production."
  );
  return defaultStaffPlain.map((user) => ({
    username:     user.username,
    role:         user.role,
    name:         user.name,
    passwordHash: bcrypt.hashSync(user.password, 10),
  }));
})();

function findStaffUser(username) {
  return staffUsers.find((user) => user.username === username);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured.");
  }
  
  const payload = {
    username: user.username,
    role: user.role,
    name: user.name,
  };
  
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function authenticateJWT(req, res, next) {
  console.log("\n========== AUTH MIDDLEWARE START ==========");
  console.log("VERIFY JWT_SECRET:", process.env.JWT_SECRET);
  console.log("JWT_SECRET length:", process.env.JWT_SECRET?.length);
  console.log("AUTH HEADER RAW:", req.headers.authorization);
  
  if (!process.env.JWT_SECRET) {
    console.log("❌ JWT_SECRET is missing!");
    return res.status(503).json({ error: "Authentication unavailable until JWT_SECRET is configured." });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("❌ No Bearer token found");
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.split(" ")[1];
  console.log("EXTRACTED TOKEN:", token);
  console.log("TOKEN length:", token?.length);
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("✅ TOKEN VERIFIED:", decoded);
    console.log("========== AUTH MIDDLEWARE END ==========\n");
    req.user = decoded;
    return next();
  } catch (err) {
    console.log("❌ JWT VERIFY ERROR:", err.message);
    console.log("Error name:", err.name);
    console.log("========== AUTH MIDDLEWARE END ==========\n");
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}

module.exports = {
  findStaffUser,
  verifyPassword,
  signToken,
  authenticateJWT,
  requireRole,
};