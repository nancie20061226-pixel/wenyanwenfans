// 文严文 CP 站 · Cloudflare Pages Functions 后端
// 路由前缀 /api/*；绑定：DB (D1)、IMAGES (R2)、ACCESS_PASS(可选 secret)、ADMIN_UID(可选)

const ADMIN_UID_DEFAULT = "hope";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const fail = (error, status = 400) => json({ ok: false, error }, status);

// 幂等表结构自检：本地 dev 与生产均可安全重复执行；生产首次建表仍可用 schema.sql。
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS profiles (uid TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'pending', sig TEXT NOT NULL DEFAULT '', outputs TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
  `CREATE TABLE IF NOT EXISTS profile_links (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, url TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (uid) REFERENCES profiles(uid) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS gallery (id TEXT PRIMARY KEY, uid TEXT, author TEXT, cat TEXT, title TEXT, r2key TEXT, desc TEXT NOT NULL DEFAULT '', date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
  `CREATE TABLE IF NOT EXISTS crafts (id TEXT PRIMARY KEY, uid TEXT, author TEXT, type TEXT, title TEXT, r2key TEXT, desc TEXT NOT NULL DEFAULT '', date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
  `CREATE TABLE IF NOT EXISTS fics (id TEXT PRIMARY KEY, uid TEXT, author TEXT, title TEXT, tags TEXT NOT NULL DEFAULT '[]', excerpt TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, uid TEXT, author TEXT, body TEXT NOT NULL DEFAULT '', date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, uid TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
  `CREATE INDEX IF NOT EXISTS idx_gallery_uid ON gallery(uid)`,
  `CREATE INDEX IF NOT EXISTS idx_crafts_uid ON crafts(uid)`,
  `CREATE INDEX IF NOT EXISTS idx_fics_uid ON fics(uid)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_uid ON messages(uid)`,
  `CREATE INDEX IF NOT EXISTS idx_links_uid ON profile_links(uid)`,
];

async function ensureSchema(env) {
  if (env.__schemaReady) return;
  for (const sql of SCHEMA_STATEMENTS) {
    await env.DB.prepare(sql).run();
  }
  env.__schemaReady = true;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// ---------- 资料与会话 ----------

async function readProfile(env, uid) {
  if (!uid) return null;
  const p = await env.DB.prepare("SELECT * FROM profiles WHERE uid = ?")
    .bind(uid)
    .first();
  if (!p) return null;
  const linksRows = await env.DB.prepare(
    "SELECT url FROM profile_links WHERE uid = ? ORDER BY sort ASC, id ASC"
  )
    .bind(uid)
    .all();
  let outputs = [];
  try {
    outputs = JSON.parse(p.outputs || "[]");
  } catch {
    outputs = [];
  }
  return {
    uid: p.uid,
    role: p.role,
    status: p.status,
    sig: p.sig || "",
    outputs,
    links: (linksRows.results || []).map((r) => ({ url: r.url })),
  };
}

async function sessionUser(env, request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const row = await env.DB.prepare("SELECT uid FROM sessions WHERE token = ?")
    .bind(token)
    .first();
  if (!row) return null;
  const adminUid = env.ADMIN_UID || ADMIN_UID_DEFAULT;
  if (row.uid === adminUid) {
    return { uid: adminUid, admin: true, status: "authorized", profile: null };
  }
  const profile = await readProfile(env, row.uid);
  if (!profile) return null;
  return { uid: profile.uid, admin: profile.role === "admin", status: profile.status, profile };
}

const requireAuth = async (env, request) => {
  const user = await sessionUser(env, request);
  if (!user) throw { status: 401, error: "未登录或会话已过期" };
  return user;
};

const requireAdmin = async (env, request) => {
  const user = await requireAuth(env, request);
  if (!user.admin) throw { status: 403, error: "仅管理员可操作" };
  return user;
};

async function replaceLinks(env, uid, links) {
  await env.DB.prepare("DELETE FROM profile_links WHERE uid = ?").bind(uid).run();
  const clean = (links || []).map((l) => (typeof l === "string" ? l : l.url)).filter(Boolean);
  for (let i = 0; i < clean.length; i++) {
    await env.DB.prepare("INSERT INTO profile_links (uid, url, sort) VALUES (?, ?, ?)")
      .bind(uid, clean[i], i)
      .run();
  }
}

async function homeUrls(env, uid) {
  if (!uid) return [];
  const rows = await env.DB.prepare("SELECT url FROM profile_links WHERE uid = ?")
    .bind(uid)
    .all();
  return (rows.results || []).map((r) => r.url);
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const newId = () => "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- 内容归一 ----------

function normalizeWork(env, row, kind) {
  if (kind === "g") {
    return {
      kind: "g", id: row.id, type: "图片返图", title: row.title, author: row.author,
      uid: row.uid, cat: row.cat, r2key: row.r2key, desc: row.desc || "", date: row.date, tags: [],
    };
  }
  if (kind === "c") {
    return {
      kind: "c", id: row.id, type: row.type, title: row.title, author: row.author,
      uid: row.uid, r2key: row.r2key, desc: row.desc || "", date: row.date, tags: [],
    };
  }
  let tags = [];
  try { tags = JSON.parse(row.tags || "[]"); } catch { tags = []; }
  return {
    kind: "f", id: row.id, type: "文字同人", title: row.title, author: row.author,
    uid: row.uid, tags, desc: row.excerpt || "", body: row.body || "", date: row.date, r2key: "",
  };
}

async function allWorks(env) {
  const [g, c, f] = await Promise.all([
    env.DB.prepare("SELECT * FROM gallery ORDER BY created_at DESC").all(),
    env.DB.prepare("SELECT * FROM crafts ORDER BY created_at DESC").all(),
    env.DB.prepare("SELECT * FROM fics ORDER BY created_at DESC").all(),
  ]);
  const list = [
    ...(g.results || []).map((r) => normalizeWork(env, r, "g")),
    ...(c.results || []).map((r) => normalizeWork(env, r, "c")),
    ...(f.results || []).map((r) => normalizeWork(env, r, "f")),
  ];
  for (const w of list) w.homeUrls = await homeUrls(env, w.uid);
  return list;
}

function filterWorks(list, query) {
  let out = list;
  const { type, cat, tag, q } = query;
  if (type && type !== "all") out = out.filter((w) => w.type === type);
  if (cat && cat !== "all") out = out.filter((w) => w.cat === cat);
  if (tag && tag !== "all") out = out.filter((w) => (w.tags || []).includes(tag));
  if (q) {
    const kw = q.toLowerCase();
    out = out.filter((w) =>
      [w.author, w.uid, w.title, w.desc].join(" ").toLowerCase().includes(kw)
    );
  }
  return out;
}

// ---------- 路由处理 ----------

async function handlePass(env, request) {
  const body = await readBody(request);
  const pass = env.ACCESS_PASS || "4699";
  if (String(body.pass || "") !== pass) return fail("访问密码不正确", 401);
  return json({ ok: true });
}

async function handleAccount(env, request) {
  const body = await readBody(request);
  const uid = String(body.uid || "").trim();
  if (!uid) return fail("请输入 ID");
  const adminUid = env.ADMIN_UID || ADMIN_UID_DEFAULT;

  if (uid === adminUid) {
    const token = crypto.randomUUID();
    await env.DB.prepare("INSERT OR IGNORE INTO sessions (token, uid) VALUES (?, ?)")
      .bind(token, adminUid)
      .run();
    return json({ ok: true, token, uid: adminUid, admin: true, status: "authorized" });
  }

  const links = Array.isArray(body.links) ? body.links : [];
  const sig = String(body.sig || "").trim();
  const outputs = Array.isArray(body.outputs) ? body.outputs : [];

  const existing = await env.DB.prepare("SELECT status FROM profiles WHERE uid = ?")
    .bind(uid)
    .first();
  const status = existing ? existing.status : "pending";

  await env.DB.prepare(
    `INSERT INTO profiles (uid, role, status, sig, outputs)
     VALUES (?, 'user', ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET sig = excluded.sig, outputs = excluded.outputs`
  )
    .bind(uid, status, sig, JSON.stringify(outputs))
    .run();
  // links 未传（undefined）时保留原有主页；传数组（含空数组）则整体替换
  if (Array.isArray(body.links)) await replaceLinks(env, uid, links);

  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO sessions (token, uid) VALUES (?, ?)")
    .bind(token, uid)
    .run();
  const profile = await readProfile(env, uid);
  return json({ ok: true, token, uid, admin: false, status, profile });
}

async function handleMe(env, request) {
  const user = await sessionUser(env, request);
  if (!user) return fail("未登录", 401);
  const profile = user.admin ? null : await readProfile(env, user.uid);
  return json({ ok: true, uid: user.uid, admin: user.admin, status: user.status, profile });
}

async function handleLogout(env, request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true });
}

async function handleUpload(env, request) {
  const user = await requireAuth(env, request);
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return fail("未收到图片文件");
  const contentType = file.type || "image/jpeg";
  if (!/^image\//.test(contentType)) return fail("仅支持图片文件");
  const ext = (file.name && file.name.split(".").pop()) || "img";
  const key = `uploads/${crypto.randomUUID()}.${String(ext).toLowerCase()}`;
  const buf = await file.arrayBuffer();
  await env.IMAGES.put(key, buf, { httpMetadata: { contentType } });
  return json({ ok: true, r2key: key, url: `/api/img/${key}` });
}

async function postGallery(env, request, user, body) {
  const title = String(body.title || "").trim();
  if (!title) return fail("请填写作品标题");
  if (!body.r2key) return fail("请先上传图片");
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO gallery (id, uid, author, cat, title, r2key, desc, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, user.uid, user.uid, body.cat || "stage", title, body.r2key, String(body.desc || ""), today())
    .run();
  return json({ ok: true, id });
}

async function postCraft(env, request, user, body) {
  const title = String(body.title || "").trim();
  if (!title) return fail("请填写作品标题");
  if (!body.r2key) return fail("请先上传作品图片");
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO crafts (id, uid, author, type, title, r2key, desc, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, user.uid, user.uid, body.type || "手绘画作", title, body.r2key, String(body.desc || ""), today())
    .run();
  return json({ ok: true, id });
}

async function postFic(env, request, user, body) {
  const title = String(body.title || "").trim();
  const b = String(body.body || "").trim();
  if (!title) return fail("请填写标题");
  if (!b) return fail("请填写正文内容");
  const tags = Array.isArray(body.tags) ? body.tags : [];
  const excerpt = b.replace(/\s+/g, " ").slice(0, 60);
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO fics (id, uid, author, title, tags, excerpt, body, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, user.uid, user.uid, title, JSON.stringify(tags), excerpt, b, today())
    .run();
  return json({ ok: true, id });
}

async function deleteRow(env, request, table, id, uidCol) {
  const user = await requireAuth(env, request);
  const row = await env.DB.prepare(`SELECT ${uidCol} FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) return fail("内容不存在", 404);
  if (!user.admin && row[uidCol] !== user.uid) return fail("只能删除自己发布的内容", 403);
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

async function handleMessages(env, request) {
  if (request.method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM messages ORDER BY created_at DESC").all();
    const list = [];
    for (const r of rows.results || []) {
      list.push({ id: r.id, uid: r.uid, author: r.author, body: r.body, content: r.body, date: r.date, homeUrls: await homeUrls(env, r.uid) });
    }
    return json({ ok: true, list });
  }
  const user = await requireAuth(env, request);
  const body = await readBody(request);
  const content = String(body.body || "").trim();
  if (!content) return fail("留言内容不能为空");
  const id = newId();
  await env.DB.prepare("INSERT INTO messages (id, uid, author, body, date) VALUES (?, ?, ?, ?, ?)")
    .bind(id, user.uid, user.uid, content, today())
    .run();
  return json({ ok: true, id });
}

async function handleAuthor(env, request, uid) {
  const profile = await readProfile(env, uid);
  const [g, c, f, m] = await Promise.all([
    env.DB.prepare("SELECT * FROM gallery WHERE uid = ? ORDER BY created_at DESC").bind(uid).all(),
    env.DB.prepare("SELECT * FROM crafts WHERE uid = ? ORDER BY created_at DESC").bind(uid).all(),
    env.DB.prepare("SELECT * FROM fics WHERE uid = ? ORDER BY created_at DESC").bind(uid).all(),
    env.DB.prepare("SELECT * FROM messages WHERE uid = ? ORDER BY created_at DESC").bind(uid).all(),
  ]);
  const links = profile ? profile.links : [];
  const withUrls = (rows, kind) =>
    (rows || []).map((r) => ({ ...normalizeWork(env, r, kind), homeUrls: links.map((l) => l.url) }));
  return json({
    ok: true,
    profile,
    gallery: withUrls(g.results, "g"),
    crafts: withUrls(c.results, "c"),
    fics: withUrls(f.results, "f"),
    messages: (m.results || []).map((r) => ({ id: r.id, uid: r.uid, author: r.author, body: r.body, content: r.body, date: r.date, homeUrls: links.map((l) => l.url) })),
  });
}

async function handleAdminUsers(env, request) {
  await requireAdmin(env, request);
  const rows = await env.DB.prepare("SELECT * FROM profiles ORDER BY created_at ASC").all();
  const list = [];
  for (const r of rows.results || []) {
    const p = await readProfile(env, r.uid);
    list.push({ uid: p.uid, status: p.status, sig: p.sig, outputs: p.outputs, links: p.links });
  }
  return json({ ok: true, list });
}

async function handleAuthorize(env, request) {
  await requireAdmin(env, request);
  const body = await readBody(request);
  const uid = String(body.uid || "").trim();
  if (!uid) return fail("缺少用户 ID");
  await env.DB.prepare("UPDATE profiles SET status = ? WHERE uid = ?")
    .bind(body.ok ? "authorized" : "pending", uid)
    .run();
  return json({ ok: true });
}

async function handleAdminOverview(env, request) {
  await requireAdmin(env, request);
  const [g, c, f, m] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) n FROM gallery").first(),
    env.DB.prepare("SELECT COUNT(*) n FROM crafts").first(),
    env.DB.prepare("SELECT COUNT(*) n FROM fics").first(),
    env.DB.prepare("SELECT COUNT(*) n FROM messages").first(),
  ]);
  return json({
    ok: true,
    counts: { gallery: g.n, crafts: c.n, fics: f.n, messages: m.n },
    works: await allWorks(env),
  });
}

