# 摘记本 NoteClip

轻量级浏览器摘抄工具：随手摘录网页文字与截图，全部数据保存在本地，支持中文 / English。

A lightweight browser note-clipping extension. Capture text and screenshots from any webpage; all data stays local.

## 功能 Features

### 摘录

- **文字摘抄**：选中文字后右键「添加到摘记本」，或选中后点击浮动「摘抄」按钮。自动记录来源 URL、页面标题、保存时间；原样保留换行与缩进格式。
- **截图摘抄**：面板中点击「截图摘抄」，或在页面空白处右键「截图摘抄」，框选当前标签页任意区域保存为图片摘抄。保存后自动关闭裁剪页，支持手动关闭。
- **图片摘抄**：在网页图片上右键「保存图片到摘记本」。

### 管理

- **列表视图**：面板（Chrome/Edge 侧边栏 / Firefox 弹窗）中倒序展示；较长摘抄默认折叠，点击「展开」查看全部；显示来源标题（可点击回原文）、相对时间、来源域名。
- **搜索与筛选**：按关键词实时搜索摘抄内容、标题和批注；按星标、标签快速筛选。
- **批注**：为任意摘抄添加自由文本批注，自动保存。
- **反馈提示**：摘抄录入 / 删除时在列表上方弹出轻量 toast 提示，显示内容摘要（前 10 字）。

### 整理

- **标签系统**：自定义标签，支持为摘抄批量打标签；面板标签栏一键筛选；标签可在设置页统一新增 / 重命名 / 删除。
- **星标收藏**：为重要摘抄加星标，配合筛选快速定位。
- **删除确认**：点击删除后原位显示「确认删除 / 取消」，确认后 toast 提示已删除内容摘要。

### 设置与外观

- **深色模式**：跟随系统 / 强制浅色 / 强制深色；Edge 风格暗色面板。
- **主题色**：可自定义强调色（accent color），实时生效，面板与内容脚本浮动按钮同步跟随。
- **浮动按钮开关**：设置页「摘抄」分区可关闭内容脚本浮动按钮，实时生效，无需刷新。
- **数据备份**：一键导出为 JSON（含 base64 图片数据），支持「覆盖」或「追加合并」两种导入方式。
- **备份提醒**：可开启定期备份提醒（每周 / 每两周 / 每月），通过浏览器通知提醒。
- **快捷键**：`Alt+Shift+N` 打开摘记本面板（Chrome/Edge 打开侧边栏，Firefox 打开弹窗），可在浏览器快捷键设置页修改。

### 设置页面

面板右上角 ⚙ 进入，包含：

- **外观**：主题模式（跟随系统 / 浅色 / 深色）、强调色选择器（预设色板 + 自定义颜色）。
- **摘抄**：浮动摘记按钮开关。
- **数据备份**：导出 / 导入按钮，上次备份时间显示。
- **标签管理**：新增标签、重命名（直接编辑）、删除（原位确认）。
- **快捷键**：当前快捷键展示，可跳转浏览器设置页修改。
- **备份提醒**：开启 / 关闭、频率选择。

> 说明：截图仅捕获**当前标签页的可见区域**，无法截取浏览器内置 PDF 阅读器、页面未滚动显示的部分或浏览器外区域。

## 数据与隐私

- 所有摘抄、批注、标签、图片均保存在浏览器本地的 **IndexedDB** 中，关闭浏览器或重启电脑后不丢失。
- 插件不联网、不上传任何数据；请求 `<all_urls>` 权限仅用于在任意网页读取选中文字与页面标题，所有操作均由用户主动触发。

## 技术栈

