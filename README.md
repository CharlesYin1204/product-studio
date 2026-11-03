# 序构 · Product Studio

序构是一套面向产品经理和业务团队的 AI 产品设计工作台，将项目需求、PRD、原型、交互预览和交付资料集中到统一工作空间中。

## 核心能力

- 项目、需求和产品文档统一管理。
- AI 创作中心辅助需求分析、文档生成与内容优化。
- 原型源码、交互预览、离线交付和数据快照导出。
- 独立身份验证、项目隔离、配置加密和飞书资料接入。

## 产品界面

![序构产品工作台](artifacts/workspace-desktop.png)

![序构 AI 创作中心](artifacts/ai-studio-generated.png)

![序构交互原型预览](artifacts/ai-prototype-interaction.png)

## 技术架构

- 服务端：Node.js 22、NestJS 11、MySQL
- 前端：Vue 3、Vite、TypeScript
- 部署：Nginx、systemd

## 本地运行

1. 安装 Node.js 22 和 MySQL。
2. 执行 `npm ci`。
3. 复制 `.env.example` 为 `.env`，配置数据库和 32 字节 `ENCRYPTION_KEY`。
4. 使用 `server/schema.sql` 初始化空数据库。
5. 执行 `npm run typecheck` 和 `npm run build`。
6. 运行 `npm start`。

开发界面可使用 `npm run dev` 启动。

## 生产部署

使用 systemd 托管 Node.js 服务，由 Nginx 反向代理到 `127.0.0.1:3010` 并配置 HTTPS。更新前备份数据库和环境配置，在候选目录完成类型检查与构建后再切换服务。`ENCRYPTION_KEY` 创建后必须单独备份，不可随意更换。

## 项目结构

- `server/src/`：认证、项目、文档、集成和原型服务
- `server/schema.sql`：数据库结构
- `web/src/`：Vue 工作台
- `scripts/`：构建与业务验证工具
- `artifacts/`：电脑端产品界面图
- `project-docs/`：需求、架构、进度和维护记录

## 联系方式

微信：`charlesyin6015`
