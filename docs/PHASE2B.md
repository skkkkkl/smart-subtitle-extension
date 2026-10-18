# v0.3.0：外观 2.0 + Phase 2B 起步报告

- 日期：2026-10-18
- 版本：`0.3.0`
- 范围：
  - 字幕外观放大、实时位置、字重、投影阴影；
  - Phase 2B 基础：影片元数据提取、候选评分、Provider 契约。
- 环境：Windows 11 专业版 10.0.26300；Node.js 24.21.0；Chrome 155.0.8059.80

## 1. 外观 2.0

### 面板放大

- 面板宽度：`360px → 420px`。
- 收起宽度：`264px → 300px`。
- 字号、字重、颜色、描边、位置采用更大的控件和两列布局。
- 外观区域仍可滚动，不会遮挡视频控制栏（默认右上角）。

### 位置实时移动

以前拖动位置滑块只在 `change` 时重建整条 `<track>`。现在：

1. `input` 事件直接修改当前 `TextTrack.cues` 的
   `cue.snapToLines = false` 和 `cue.line = 百分比`；
2. 不创建新 Blob、不重新加载轨道；
3. `change` 时保存设置；
4. 只有带作者 `line` 的 cue 被排除在实时移动之外；
5. 下一次重新加载轨道时，位置仍通过 generated WebVTT `line:xx%` 保留。

浏览器烟测实测：滑块从 90 → 75 时 cue 的 `line` 立即变成 75，
`URL.createObjectURL` 计数保持 1，轨道 `src` 不变。

### 字重

新增 400 / 500 / 600 / 700 / 800 字重，写入 `::cue` 的 `font-weight`。

### 投影阴影

新增独立阴影设置：

- 启用/关闭；
- 颜色；
- 不透明度 0–90%；
- 模糊 0–16px；
- X/Y 偏移 ±16px。

阴影使用 `text-shadow` 追加在 24/32 向轮廓环之后，位于描边和文字后方。
关闭阴影会同时禁用相关控件，并立即从注入的 CSS 中移除阴影层。

### 大字号轮廓

保留 v0.2.1 的平滑轮廓算法：2px 以下 24 向，4px 以上 32 向，0.12–0.4px 微模糊。
对比图见 `docs/screenshots/outline-comparison.png`。

## 2. Phase 2B 基础

### 2.1 影片元数据提取

文件：`matching/metadata-extractor.js`

支持：

- JSON-LD `Movie` / `TVSeries` / `TVEpisode` / `VideoObject`；
- Open Graph / Twitter meta；
- `h1`、页面标题；
- `video.duration`；
- 年份、ISO 8601/时钟/中英文时长；
- 语言归一化（zh/en/ja/ko/fr/de/es/ru）；
- `S01E02`、`第 1 季 第 2 集`、`1x02`；
- 发布文件名清洗（分辨率、WEB-DL、BluRay、x264、中字等）。

面板在「目标视频」下显示低干扰的“自动识别”信息，例如：

```text
自动识别：本地字幕助手演示 · 2026 · zh · 识别度 较高
```

置信度低于 0.5 时不显示，避免把普通网页标题当作电影名。
这些元数据只在本机读取，不发送。

### 2.2 候选字幕评分

文件：`matching/candidate-ranker.js`

评分权重：

- 片名相似度 0.50；
- 年份 0.18；
- 时长 0.20；
- 语言 0.07；
- 集数 0.05。

特性：

- 拉丁词 token Jaccard + 字符 bigram Dice，兼顾 CJK；
- 英文标题词序不同仍可匹配；
- 文件名回退解析标题/年份；
- 年份/时长/语言硬冲突扣分；
- 缺字段时降低 coverage 和置信度，而不是当作满分；
- 输出匹配理由、冲突项、置信度和覆盖率。

示例：

```js
rankCandidates(query, candidates)
// → [{ score, coverage, confidence, confidenceLabel, reasons, mismatches }]
```

### 2.3 Provider 契约

文件：`matching/subtitle-provider.js`

- `ProviderRegistry` 注册/校验/搜索/下载路由；
- 严格要求 `id`、`name`、`search()`、`download()`；
- 禁用的 Provider 不会被调用；
- 单个 Provider 失败不会中断其他 Provider；
- **没有内置网络 Provider，没有 API 地址，没有伪造搜索结果**；
- 网络来源必须在用户明确配置并经审核后接入。

### 2.4 当前未接入搜索 UI

目前没有“搜索字幕”结果列表。原因是：

- 没有指定的合法字幕来源；
- 不在本次任务中伪造第三方 API；
- 元数据提取、评分和 Provider 契约先完成，下一步再接真实来源和手动片名。

## 3. 测试

```powershell
npm test
```

实测：

```text
tests 77
pass 77
fail 0
duration_ms 351.6109
```

新增测试文件：

- `tests/metadata-extractor.test.js`（8）；
- `tests/candidate-ranker.test.js`（7）；
- `tests/subtitle-provider.test.js`（6）。

覆盖：

- JSON-LD、OG meta、时长/语言/集数；
- 文件名清洗与年份排除分辨率；
- CJK/英文标题相似度；
- 年份/时长/语言冲突扣分；
- 缺失字段的 coverage/confidence；
- 候选排序；
- Provider 校验、聚合、失败隔离、禁用、下载路由；
- 空 Provider 不产生网络行为。

### 浏览器烟测

- 选项页放大后的字体/字重/阴影控件；
- 面板宽度实测 `420px`；
- 演示页 JSON-LD 自动识别为“本地字幕助手演示 · 2026 · zh”；
- SRT 加载后 live position：90 → 75，cue.line 立即更新，Blob 创建数保持 1；
- 关闭阴影后 CSS 中 drop-shadow 层消失，阴影控件 disabled；
- 字重改为 700 后 CSS `font-weight: 700`；
- 带 `line:75%` 的 VTT cue 在滑块 80 时保持 75，未带 line 的 cue 变为 80；
- 截图：
  - `docs/screenshots/v03-options.png`
  - `docs/screenshots/v03-panel.png`

## 4. 失败项

- 自动测试：无。
- 浏览器 DOM 烟测：无。
- 真实扩展安装/工具栏点击 E2E：仍未执行，标记为未验证。

## 5. 未验证

- 真实 `chrome.storage.local` 持久化；
- 真实 Service Worker `insertCSS` 的 USER origin；
- `::cue` 的像素级最终外观；
- 真实站点上的元数据识别准确率；
- 任何真实网络 Provider；
- Firefox/Edge/Android。

## 6. 限制

- 元数据是启发式，可能误识别；当前只显示，不参与网络上传；
- 当前没有手动片名覆盖（下一步加入）；
- 没有搜索 UI、候选列表、IndexedDB 缓存；
- 位置实时移动不覆盖作者 `line` 的 cue；
- 极宽描边仍有轻微 text-shadow 近似感；
- 阴影和描边受站点样式/浏览器版本影响；
- 原生 `<video>` 全屏面板仍不可见。

## 7. 下一步

1. 在面板加入「搜索字幕」区：
   - 识别/手动修正片名；
   - 明确显示将要发送的元数据；
   - 未配置 Provider 时只显示说明，不伪造候选。
2. 实现 Provider 配置 UI（仅 HTTPS、Terms/Privacy 链接、显式启用）。
3. 接第一个经过审核的真实来源，或先做离线候选列表。
4. 候选评分列表 + 置信度/理由。
5. IndexedDB 缓存与清除。
6. 之后再做 ASS 与自动校准。
