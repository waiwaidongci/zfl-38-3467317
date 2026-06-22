import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { writeAuditLog, AUDIT_ACTIONS } from "./audit.js";
import { getClientIp } from "./migration.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const usersPath = join(__dirname, "..", "data", "users.json");
const sessionsPath = join(__dirname, "..", "data", "sessions.json");

const DEFAULT_USERS = [
  {
    username: "admin",
    passwordHash: "",
    displayName: "系统管理员",
    role: "admin",
    owner: null,
    createdAt: new Date().toISOString()
  },
  {
    username: "zhouning",
    passwordHash: "",
    displayName: "周宁",
    role: "user",
    owner: "周宁",
    createdAt: new Date().toISOString()
  },
  {
    username: "zhaoliu",
    passwordHash: "",
    displayName: "赵六",
    role: "user",
    owner: "赵六",
    createdAt: new Date().toISOString()
  },
  {
    username: "zhangsan",
    passwordHash: "",
    displayName: "张三",
    role: "user",
    owner: "张三",
    createdAt: new Date().toISOString()
  },
  {
    username: "lisi",
    passwordHash: "",
    displayName: "李四",
    role: "user",
    owner: "李四",
    createdAt: new Date().toISOString()
  }
];

const DEFAULT_PASSWORDS = {
  admin: "admin123",
  zhouning: "zhou123",
  zhaoliu: "zhao123",
  zhangsan: "zhang123",
  lisi: "li123"
};

function hashPassword(password) {
  return createHash("sha256").update(password + "zfl-38-salt").digest("hex");
}

function generateToken() {
  return randomBytes(32).toString("hex");
}

async function ensureUsersFile() {
  if (!existsSync(usersPath)) {
    await mkdir(dirname(usersPath), { recursive: true });
    const users = DEFAULT_USERS.map(u => ({
      ...u,
      passwordHash: hashPassword(DEFAULT_PASSWORDS[u.username])
    }));
    await writeFile(usersPath, JSON.stringify(users, null, 2));
    return users;
  }
  const data = JSON.parse(await readFile(usersPath, "utf8"));
  const missingDefaults = DEFAULT_USERS.filter(
    du => !data.some(u => u.username === du.username)
  );
  if (missingDefaults.length > 0) {
    for (const mu of missingDefaults) {
      data.push({
        ...mu,
        passwordHash: hashPassword(DEFAULT_PASSWORDS[mu.username])
      });
    }
    await writeFile(usersPath, JSON.stringify(data, null, 2));
  }
  return data;
}

async function ensureSessionsFile() {
  if (!existsSync(sessionsPath)) {
    await mkdir(dirname(sessionsPath), { recursive: true });
    await writeFile(sessionsPath, JSON.stringify({ sessions: [] }, null, 2));
    return { sessions: [] };
  }
  return JSON.parse(await readFile(sessionsPath, "utf8"));
}

async function loadUsers() {
  await ensureUsersFile();
  return JSON.parse(await readFile(usersPath, "utf8"));
}

async function saveUsers(users) {
  await writeFile(usersPath, JSON.stringify(users, null, 2));
}

async function loadSessions() {
  return await ensureSessionsFile();
}

async function saveSessions(sessionsData) {
  await writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));
}

async function findUserByUsername(username) {
  const users = await loadUsers();
  return users.find(u => u.username === username.toLowerCase()) || null;
}

async function findUserByToken(token) {
  if (!token) return null;
  const sessionsData = await loadSessions();
  const session = sessionsData.sessions.find(s => s.token === token);
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    sessionsData.sessions = sessionsData.sessions.filter(s => s.token !== token);
    await saveSessions(sessionsData);
    return null;
  }
  const user = await findUserByUsername(session.username);
  return user;
}