async function handleImg(env, request, key) {
  const obj = await env.IMAGES.get(key);
  if (!obj) return fail("图片不存在", 404);
  const contentType = obj.httpMetadata?.contentType || "image/jpeg";
  return new Response(obj.body, { headers: { "content-type": contentType, "cache-control": "public, max-age=31536000" } });
}

// ---------- 入口分发 ----------

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean).map(decodeURIComponent);
  const method = request.method;

  try {
    await ensureSchema(env);
    if (method === "POST" && parts[0] === "pass") return await handlePass(env, request);
    if (method === "POST" && parts[0] === "account") return await handleAccount(env, request);
    if (method === "GET" && parts[0] === "me") return await handleMe(env, request);
    if (method === "POST" && parts[0] === "logout") return await handleLogout(env, request);

    if (method === "GET" && parts[0] === "works") {
      const list = filterWorks(await allWorks(env), Object.fromEntries(url.searchParams));
      return json({ ok: true, list });
    }
    if (method === "POST" && parts[0] === "upload") return await handleUpload(env, request);
    if (method === "POST" && parts[0] === "gallery") {
      const user = await requireAuth(env, request);
      return await postGallery(env, request, user, await readBody(request));
    }
    if (method === "POST" && parts[0] === "crafts") {
      const user = await requireAuth(env, request);
      return await postCraft(env, request, user, await readBody(request));
    }
    if (method === "POST" && parts[0] === "fics") {
      const user = await requireAuth(env, request);
      return await postFic(env, request, user, await readBody(request));
    }

    if (parts[0] === "gallery" && parts[1]) return await deleteRow(env, request, "gallery", parts[1], "uid");
    if (parts[0] === "crafts" && parts[1]) return await deleteRow(env, request, "crafts", parts[1], "uid");
    if (parts[0] === "fics" && parts[1]) return await deleteRow(env, request, "fics", parts[1], "uid");

    if (parts[0] === "messages") {
      if (parts[1]) return await deleteRow(env, request, "messages", parts[1], "uid");
      return await handleMessages(env, request);
    }

    if (method === "GET" && parts[0] === "author" && parts[1]) return await handleAuthor(env, request, parts[1]);

    if (method === "GET" && parts[0] === "admin" && parts[1] === "users") return await handleAdminUsers(env, request);
    if (method === "POST" && parts[0] === "admin" && parts[1] === "authorize") return await handleAuthorize(env, request);
    if (method === "GET" && parts[0] === "admin" && parts[1] === "overview") return await handleAdminOverview(env, request);

    if (method === "GET" && parts[0] === "img" && parts[1]) return await handleImg(env, request, parts.slice(1).join("/"));

    return fail("接口不存在", 404);
  } catch (err) {
    if (err && typeof err.status === "number") return fail(err.error || "请求失败", err.status);
    console.error(err);
    return fail("服务器内部错误", 500);
  }
}
