# 个人主页模板项目

这是一个基于 Vite + React + TypeScript 的可配置个人主页项目，包含公开首页、密码保护简历、AI 分身、文章系统、访问统计、后台管理、私有运行文件管理与 VPS 部署流程。

项目目标不是只做一个静态展示页，而是把个人简历、能力地图、项目介绍、AI 对话、文章内容和后台运营能力整合成一个可长期维护、可迁移部署的个人网站。

## 主要功能

- 公开首页：展示个人定位、项目入口、能力地图和个人主页项目说明。
- 密码保护简历：简历数据和 PDF 通过服务端接口保护，不直接打包进前端。
- AI 分身：基于简历、能力盘点、项目经验等私有资料回答访问者问题。
- 文章管理：后台支持手写 Markdown、上传文章、删除文章，并可控制首页文章入口是否显示。
- 访问统计：记录访问页面、IP、停留时长、地区分析、页面排行和筛选列表。
- AI 对话记录：保留历史对话，后台可按 IP 查看，并支持 AI 分析访问者关心的问题。
- 后台设置：可管理主题、首页内容、排除统计 IP、运行配置和私有文件。
- 文件管理：支持导入、导出、上传、下载和恢复运行文件，便于迁移到其他服务器。
- 部署安全：部署脚本会先备份线上运行数据，再发布代码版本。

## 技术栈

- 前端：React、TypeScript、Vite、CSS
- 图标：lucide-react
- Markdown 渲染：react-markdown、remark-gfm
- 服务端边界：Vite middleware / Node.js
- 部署：Nginx、Node.js、VPS release 目录、shared 运行数据目录

## 本地启动

1. 安装依赖。

   ```bash
   npm install
   ```

2. 复制环境变量示例文件，并填写本地私有配置。

   ```bash
   cp .env.example .env
   ```

3. 创建私有运行数据文件。

   ```bash
   mkdir -p server/private/avatar-notes
   cp server/private.example/resume-data.local.example.json server/private/resume-data.local.json
   cp server/private.example/site-settings.local.example.json server/private/site-settings.local.json
   cp server/private.example/articles.local.example.json server/private/articles.local.json
   ```

4. 放入真实简历 PDF。

   默认可放在：

   ```text
   server/private/resume-demo.pdf
   ```

5. 启动开发服务。

   ```bash
   npm run dev
   ```

6. 打开页面。

   ```text
   http://127.0.0.1:5173/#/
   ```

## 常用命令

```bash
npm run dev              # 启动本地开发服务
npm run typecheck        # TypeScript 类型检查
npm run build            # 构建生产版本
npm run preview          # 预览构建结果
npm run backup:local-data # 备份本地完整运行数据
npm run deploy:vps       # 备份 VPS 数据后部署代码
```

## 后台管理

后台入口是隐藏路由：

```text
#/admin
```

后台包含：

- 访问记录、访问排行、页面筛选和强制踢人下线
- 文章新增、上传、删除和首页入口开关
- AI 分身历史对话、按 IP 查看和对话分析
- 主题切换、首页内容配置、统计排除 IP
- 私有运行文件上传、下载、替换、恢复历史版本
- 未加密运行数据一键导出和一键导入

后台密码与简历/AI 分身访问密码是分开的。真实密码应通过私有运行配置或环境变量管理，不应写入 Git。

## 私有运行数据

以下内容必须保留在本地或服务器私有目录，不能提交到公开仓库：

- `.env`
- `.codex/`
- `.trellis/`
- `backups/`
- `server/private/*.local.json`
- `server/private/*.pdf`
- `server/private/avatar-notes/`
- `server/private/site-assets/`
- `server/private/runtime-backups/`
- `artifacts/private-data-backups/`

仓库中的 `server/private.example/` 只放示例占位文件，用来帮助新环境初始化。

## 本地完整备份

如果要保留一份可迁移到其他服务器的完整运行数据，可以执行：

```bash
npm run backup:local-data
```

备份会生成在：

```text
artifacts/private-data-backups/local-<timestamp>/
```

这个归档可能包含 `.env` 和 `server/private`，属于敏感私有数据，不要上传到公开仓库或公共网盘。

## VPS 部署安全

正常部署命令：

```bash
npm run deploy:vps
```

部署前需要在本地环境变量中配置服务器信息，例如 `PERSONAL_SITE_HOST`、`PERSONAL_SITE_USER`、`PERSONAL_SITE_PASSWORD`、`PERSONAL_SITE_ROOT`、`PERSONAL_SITE_SERVICE`。不要把真实服务器信息写入仓库。

部署流程会先执行：

```bash
npm run backup:vps-data
```

它会把 VPS 上的 shared `.env` 和 `shared/private` 目录备份下载到本地忽略目录，然后再发布代码。线上文章、设置、访问记录、历史对话、简历文件、AI 参考资料等都属于运行数据，部署代码时不应覆盖。

当前部署策略：

- 代码走 release 目录发布。
- 运行数据放在 shared 目录。
- 发布时保留当前版本和上一发布版本。
- 发布前自动备份线上 shared 数据。
- 除非明确要求，不覆盖线上 `.env` 或 `shared/private`。

## 迁移到其他 VPS

推荐流程：

1. 在当前环境执行 `npm run backup:local-data`，生成完整运行数据备份。
2. 在新 VPS 安装 Node.js、Nginx，并准备服务目录。
3. 将 `.env` 和 `server/private` 恢复到新服务器的 shared 运行数据目录。
4. 使用代码部署脚本发布项目。
5. 验证首页、简历解锁、AI 分身、后台、文章和访问记录是否正常。

迁移时请特别注意：真实运行数据比代码更重要，发布或迁移前必须先备份。

## 开源与二次使用

这个项目可以作为个人主页模板继续改造。你可以替换：

- 简历页面数据和 PDF
- AI 分身参考资料
- 首页公开文案
- 网站标题、Logo 和图标
- 文章内容
- 主题样式
- API 地址、模型配置和后台密码

真实个人资料、密钥、服务器配置和运行记录请始终放在私有目录或环境变量中。