async function login(username, password, req) {
  const user = await findUserByUsername(username);
  const ip = req ? getClientIp(req) : null;
  if (!user) {
    await writeAuditLog({
      action: AUDIT_ACTIONS.AUTH_LOGIN,
      auth: null,
      targetType: "user",
      targetId: username,
      targetName: username,
      detail: { success: false, reason: "user_not_found" },
      ip
    });
    throw new Error("user_not_found");
  }
  const inputHash = hashPassword(password);
  if (inputHash !== user.passwordHash) {
    await writeAuditLog({
      action: AUDIT_ACTIONS.AUTH_LOGIN,
      auth: null,
      targetType: "user",
      targetId: user.username,
      targetName: user.displayName,
      detail: { success: false, reason: "wrong_password" },
      ip
    });
    throw new Error("wrong_password");
  }
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  
  const sessionsData = await loadSessions();
  sessionsData.sessions = sessionsData.sessions.filter(s => s.username !== user.username);
  sessionsData.sessions.push({
    token,
    username: user.username,
    createdAt: new Date().toISOString(),
    expiresAt
  });
  await saveSessions(sessionsData);

  const authContext = {
    isAuthenticated: true,
    isAdmin: user.role === "admin",
    user: {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      owner: user.owner
    }
  };
  await writeAuditLog({
    action: AUDIT_ACTIONS.AUTH_LOGIN,
    auth: authContext,
    targetType: "user",
    targetId: user.username,
    targetName: user.displayName,
    detail: { success: true },
    ip
  });
  
  return {
    token,
    user: {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      owner: user.owner
    }
  };
}

async function logout(token, req) {
  if (!token) return;
  const sessionsData = await loadSessions();
  const session = sessionsData.sessions.find(s => s.token === token);
  const ip = req ? getClientIp(req) : null;
  
  if (session) {
    const user = await findUserByUsername(session.username);
    if (user) {
      const authContext = {
        isAuthenticated: true,
        isAdmin: user.role === "admin",
        user: {
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          owner: user.owner
        }
      };
      await writeAuditLog({
        action: AUDIT_ACTIONS.AUTH_LOGOUT,
        auth: authContext,
        targetType: "user",
        targetId: user.username,
        targetName: user.displayName,
        detail: {},
        ip
      });
    }
  }
  
  sessionsData.sessions = sessionsData.sessions.filter(s => s.token !== token);
  await saveSessions(sessionsData);
}

function extractTokenFromRequest(req) {
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const cookieHeader = req.headers["cookie"] || "";
  const match = cookieHeader.match(/auth_token=([^;]+)/);
  if (match) {
    return match[1];
  }
  return null;
}

async function authMiddleware(req, res) {
  const token = extractTokenFromRequest(req);
  const user = token ? await findUserByToken(token) : null;
  req.auth = {
    token,
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin"
  };
  return req.auth;
}

function requireAuth(req, res, send, sendError) {
  if (!req.auth.isAuthenticated) {
    sendError(res, 401, "unauthorized");
    return false;
  }
  return true;
}

function requireAdmin(req, res, sendError) {
  if (!req.auth.isAdmin) {
    sendError(res, 403, "forbidden_admin_required");
    return false;
  }
  return true;
}

