# v0.4.1：本地字幕库与 IndexedDB 缓存报告

- 日期：2026-10-18
- 版本：`0.4.1`
- 范围：扩展源 IndexedDB 字幕库、最近字幕复用、缓存清除
- 环境：Windows 11 专业版 10.0.26300；Node.js 24.21.0；Chrome 155.0.8059.80

## 1. 本次实现

### 扩展源 IndexedDB

- 新增 `storage/subtitle-cache.js`：
  - 数据库 `smartSubtitleCache`，对象仓库 `subtitles`；
  - 字段：`id / fileName / title / year / language / format / cueCount / text / source / createdAt / lastUsedAt / size`；
  - 最多 50 条，按 `lastUsedAt` 排序；
  - 支持 `put / get / list / touch / remove / clear / count`；
  - Node 测试使用内存回退；浏览器使用 IndexedDB。
- **不使用 content script 自己的 IndexedDB**：
  - content script 的 IndexedDB 属于宿主网页 origin，页面脚本可能读取；
  - 因此 cache 实际运行在扩展源：service worker 或 options page。
- 新增 `storage/cache-client.js`：
  - content script 通过 `chrome.runtime.sendMessage` 访问缓存；
  - 无扩展环境时使用内存回退，DOM 测试可运行。

### Service Worker 缓存消息

新增：

- `SMART_SUBTITLE_CACHE_PUT`
- `SMART_SUBTITLE_CACHE_LIST`
- `SMART_SUBTITLE_CACHE_GET`
- `SMART_SUBTITLE_CACHE_TOUCH`
- `SMART_SUBTITLE_CACHE_CLEAR`
- `SMART_SUBTITLE_CACHE_COUNT`

Service worker 通过 `importScripts` 加载命名空间和缓存模块；Node 测试中用同名类注入。

### 面板「字幕库」

- 手动加载字幕、应用候选后自动缓存。
- 「字幕匹配」新增「加载字幕库」按钮。
- 缓存条目进入候选列表，显示「字幕库」来源标记。
- 点击后从 IndexedDB 取回原文、解析、显示；不重新选择文件。
- 最多 50 条；超出后删除最久未使用条目。

### 选项页

- 显示字幕缓存条数。
- 「清除本地数据」同时删除：
  - `smartSubtitle.*` 设置；
  - IndexedDB 字幕库。
- 隐私说明更新为“字幕库保存在扩展自己的 IndexedDB”。

## 2. 测试

### 自动测试

```powershell
npm test
```

```text
tests 82
pass 82
fail 0
duration_ms 462.4186
```

新增 5 个测试：

- 缓存指纹稳定且区分文件名；
- 内存缓存 put/get/list/remove；
- 最多 50 条按最近使用淘汰；
- content cache client 内存回退；
- Service Worker cache 消息 put/list/get/count/clear。

### 浏览器交互烟测

headless Chrome 155 + CDP：

1. 加载 `manual.srt`，缓存条数 = 1。
2. 打开「字幕匹配」→「加载字幕库」。
3. 出现 1 个候选，元信息包含“字幕库 · manual.srt · SRT · 5 条”。
4. 点击「使用此字幕」，从缓存恢复并显示轨道。
5. 缓存通过 content → service worker 消息链路（测试环境为内存回退）。

截图：[v041-library.png](screenshots/v041-library.png)

## 3. 未验证 / 限制

- 真实扩展环境中的 IndexedDB 持久化端到端未验证；Node 和浏览器烟测使用内存回退。
- Service Worker 重启后 IndexedDB 持久化未做端到端验证。
- 选项页清除 IndexedDB 的浏览器路径未做自动化验证。
- 缓存条目没有版本/影片标识隔离，只按文件内容指纹去重。
- 不是在线字幕来源；不会发起网络请求。
- ASS/SSA、自动校准、在线 Provider 仍未实现。

## 4. 下一阶段

v0.5.0：

- Provider 配置 UI；
- 明确元数据披露；
- 第一个经过审核的在线来源；
- 下载后写入字幕库；
- 真实扩展 IndexedDB 持久化验收。

完整版判定见 [ROADMAP.md](ROADMAP.md)。