- **构建工具**：[WXT](https://wxt.dev)（基于 Vite 的浏览器扩展框架）
- **语言**：TypeScript
- **数据库**：[Dexie.js](https://dexie.org)（IndexedDB 封装）
- **图标**：`@wxt-dev/auto-icons`（从 SVG 自动生成各尺寸图标）

## 支持的浏览器

| 浏览器 | 面板形式 | 说明 |
| --- | --- | --- |
| Chrome | 侧边栏（Side Panel） | 原生 sidePanel API |
| Edge | 侧边栏（Side Panel） | 同 Chrome |
| Firefox | 工具栏弹窗（Popup） | manifest 中排除 sidePanel |

## 开发

环境要求：Node.js ≥ 22。

```bash
npm install             # 安装依赖
npm run dev             # 开发模式（Chrome）
npm run dev:firefox     # 开发模式（Firefox）
npm run build           # 构建 Chrome 产物
npm run build:firefox   # 构建 Firefox 产物
npm run test            # 数据层单元测试（vitest，12 项）
npm run compile         # TypeScript 类型检查（无输出即通过）
npm run zip             # 生成 Chrome + Firefox 发布用 zip 包
```

构建产物位于 `.output/`。

### 加载未打包扩展

- **Chrome / Edge**：打开 `chrome://extensions`（或 `edge://extensions`）→ 开启「开发者模式」→ 「加载已解压的扩展程序」→ 选择 `.output/chrome-mv3/`。
- **Firefox**：打开 `about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选择 `.output/firefox-mv3/manifest.json`。

## 权限说明

安装时会请求以下权限：

| 权限 | 用途 |
| --- | --- |
| `<all_urls>` | 在任意网页显示浮动摘抄按钮、读取选中文字与页面标题、下载右键图片；摘抄操作均由用户主动触发。 |
| `storage` | 本地保存摘抄数据与设置（chrome.storage.local）。 |
| `contextMenus` | 右键菜单（添加到摘记本 / 截图摘抄 / 保存图片）。 |
| `downloads` | 导出备份文件下载。 |
| `alarms` | 备份提醒定时任务。 |
| `notifications` | 备份提醒系统通知。 |
| `sidePanel`（Chrome/Edge） | 侧边栏面板。 |

## 已知限制

- 截图仅捕获**当前标签页的可见区域**，无法截取浏览器内置 PDF 阅读器、页面未滚动显示的部分或浏览器外区域。
- 个别防盗链网站的图片「保存图片到摘记本」可能失败。
- 浏览器内置 PDF 阅读器不允许注入脚本，无法在其上直接摘抄文字。
- 侧边栏截图框选裁剪页无法在 Firefox 弹窗中使用（弹窗关闭后裁剪页状态可能丢失）。

## 项目结构

```
src/
├─ entrypoints/
│  ├─ background.ts        # 后台服务：右键菜单、消息路由、快捷键、备份提醒、stale capture 清理
│  ├─ content/             # 内容脚本：浮动摘抄按钮（事件隔离、pressing 标志、setting 实时跟随）
│  ├─ sidepanel/           # Chrome/Edge 侧边栏入口
│  ├─ popup/               # Firefox 弹窗入口
│  ├─ options/             # 设置页（完整设置面板）
│  └─ capture/             # 截图框选裁剪页（captureVisibleTab + Canvas 裁剪 + 3s 自动关闭）
├─ panel/                  # 面板共享 UI（列表、搜索、批注、标签、导入导出、展开/收起、toast 反馈）
├─ settings/               # 设置模型（Settings 接口）、存取、主题应用（accent + color-mix）
├─ bg/                     # 后台逻辑模块
│  ├─ menus.ts             # 右键菜单注册与点击处理
│  ├─ messages.ts          # runtime.onMessage（saveText / saveImage / startCapture）
│  ├─ commands.ts          # 快捷键 sidePanel.open（synchronous user-gesture 调用）
│  ├─ capture.ts           # 截图 captureVisibleTab → pendingCaptures 表
│  ├─ sidepanel.ts         # sidePanel.setPanelBehavior（Chromium only）
│  └─ reminder.ts          # chrome.alarms + notifications 备份提醒
├─ db/                     # Dexie 数据层（snippets / tags / pendingCaptures 表）+ 导入导出
├─ utils/                  # i18n（_locales/zh_CN + en）、格式化（esc / relTime / fullTime / domainOf）
├─ assets/                 # icon.svg（auto-icons 源）
└─ types.ts                # Snippet / Tag / PendingCapture / ExportFile / BgMessage 类型

public/
└─ _locales/               # 中文 + 英文国际化

tests/
├─ setup.ts                # fake-indexeddb + fake-browser + FileReader polyfill
└─ db.test.ts              # 12 项数据层单元测试
```
