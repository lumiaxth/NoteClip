# 摘记本 NoteClip

轻量级浏览器摘抄工具：随手摘录网页文字与截图，全部数据保存在本地，支持中文 / English。

A lightweight browser note-clipping extension. Capture text and screenshots from any webpage; all data stays local.

## 功能 Features

- **文字摘抄**：选中文字后右键「添加到摘记本」，或选中后点击浮动「摘抄」按钮。自动记录来源 URL、页面标题、保存时间。
- **截图摘抄**：面板中点击「截图摘抄」，或在页面空白处右键「截图摘抄」，框选当前标签页任意区域保存为图片摘抄。
- **图片摘抄**：在网页图片上右键「保存图片到摘记本」。
- **摘抄管理**：侧边栏（Chrome/Edge）或弹窗（Firefox）中倒序展示；支持关键词搜索、添加/编辑批注、删除。
- **整理分类**：自定义标签、星标收藏与快速筛选。
- **跳转回溯**：点击摘抄的来源标题，在新标签页打开原文。
- **备份恢复**：一键导出为 JSON，支持「覆盖」或「追加合并」两种导入方式。

## 数据与隐私

- 所有摘抄、批注、标签、截图均保存在浏览器本地的 IndexedDB 中，关闭浏览器或重启电脑后不丢失。
- 插件不联网、不上传任何数据。

## 支持的浏览器

| 浏览器 | 说明 |
| --- | --- |
| Chrome | 侧边栏（side panel） |
| Edge | 侧边栏（side panel） |
| Firefox | 工具栏弹窗（popup） |

## 开发

环境要求：Node.js ≥ 22。

```bash
npm install
npm run dev            # 开发模式（Chrome）
npm run dev:firefox    # 开发模式（Firefox）
npm run build          # 构建 Chrome 产物
npm run build:firefox  # 构建 Firefox 产物
npm run test           # 数据层单元测试
npm run zip            # 生成发布用 zip 包
```

构建产物位于 `.output/`。

### 加载未打包扩展

- **Chrome / Edge**：打开 `chrome://extensions`（或 `edge://extensions`）→ 开启「开发者模式」→ 「加载已解压的扩展程序」→ 选择 `.output/chrome-mv3/`。
- **Firefox**：打开 `about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选择 `.output/firefox-mv3/manifest.json`。

## 权限说明

安装时会请求以下权限：

- **读取和更改所有网站的数据**（`<all_urls>`）：用于在任意网页显示浮动摘抄按钮、读取选中文字与页面标题、捕获当前标签页截图、下载右键图片。摘抄操作均由你在页面上主动触发。
- `storage`：本地保存摘抄数据。
- `contextMenus`：右键菜单（添加到摘记本 / 截图摘抄 / 保存图片）。
- `downloads`：导出备份文件。
- `sidePanel`（仅 Chrome/Edge）：侧边栏。

## 已知限制

- 截图仅捕获**当前标签页的可见区域**，无法截取浏览器内置 PDF 阅读器、页面未滚动显示的部分或浏览器外区域。
- 个别防盗链网站的图片「保存图片到摘记本」可能失败。
- 浏览器内置 PDF 阅读器不允许注入脚本，无法在其上直接摘抄文字。

## 项目结构

```
src/
├─ entrypoints/
│  ├─ background.ts      # 后台服务：右键菜单、消息路由、截图捕获
│  ├─ content/           # 内容脚本：选中文字浮动摘抄按钮
│  ├─ sidepanel/         # Chrome/Edge 侧边栏入口
│  ├─ popup/             # Firefox 弹窗入口
│  └─ capture/           # 截图框选裁剪页
├─ panel/                # 面板共享 UI（列表、搜索、批注、标签、导入导出）
├─ bg/                   # 后台逻辑（菜单、截图、消息）
├─ db/                   # Dexie 数据层 + 导入导出
├─ utils/                # i18n、格式化等
└─ types.ts
```
