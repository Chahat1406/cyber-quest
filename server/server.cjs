


const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database(path.join(__dirname, "cyberquest.db"));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Demo setup: change this secret before deployment.
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-local-dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 2
  }
}));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER PRIMARY KEY,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

const progressColumns = [
  ["current_chapter", "INTEGER NOT NULL DEFAULT 1"],
  ["completed_chapters", "TEXT NOT NULL DEFAULT '[]'"],
  ["score", "INTEGER NOT NULL DEFAULT 0"]
];

const existingColumns = db
  .prepare("PRAGMA table_info(progress)")
  .all()
  .map((column) => column.name);

for (const [columnName, columnType] of progressColumns) {
  if (!existingColumns.includes(columnName)) {
    db.exec(
      `ALTER TABLE progress ADD COLUMN ${columnName} ${columnType}`
    );
  }
}


app.use(express.static(path.join(__dirname, "..")));

app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (
      typeof username !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      username.trim().length < 2 ||
      username.trim().length > 30 ||
      password.length < 8 ||
      password.length > 72 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      return res.status(400).json({
        error: "Enter a valid name, email and password (8–72 characters)."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);

    const result = db.prepare(`
      INSERT INTO users (username, email, password_hash)
      VALUES (?, ?, ?)
    `).run(username.trim(), normalizedEmail, passwordHash);

    db.prepare("INSERT INTO progress (user_id) VALUES (?)")
      .run(result.lastInsertRowid);

    req.session.userId = Number(result.lastInsertRowid);

    res.status(201).json({
      message: "Account created successfully!",
      username: username.trim()
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        error: "This email is already registered."
      });
    }

    console.error("Registration error:", error.message);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      password.length > 72
    ) {
      return res.status(400).json({ error: "Enter your email and password." });
    }

    const user = db.prepare(
      "SELECT * FROM users WHERE email = ?"
    ).get(email.trim().toLowerCase());

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ error: "Could not start session." });
      }

      req.session.userId = user.id;
      res.json({
        message: "Login successful!",
        username: user.username
      });
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Could not log in." });
  }
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in first." });
  }

  const user = db.prepare(
    "SELECT id, username, email FROM users WHERE id = ?"
  ).get(req.session.userId);

  if (!user) {
    return res.status(401).json({ error: "Account not found." });
  }

  const progress = db.prepare(
    "SELECT xp, level FROM progress WHERE user_id = ?"
  ).get(user.id);

  res.json({ user, progress });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Could not log out." });
    }

    res.clearCookie("connect.sid");
    res.json({ message: "Logged out successfully." });
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Cyber Quest backend running at http://localhost:${PORT}`);
});
