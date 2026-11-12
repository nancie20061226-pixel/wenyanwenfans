# 文严文 · 刘耀文 × 严浩翔 CP 站

基于 **Cloudflare Pages + Pages Functions + D1 数据库 + R2 对象存储** 的粉丝向收录站：前端为原生单页应用，后端接口由 Functions 提供，资料、投稿、同人、留言与会话存入 D1，用户上传图片存入 R2，多人云端互通。

> 本站为粉丝向收录站，非官方渠道，不代表艺人及其团队立场。

## 技术架构

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 静态前端 | 原生 HTML / CSS / 原生 JS（ES6），单文件 `index.html` | hash 多视图路由，档案证件照与 hero 背景已 base64 内嵌 |
| 后端接口 | Cloudflare Pages Functions（`functions/api/[[path]].js`） | 与前端同域 `/api/*`，无跨域；单文件兜底路由 |
| 数据库 | Cloudflare D1（SQLite） | 资料、授权、投稿、同人、留言、服务端会话 |
| 图片存储 | Cloudflare R2 | 用户上传图片，经 `/api/img/:key` 代理访问 |
| 部署 | GitHub 仓库连接 Cloudflare Pages 自动构建发布 | 默认使用 `*.pages.dev` 免费域名 |

## 功能

- **访问门禁**：进入站点需先输入访问密码 `4699`（服务端校验，不下发到前端）；通过后登记账号，填写 ID、多条社交主页链接、一句话签名与产出类型（不设昵称，全站以 ID 展示）。
- **账号授权**：新登记账号默认「待授权」，需管理员在后台批准后才能进入主页；未授权用户只能看到待授权提示页。
- **管理员账号**：固定为 `hope`，不对外开放注册；可在后台授权或撤销普通用户，并管理站内全部内容。
- **不按身份区分**：不设置站姐 / 画手 / 写手等身份标签，人人都可投稿与产出；个人资料仅保留 ID、多条社交主页、签名与产出类型多选（图片返图 / 手绘画作 / 文字同人 / 实物制品，作为内容方向记录，不限制个人）。
- **我的主页**：登录后可自行维护多条社交主页（可增删分行）、签名与产出类型；保存后发布的照片、画作、制品、同人文与留言同步使用这套资料。
- **人物档案**：刘耀文、严浩翔公开资料卡片（人像照片已 base64 内嵌），卡片内可跳转认证微博主页。
- **产出板块（统一入口）**：站内全部产出汇总于「产出」板块，一级分类为图片返图 / 手绘画作 / 文字同人 / 实物制品；原同框相册归入「图片返图」，保留场景二级筛选（双人同框 / 舞台 / 私服日常 / 活动红毯 / 机场）；原同人文归入「文字同人」，保留基调二级筛选（HE / BE、短篇 / 长篇、现实向 / 架空），卡片可展开阅读全文。
- **产出搜索与投稿**：搜索框输入即搜，匹配作者 ID、标题与简介，可与一级、二级分类叠加；投稿按类型选择，支持图 + 文；相册、同人与产出板块底层数据互通。
- **粉丝留言板**：登录后可留言，以 ID 归属，主页链接取自「我的主页」，留言计入作者聚合页。
- **作者聚合**：点击作者 ID，进入聚合页按类型分组查看其照片、画作 / 制品、同人文与留言，展示产出类型与签名，并汇总其全部社交主页链接（自动去重），可点击跳转。
- **权限区分**：普通用户仅能删除自己发布的照片、画作 / 制品、同人文与留言；管理员（`hope`）可在后台授权 / 撤销用户，并查看、删除站内全部内容。

## 目录结构

```
wenyanwen-cp-github/
├── index.html                    # 前端单文件（HTML + 内联 CSS + 原生 JS，API 驱动）
├── functions/
│   └── api/
│       └── [[path]].js           # Pages Functions 后端接口（兜底路由）
├── schema.sql                    # D1 建表语句（生产首次建表可用）
├── wrangler.toml                 # Pages / D1 / R2 绑定与环境变量配置
├── assets/                      # 历史图源素材备份（页面运行不依赖，可不发布）
└── README.md
```

## 本地开发

前置要求：Node.js 18+、npm；Wrangler 随 npx 调用即可，无需全局安装。

```bash
# 在本目录启动本地开发服务（本地模拟 D1 / R2，数据存于 .wrangler/state）
npx wrangler pages dev . --d1 DB --r2 IMAGES --port 8788 --ip 127.0.0.1
```

浏览器访问 `http://127.0.0.1:8788`。后端首次收到请求时会以 `CREATE TABLE IF NOT EXISTS` 幂等初始化本地 D1 表结构；如需手动执行建表语句：

```bash
npx wrangler d1 execute DB --local --file schema.sql
```

> `.wrangler/` 为本地模拟数据目录，已在 `.gitignore` 中排除，不提交仓库。

## 部署到 Cloudflare（连接 GitHub 自动发布）

### 1. 推送代码到 GitHub

在 GitHub 新建仓库（建议 Public），将本目录全部文件推送到仓库根目录：

```bash
git init
git add .
git commit -m "feat: Cloudflare 全栈 CP 站"
git branch -M main
git remote add origin <你的仓库地址>
git push -u origin main
```

