# v0.5.0–0.5.2：OpenSubtitles、选项页入口与模块加载修复

- 日期：2026-10-18
- 版本：`0.5.2`
- 来源：OpenSubtitles REST API v1（公开 API，需用户 API Key）
- 环境：Windows 11 专业版 10.0.26300；Node.js 24.21.0；Chrome 155.0.8059.80

## 1. 本次实现

### 配置

- 设置页新增「在线字幕来源」：
  - OpenSubtitles API Key；
  - 显式启用开关；
  - 可选域名权限请求 `https://*.opensubtitles.com/*`；
  - 来源说明、API Key 获取链接和隐私提示。
- API Key 存在 `chrome.storage.local`，不进入 content script。
- 关闭在线来源时移除可选域名权限；清除本地数据也删除 Key 和权限。

### 网络边界

- `manifest.json` 没有安装时 `host_permissions`；
  只声明 `optional_host_permissions`。
- 内容脚本只发消息；真正 fetch 在 service worker 中执行。
- 只发送：片名、年份、语言、季/集。
- 不发送：视频、音频、字幕文件、页面 URL、API Key 以外的凭据。

### 搜索与下载

- `matching/opensubtitles-provider.js`：
  - `GET /subtitles` 搜索；
  - 映射 `subtitle_id / language / download_count / hearing_impaired /
    release / feature_details / files`；
  - `POST /download` 获取临时链接；
  - 下载文本按 UTF-8 解码；
  - 检测 ZIP 响应并给出明确错误；
  - HTTP 401/403、网络错误、缺配置都有明确 code。
- content 侧 `storage/provider-client.js` 只提交查询和候选 fileId。
- 在线结果与本地候选、字幕库统一评分。
- 点击「使用此字幕」后才下载正文；下载后写入扩展源字幕库。

### 面板

- 「字幕匹配」新增「在线搜索」。
- 候选卡片显示 OpenSubtitles 来源和下载次数。
- 未启用时明确提示去设置页配置；不会发网络请求。

## 2. 测试

```powershell
npm test
```

```text
tests 91
pass 91
fail 0
duration_ms 582.7687
```

新增测试：

- OpenSubtitles 搜索 URL、请求头、属性映射；
- `POST /download` 参数与 UTF-8 文本；
- ZIP 响应检测；
- 未配置/401 错误；
- Provider 配置默认值、清洗、内存回退。

浏览器烟测：

- 面板「在线搜索」按钮可见；
- 未配置时明确显示“当前不是扩展环境，无法连接在线字幕来源”（CDP 测试环境没有扩展 runtime）；
- 设置页显示 API Key 输入、启用开关、权限说明；
- 用 mock Provider 注入 1 条 OpenSubtitles 结果：
  - 结果与本地候选同一评分，显示 100 分 / 中置信度 / 1234 次下载；
  - 点击「使用此字幕」触发下载回调并显示轨道；
  - 全程无真实网络请求。

截图：[v05-online-result.png](screenshots/v05-online-result.png)、
[v05-options.png](screenshots/v05-options.png)

## 3. 未验证 / 风险

- 已用真实 API Key 直连 OpenSubtitles 搜索验证 HTTP 200；
  **扩展内 Service Worker + 可选权限链路仍未在安装版中实测**。
- 已移除自定义 `User-Agent`（Chromium fetch 会拒绝该头），依赖浏览器默认 UA；
  真实 API 测试接受默认/Chrome UA。
- 当前不自动解压 ZIP；若 API 返回 ZIP，会明确报错。
- 真实扩展安装后的可选权限请求、Service Worker 网络请求未自动化验收。
- 在线字幕的授权/条款由 OpenSubtitles 和用户账号约束；
  本项目不内置 API Key、不代理、不缓存 API Key 到网络侧。
- ASS/SSA、自动校准仍未实现。

## 4. 选项页入口修复（v0.5.1）

- 面板右上角新增齿轮 ⚙，直接调用 `chrome.runtime.openOptionsPage()`。
- 保留「字幕外观 → 更多设置」入口。
- 若齿轮不存在，说明页面仍是旧版 content script，需要重新加载扩展并刷新网页。
- 修复原生 `fetch` 被当作对象方法调用导致的 `Illegal invocation`：
  构造 Provider 时对 `fetch` 做 `bind(globalThis)`。
- 域名权限被拒时仍保存 API Key，但把来源置为未启用，避免“看起来保存了却无法搜索”。
- 设置页新增「测试连接」：通过 Service Worker 真实请求 OpenSubtitles，
  显示返回条数或具体错误。
- 测试总数 91。

## 5. 模块加载修复（v0.5.2）

- **根因**：Service Worker 的 `importScripts('shared/namespace.js')` 按 worker 脚本目录解析，
  实际请求 `background/shared/namespace.js`，导致缓存/来源模块为 `null`，
  面板报“在线来源模块未加载”。
- **修复**：使用 `chrome.runtime.getURL(...)` 生成完整扩展 URL。
- 新增 Service Worker import URL 回归测试。
- 最终版功能与用法见 [FINAL.md](FINAL.md)，版本历史见 [CHANGELOG.md](CHANGELOG.md)。

## 6. 后续（未包含在最终交付版）

v0.6.0：ASS/SSA 渲染评估与实现。

完整版判定见 [ROADMAP.md](ROADMAP.md)。