async function handleAuthApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const ip = getClientIp(req);

  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data, null, 2));
    return true;
  };
  const sendError = (status, error) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error }, null, 2));
    return true;
  };

  if (pathname === "/api/auth/login" && req.method === "POST") {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const { username, password } = body;
      if (!username || !password) {
        return sendError(400, "username_and_password_required");
      }
      const result = await login(username, password, req);
      res.setHeader('Set-Cookie', 'auth_token=' + result.token + '; Path=/; HttpOnly=false; SameSite=Lax; Max-Age=604800');
      return send(200, result);
    } catch (e) {
      const statusMap = {
        user_not_found: 401,
        wrong_password: 401
      };
      return sendError(statusMap[e.message] || 500, e.message);
    }
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const token = extractTokenFromRequest(req);
    await logout(token, req);
    res.setHeader('Set-Cookie', 'auth_token=; Path=/; Max-Age=0');
    return send(200, { ok: true });
  }

  if (pathname === "/api/auth/me" && req.method === "GET") {
    if (!req.auth.isAuthenticated) {
      return sendError(401, "unauthorized");
    }
    return send(200, {
      username: req.auth.user.username,
      displayName: req.auth.user.displayName,
      role: req.auth.user.role,
      owner: req.auth.user.owner
    });
  }

  if (pathname === "/api/auth/change-password" && req.method === "POST") {
    if (!req.auth.isAuthenticated) {
      return sendError(401, "unauthorized");
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const { oldPassword, newPassword } = body;
      if (!oldPassword || !newPassword) {
        return sendError(400, "passwords_required");
      }
      if (newPassword.length < 6) {
        return sendError(400, "password_too_short");
      }
      const users = await loadUsers();
      const userIndex = users.findIndex(u => u.username === req.auth.user.username);
      if (userIndex === -1) {
        return sendError(404, "user_not_found");
      }
      if (hashPassword(oldPassword) !== users[userIndex].passwordHash) {
        return sendError(401, "wrong_old_password");
      }
      users[userIndex].passwordHash = hashPassword(newPassword);
      await saveUsers(users);

      await writeAuditLog({
        action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE,
        auth: req.auth,
        targetType: "user",
        targetId: req.auth.user.username,
        targetName: req.auth.user.displayName,
        detail: {},
        ip
      });

      return send(200, { ok: true });
    } catch (e) {
      return sendError(500, e.message);
    }
  }

  if (pathname === "/api/auth/users" && req.method === "GET") {
    if (!req.auth.isAdmin) {
      return sendError(403, "forbidden_admin_required");
    }
    const users = await loadUsers();
    return send(200, users.map(u => ({
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      owner: u.owner,
      createdAt: u.createdAt
    })));
  }

  if (pathname === "/api/auth/users" && req.method === "POST") {
    if (!req.auth.isAdmin) {
      return sendError(403, "forbidden_admin_required");
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const { username, password, displayName, role, owner } = body;
      if (!username || !password || !displayName) {
        return sendError(400, "fields_required");
      }
      if (password.length < 6) {
        return sendError(400, "password_too_short");
      }
      const users = await loadUsers();
      if (users.some(u => u.username === username.toLowerCase())) {
        return sendError(409, "user_exists");
      }
      const newUser = {
        username: username.toLowerCase(),
        passwordHash: hashPassword(password),
        displayName,
        role: role === "admin" ? "admin" : "user",
        owner: owner || null,
        createdAt: new Date().toISOString()
      };
      users.push(newUser);
      await saveUsers(users);

      await writeAuditLog({
        action: AUDIT_ACTIONS.USER_CREATE,
        auth: req.auth,
        targetType: "user",
        targetId: newUser.username,
        targetName: newUser.displayName,
        detail: { role: newUser.role, owner: newUser.owner },
        ip
      });

      return send(201, {
        username: newUser.username,
        displayName: newUser.displayName,
        role: newUser.role,
        owner: newUser.owner
      });
    } catch (e) {
      return sendError(500, e.message);
    }
  }

  if (pathname.startsWith("/api/auth/users/") && req.method === "PATCH") {
    if (!req.auth.isAdmin) {
      return sendError(403, "forbidden_admin_required");
    }
    try {
      const targetUsername = decodeURIComponent(pathname.split("/api/auth/users/")[1]);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const users = await loadUsers();
      const userIndex = users.findIndex(u => u.username === targetUsername);
      if (userIndex === -1) {
        return sendError(404, "user_not_found");
      }
      const oldData = {
        displayName: users[userIndex].displayName,
        role: users[userIndex].role,
        owner: users[userIndex].owner
      };

      if (body.displayName !== undefined) users[userIndex].displayName = body.displayName;
      if (body.role !== undefined) users[userIndex].role = body.role === "admin" ? "admin" : "user";
      if (body.owner !== undefined) users[userIndex].owner = body.owner;
      if (body.password) {
        if (body.password.length < 6) {
          return sendError(400, "password_too_short");
        }
        users[userIndex].passwordHash = hashPassword(body.password);
      }
      await saveUsers(users);

      const changes = {};
      if (body.displayName !== undefined && body.displayName !== oldData.displayName) changes.displayName = { old: oldData.displayName, new: body.displayName };
      if (body.role !== undefined && body.role !== oldData.role) changes.role = { old: oldData.role, new: body.role };
      if (body.owner !== undefined && body.owner !== oldData.owner) changes.owner = { old: oldData.owner, new: body.owner };
      if (body.password) changes.password = true;

      if (Object.keys(changes).length > 0) {
        await writeAuditLog({
          action: AUDIT_ACTIONS.USER_UPDATE,
          auth: req.auth,
          targetType: "user",
          targetId: users[userIndex].username,
          targetName: users[userIndex].displayName,
          detail: changes,
          ip
        });
      }

      return send(200, {
        username: users[userIndex].username,
        displayName: users[userIndex].displayName,
        role: users[userIndex].role,
        owner: users[userIndex].owner
      });
    } catch (e) {
      return sendError(500, e.message);
    }
  }

  return null;
}

export {
  authMiddleware,
  requireAuth,
  requireAdmin,
  handleAuthApi,
  findUserByToken,
  extractTokenFromRequest
};