### 2. 创建 D1 数据库

在 Cloudflare 控制台 **Workers & Pages → D1 → Create database**，命名例如 `wenyanwen-cp`；创建后复制数据库 **ID**。

也可使用 Wrangler：

```bash
npx wrangler d1 create wenyanwen-cp
```

把返回的 `database_id` 回填到 `wrangler.toml` 的 `[[d1_databases]]` 段：

```toml
[[d1_databases]]
binding = "DB"
database_name = "wenyanwen-cp"
database_id = "你的真实 D1 数据库 ID"
```

### 3. 创建 R2 存储桶

在 **R2 → Create bucket**，桶名与 `wrangler.toml` 中 `bucket_name` 保持一致（默认 `wenyanwen-cp-images`），绑定名 `IMAGES`。

### 4. 连接仓库创建 Pages 项目

1. 进入 **Workers & Pages → Create → Pages → Connect to Git**；
2. 选择上面的 GitHub 仓库与 `main` 分支；
3. 构建命令留空（本站无构建步骤），构建输出目录填 `.`（根目录）；
4. 保存后 Cloudflare 会自动部署，分配一个 `*.pages.dev` 免费域名。

### 5. 绑定 D1 / R2 与环境变量

在 Pages 项目 **Settings → Functions → Bindings** 中确认绑定（若 `wrangler.toml` 已随仓库读取，可自动识别；缺失时手动添加）：

| 类型 | 绑定名（Binding） | 值 |
| --- | --- | --- |
| D1 database | `DB` | 第 2 步创建的 D1 数据库 |
| R2 bucket | `IMAGES` | 第 3 步创建的 R2 桶 |

环境变量（Variables）：

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `ACCESS_PASS` | `4699` | 站点访问密码，服务端校验 |
| `ADMIN_UID` | `hope` | 内置管理员 ID，不对外开放注册 |

### 6. 初始化生产数据库

后端接口已内置幂等建表逻辑，首次访问会自动创建表。如需手动初始化或重建：

```bash
npx wrangler d1 execute wenyanwen-cp --remote --file schema.sql
```

部署完成后，通过 `pages.dev` 域名访问：输入密码 `4699` → 登记 ID → 用管理员 `hope` 在后台授权后即可进入主页投稿与留言。

## 接口概览（`/api/*`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/pass` | 校验访问密码，body `{pass}` |
| POST | `/api/account` | 登记 / 更新账号，body `{uid, links[], sig, outputs[]}`，返回会话令牌与资料 |
| GET | `/api/me` | 读取当前登录资料与授权状态 |
| POST | `/api/logout` | 退出登录，注销会话 |
| GET | `/api/works?type=&cat=&tag=&q=` | 汇总全部产出，支持类型 / 分类 / 基调 / 关键词筛选 |
| POST | `/api/upload` | multipart 上传图片到 R2，返回 `r2key` |
| POST | `/api/gallery` | 提交图片返图 `{title, cat, r2key, desc}` |
| POST | `/api/crafts` | 提交画作 / 制品 `{type, title, r2key, desc}` |
| POST | `/api/fics` | 提交文字同人 `{title, tags[], body}` |
| DELETE | `/api/gallery/:id`、`/api/crafts/:id`、`/api/fics/:id`、`/api/messages/:id` | 删除内容（本人或管理员） |
| GET / POST | `/api/messages` | 留言列表 / 发布留言 |
| GET | `/api/author/:uid` | 作者聚合：资料、照片、画作 / 制品、同人、留言 |
| GET | `/api/admin/users` | 后台用户列表（管理员） |
| POST | `/api/admin/authorize` | 授权 / 撤销用户 `{uid, ok}` |
| GET | `/api/admin/overview` | 后台内容计数概览（管理员） |
| GET | `/api/img/:key` | R2 图片代理访问 |

会话令牌存于浏览器 `localStorage`（键 `wyw_token`），后续请求通过 `Authorization: Bearer <token>` 携带。

## 数据表

- `profiles`：用户资料（内置管理员 `hope` 不入库，由后端常量判定）
- `profile_links`：多条社交主页链接
- `gallery`：图片返图
- `crafts`：手绘画作 / 实物制品
- `fics`：文字同人（含基调 / 篇幅 / 题材标签）
- `messages`：粉丝留言
- `sessions`：服务端会话

## 配置与修改

- **修改访问密码 / 管理员 ID**：改 `wrangler.toml` 的 `[vars]`，或在 Pages 控制台环境变量中覆盖。
- **修改 R2 桶名**：同步修改 `wrangler.toml` 的 `bucket_name` 与控制台绑定。
- **认证微博主页**：档案卡链接写死在前端 `index.html` 的 `PROFILES` 中，请勿替换为非官方账号。

## 数据与版权说明

- 个人资料、投稿图片、同人、留言与主页链接保存在云端 D1 数据库与 R2 对象存储中；访问密码与授权状态由服务端校验。
- 站内照片来自公开舞台饭拍与官方物料，肖像及影像版权归原拍摄方、经纪公司及相关权利人所有；同人文为虚构创作，如有雷同纯属巧合。
- 表单收集的主页链接仅允许 `http/https` 协议，提交前做格式校验。
