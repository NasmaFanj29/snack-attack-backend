const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = process.env.JWT_SECRET || null;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";


const defaultStaffPlain = [
  { username: "admin", password: "snack2024", role: "admin", name: "Admin" },
  { username: "waiter1", password: "waiter123", role: "waiter", name: "Ahmad" },
  { username: "waiter2", password: "waiter456", role: "waiter", name: "Sara" },
  { username: "kitchen", password: "kitchen123", role: "kitchen", name: "Kitchen Team" },
];

const staffUsers = (() => {
  if (process.env.STAFF_USERS_JSON) {
    try {
      return JSON.parse(process.env.STAFF_USERS_JSON);
    } catch (err) {
      console.warn("Invalid STAFF_USERS_JSON, falling back to default staff users.");
    }
  }

  return defaultStaffPlain.map((user) => ({
    username: user.username,
    role: user.role,
    name: user.name,
    passwordHash: bcrypt.hashSync(user.password, 10),
  }));
})();

function findStaffUser(username) {
  return staffUsers.find((user) => user.username === username);
}

function verifyPassword(user, password) {
  if (!user) return false;
  if (user.passwordHash) {
    return bcrypt.compareSync(password, user.passwordHash);
  }
  return false;
}

function signToken(payload) {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured.");
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function authenticateJWT(req, res, next) {
  if (!JWT_SECRET) {
    return res.status(503).json({ error: "Authentication unavailable until JWT_SECRET is configured." });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.split(" ")[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}

module.exports = {
  findStaffUser,
  verifyPassword,
  signToken,
  authenticateJWT,
  requireRole,
};
