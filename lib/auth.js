const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = process.env.JWT_SECRET || "replace_me_in_production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

const defaultStaffPlain = [
  { username: "admin", password: "snack2024", role: "admin", name: "Admin" },
  { username: "waiter1", password: "waiter123", role: "waiter", name: "Ahmad" },
  { username: "waiter2", password: "waiter456", role: "waiter", name: "Sara" },
  { username: "kitchen", password: "kitchen123", role: "kitchen", name: "Kitchen Team" },
];
const user = findStaffUser(username);
const staffUsers = (() => {
  if (process.env.STAFF_USERS_JSON) {
    try {
      const parsed = JSON.parse(process.env.STAFF_USERS_JSON);
      if (Array.isArray(parsed)) {
        return parsed.map((user) => ({
          username: String(user.username || "").trim(),
          role: String(user.role || "").trim(),
          name: String(user.name || "").trim(),
          passwordHash: bcrypt.hashSync(String(user.password || ""), 10),
        }));
      }
    } catch (err) {
      console.warn("WARNING: Invalid STAFF_USERS_JSON, falling back to default staff users.");
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
  if (!username || typeof username !== "string") return null;
  return staffUsers.find((user) => user.username === username);
}

function verifyPassword(user, password) {
 if (!user || !verifyPassword(user, password)) {
  return res.status(401).json({ error: "Invalid credentials" });
}}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Missing authorization token");
  }
  return jwt.verify(token, JWT_SECRET);
}

function getTokenFromHeader(req) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || !String(auth).startsWith("Bearer ")) {
    throw new Error("Authorization header missing or malformed");
  }
  return String(auth).slice(7).trim();
}

function authenticateJWT(req, res, next) {
  try {
    const token = getTokenFromHeader(req);
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }
}

function requireRole(user, ...allowedRoles) {
  if (!user || !allowedRoles.includes(user.role)) {
    throw new Error("Forbidden");
  }
  return user;
}

module.exports = {
  findStaffUser,
  verifyPassword,
  signToken,
  verifyToken,
  getTokenFromHeader,
  authenticateJWT,
  requireRole,
};
