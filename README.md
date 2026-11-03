# 序构 Product Studio · AI 产品设计与交付工作台

序构 Product Studio 是面向产品经理和研发团队的产品设计工作台，用于整理需求、生成产品方案、管理项目内容、连接 AI/Codex 能力并输出可交付成果。

## 主要功能

- 产品项目、需求、功能模块和交付内容管理。
- AI 辅助分析、方案生成、编辑和结构化输出。
- 模板、版本、导出、文件打包和成果归档。
- 用户、权限、后台设置和操作记录。
- 可选的 Codex CLI 与飞书开放平台集成。

## 技术架构

- 前端：Vue 3、Vite、Vue Router、TypeScript。
- 服务端：NestJS 11、Express、MySQL。
- 内容处理：Marked、DOMPurify、JSZip、Zod。
- 运行：Node.js 22、Nginx、systemd/PM2。

## 环境要求

- Node.js 22+、npm 10+、MySQL 8.0。
- 可选：Codex CLI、飞书开放平台应用。

## 本地安装

```bash
git clone https://github.com/CharlesYin1204/product-studio.git
cd product-studio
npm ci
cp .env.example .env
npm run typecheck
npm run build
npm start
```

生产式启动默认监听 `127.0.0.1:3010`。仅开发前端可执行 `npm run dev`，后端需另行编译并启动。

## 环境变量

| 配置 | 说明 |
| --- | --- |
| `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` | MySQL 连接 |
| `ENCRYPTION_KEY` | 64 位十六进制数据加密密钥 |
| `ADMIN_EMAIL`、`ADMIN_PASSWORD` | 首次管理员配置 |
| `PUBLIC_URL`、`PORT` | 对外地址与服务端口 |
| `CODEX_CLI_ENABLED`、`CODEX_CLI_PATH`、`CODEX_MODEL` | 可选 Codex CLI 集成 |
| `AI_TIMEOUT_MS`、`CODEX_TIMEOUT_MS` | 外部任务超时 |

## 构建与验证

```bash
npm run typecheck
npm run build
NODE_ENV=production npm start
```

上线前应验证登录、项目创建、内容编辑、AI 任务、导出、权限和异常恢复。

## 生产部署

1. 安装 Node.js 22、MySQL 和 Nginx，创建独立系统用户与数据库账号。
2. 拉取代码，执行 `npm ci`，创建权限为 `600` 的 `.env`。
3. 初始化或迁移数据库，生成强随机 `ENCRYPTION_KEY`。
4. 执行 `npm run typecheck && npm run build`。
5. 使用 systemd 或 PM2 运行 `npm start`，内部监听 `127.0.0.1:3010`。
6. Nginx 配置 HTTPS、反向代理、请求体限制和超时。
7. 如启用 Codex CLI，使用受限系统用户和独立工作目录，限制可访问路径。
8. 配置数据库、导出成果和环境文件备份。

更新前备份数据库和成果文件，然后安装依赖、执行迁移、构建并重启；保留上一版本构建用于回滚。

## 项目结构

- `web/`：Vue 前端。
- `server/`：NestJS API、数据库和业务服务。
- `artifacts/`：生成成果与备份，生产数据不纳入 Git。
- `package.json`：构建、类型检查和启动命令。

## 常见问题

- 启动提示加密密钥错误：`ENCRYPTION_KEY` 必须是 64 位十六进制字符串。
- 页面空白：确认 `npm run build` 已生成 `web/dist`。
- AI/Codex 超时：检查 CLI 路径、权限、模型配置和超时值。
- 写操作被拒绝：确认 `PUBLIC_URL` 与浏览器 Origin 一致。

## 联系方式

微信：`charlesyin6015`
