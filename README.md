# Trae Account Manager

TRAE SOLO CN（Traework）多账号管理工具。在一处管理多个 Trae 账号：一键切号、批量签到领积分、实时查看权益包用量与付费状态。

> ⚠️ 本工具仅供个人学习与研究使用，请遵守 Trae 服务条款。

## 功能特性

### 账号管理
- **四种添加方式**
  - OAuth 登录捕获：弹出 Trae 登录页，双通道（storage.json 监听 + 请求头/localStorage 捕获）自动抓取 token
  - Token 导入：粘贴 `x-cloudide-token` 直接导入
  - 本地导入：扫描本机 Trae 的 storage.json，一键导入当前登录账号
  - JSON 批量导入 / 导出：账号数据使用备份密码加密为 JSON，可迁移到其他机器
- **数据刷新**：并行拉取用户信息、权益包（额度与进度条、到期时间）、付费状态、签到状态；用量百分比按绿→黄→红渐进着色
- **自动修复**：启动时自动从本地 storage.json 恢复账号 token，修复旧版本写入的无法解密的 v10 格式 token

### 一键切号（核心）
点击「切换到此号」后自动完成：
1. 关闭正在运行的 Trae 进程（PowerShell CIM 枚举，兼容 Windows 11 移除 WMIC 的环境）
2. 将目标账号的**完整 auth blob**（token、refreshToken、userRegion、scope、loginScope 等）原子写入 Trae 的 `storage.json`
3. 重新启动 Trae（自动探测 exe 路径：运行中进程 → 上次已知路径 → 注册表/常见安装目录，含 `D:\TRAE SOLO CN\`、`D:\Trae CN\`、`D:\Trae\` 等盘符根目录安装）

切换过程按钮即时进入加载态，避免「点了没反应」的感觉。

### 其他
- **批量签到**：勾选多个账号一键签到，领取积分
- **用量统计**：请求量记录与汇总视图
- **中英双语**：默认中文，可在设置中切换 English
- **深浅主题**：暗色极光玻璃态 / 亮色主题一键切换
- **自定义无边框窗口**：极光渐变背景、自绘标题栏（最小化/最大化/关闭融入主题）

## 界面

- 左侧：Cockpit 式玻璃态侧边栏（账号 / 签到 / 统计 / 设置 + 刷新、添加账号）
- 主区：账号卡片流，展示头像、昵称、权益包进度、积分、签到状态、登录态徽标

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Windows 10 / 11（x64） |
| Node.js | ≥ 18（开发环境，推荐 22） |
| npm | ≥ 9 |

## 开发调试

```powershell
npm install
npm run dev   # 并行启动 Vite (5173) 与 Electron
```

沙箱环境下编译 `better-sqlite3` 需要重定向 electron 头文件目录：

```powershell
$env:npm_config_devdir = 'D:\work\traework\.electron-gyp'
npm install
```

## 构建打包

```powershell
npm run pack   # 便携版：release/win-unpacked/Trae Account Manager.exe
npm run dist   # NSIS 安装包：release/Trae-Account-Manager-Setup-1.0.0.exe
```

打包前请先退出正在运行的应用，否则 `better-sqlite3` 原生模块会因文件占用（EBUSY）编译失败：

```powershell
Get-Process -Name 'Trae Account Manager' -ErrorAction SilentlyContinue | Stop-Process -Force
```

构建流程（`scripts/build.js`）：TypeScript/Vite 编译 → electron-builder 打包 → `resedit` 写入 EXE 图标与版本信息（不用 rcedit，其在 Windows 上会报 "Unable to commit changes"）。

## 数据存储与安全

| 数据 | 位置 |
| --- | --- |
| 账号数据库 | `%APPDATA%\trae-account-manager\data.db`（SQLite） |
| 运行日志 | `%APPDATA%\trae-account-manager\app.log` |
| 应用配置 | `%APPDATA%\trae-account-manager\config.json` |

- token 与 auth blob 使用 **Windows DPAPI**（Electron `safeStorage`）加密后入库，仅本机当前用户可解密
- Trae 的 `storage.json` 使用自定义 **AES-128-CBC + SHA-512 完整性校验** 方案解密（非 safeStorage 格式）
- 导出的 JSON 使用 PBKDF2-SHA256（210,000 次迭代）派生密钥，并通过 AES-256-GCM 加密；文件不含明文 token，备份密码无法找回

## 技术架构

```
Electron 31 + React 18 + TypeScript + Tailwind CSS + SQLite(better-sqlite3)
├─ src/main            主进程
│  ├─ window.ts        无边框窗口、焦点管理（启动置顶 1s 后恢复）
│  ├─ ipc/             IPC 通道注册
│  └─ services/
│     ├─ account.service.ts   账号 CRUD、切号（auth blob 回放）、数据刷新
│     ├─ traework.service.ts  storage.json 读写/解密、进程枚举与启停
│     ├─ api.service.ts       Trae OpenAPI（x-cloudide-token 头；v2 优先 v1 回退）
│     ├─ auth.service.ts      OAuth 登录流程与 token 捕获
│     ├─ checkin.service.ts   签到
│     ├─ crypto.service.ts    DPAPI 加解密
│     └─ database.ts          SQLite 初始化与迁移
├─ src/preload         contextBridge 安全暴露 IPC
├─ src/renderer        React 界面（i18n、主题、Toast、账号卡片等）
└─ src/shared          主/渲染进程共享类型
```

关键接口约定：
- 认证头：`x-cloudide-token`（不是 `x-ide-token`）
- 用户信息：`/cloudide/api/v3/trae/GetUserInfo`
- 付费状态 / 用量明细：v2 接口优先，v1 兜底
- API 调用始终实时读取 Trae 本地 `storage.json` 中的 token，而非数据库内缓存 token

## 常见问题

**切号后 Trae 显示未登录？**
老版本应用没有保存完整 auth blob，切换时会用「最完整模板 + 该账号 token」拼装。若个别账号仍登不进，用 OAuth 或 Token 导入**重新导入该账号一次**，之后切换即回放其完整凭据。

**API 请求 401？**
数据库中旧格式（v10）token 无法通过 safeStorage 解密。应用启动时会自动从 `storage.json` 修复；若仍失败，删除账号后重新导入。

**提示找不到 Trae.exe？**
设置页 → 切号设置 → 填写 `Trae.exe` 完整路径，或点「自动探测」。

**界面闪烁？**
已修复：早期版本在无限动画的极光背景上叠加了 `backdrop-filter` 玻璃模糊，导致每帧全窗口 GPU 重合成而闪烁；现已移除常驻表面的 backdrop-filter，改用半透明底色呈现玻璃质感。

**日志在哪里？**
`%APPDATA%\trae-account-manager\app.log`，含主进程与渲染进程控制台输出，排查问题首选。

## License

MIT
