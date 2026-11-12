-- 文严文 CP 站 · Cloudflare D1 表结构
-- 首次部署后在 D1 控制台或 wrangler d1 execute 执行本文件

-- 用户资料（内置管理员 hope 不入库，由后端常量判定）
CREATE TABLE IF NOT EXISTS profiles (
  uid       TEXT PRIMARY KEY,
  role      TEXT NOT NULL DEFAULT 'user',      -- user / admin
  status    TEXT NOT NULL DEFAULT 'pending',   -- pending / authorized
  sig       TEXT NOT NULL DEFAULT '',
  outputs   TEXT NOT NULL DEFAULT '[]',        -- JSON 数组：图片返图/手绘画作/文字同人/实物制品
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 多条社交主页链接
CREATE TABLE IF NOT EXISTS profile_links (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid   TEXT NOT NULL,
  url   TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (uid) REFERENCES profiles (uid) ON DELETE CASCADE
);

-- 图片返图（原同框相册）
CREATE TABLE IF NOT EXISTS gallery (
  id      TEXT PRIMARY KEY,
  uid     TEXT,
  author  TEXT,
  cat     TEXT,
  title   TEXT,
  r2key   TEXT,
  desc    TEXT NOT NULL DEFAULT '',
  date    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 手绘画作 / 实物制品
CREATE TABLE IF NOT EXISTS crafts (
  id      TEXT PRIMARY KEY,
  uid     TEXT,
  author  TEXT,
  type    TEXT,
  title   TEXT,
  r2key   TEXT,
  desc    TEXT NOT NULL DEFAULT '',
  date    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 文字同人
CREATE TABLE IF NOT EXISTS fics (
  id      TEXT PRIMARY KEY,
  uid     TEXT,
  author  TEXT,
  title   TEXT,
  tags    TEXT NOT NULL DEFAULT '[]',   -- JSON 数组：HE/BE/短篇/长篇/现实向/架空
  excerpt TEXT NOT NULL DEFAULT '',
  body    TEXT NOT NULL DEFAULT '',
  date    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 粉丝留言
CREATE TABLE IF NOT EXISTS messages (
  id      TEXT PRIMARY KEY,
  uid     TEXT,
  author  TEXT,
  body    TEXT NOT NULL DEFAULT '',
  date    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 服务端会话
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  uid        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_gallery_uid ON gallery (uid);
CREATE INDEX IF NOT EXISTS idx_crafts_uid ON crafts (uid);
CREATE INDEX IF NOT EXISTS idx_fics_uid ON fics (uid);
CREATE INDEX IF NOT EXISTS idx_messages_uid ON messages (uid);
CREATE INDEX IF NOT EXISTS idx_links_uid ON profile_links (uid);
