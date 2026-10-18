# 版本历史

## 0.9.11 — 整段 40 秒全局相关性

- 额外输出整段 40 秒 global offset/score/secondDistinct。
- 仅诊断，不自动应用。
- 测试：119 通过。
- 验收报告：[ACCEPTANCE-0.9.11.md](ACCEPTANCE-0.9.11.md)。

## 0.9.10 — 跨窗口候选共识

- 汇总窗口候选峰，±1000ms 合并成簇。
- 按支持窗口数排序，输出 offset/support/medianScore/second。
- 仅诊断，不降低有效窗口门槛，不自动应用。
- 测试：119 通过。
- 验收报告：[ACCEPTANCE-0.9.10.md](ACCEPTANCE-0.9.10.md)。

## 0.9.9 — 第二独立峰与时间映射诊断

- 每窗口输出 audio sample start/end、best/second distinct peak offset/score、distinctMargin、searchBoundaryHit、mediaTimeDiscontinuity、rejectReason。
- 第二峰跳过最佳峰附近 1 秒的相邻搜索点。
- 不降低有效窗口/相关性/峰 margin 门槛。
- 测试：118 通过。
- 验收报告：[ACCEPTANCE-0.9.9.md](ACCEPTANCE-0.9.9.md)。

## 0.9.8 — 峰值质量与 MAD 语义修正

- 标准 MAD 围绕未加权中位数；目标残差 MAD 围绕加权中位数，两者分别输出。
- margin <0.03 标记 AMBIGUOUS_PEAK；贴近 ±15s 边界标记 SEARCH_BOUNDARY。
- 低质量窗口先剔除，不再用它们计算一致性。
- 诊断增加候选峰、拒绝窗口 offset/score/margin。
- 测试：117 通过。
- 验收报告：[ACCEPTANCE-0.9.8.md](ACCEPTANCE-0.9.8.md)。

## 0.9.7 — 逐窗口诊断

- 多窗口失败输出逐窗口证据：媒体时间、偏移、分数、margin、活动比例、cue 比例。
- 面板新增「校准诊断」/复制诊断。
- 不降低 MAD 阈值、不强制平均。
- 测试：116 通过。
- 验收报告：[ACCEPTANCE-0.9.7.md](ACCEPTANCE-0.9.7.md)。

## 0.9.6 — 多窗口鲁棒校准

- 40 秒采样拆成 5 个 8 秒窗口。
- 音频活动/时间映射校验；低活动窗口剔除。
- 加权中位数、MAD、窗口跨度、分簇拒绝。
- 目标总偏移语义；高/中/低置信度；UI 窗口诊断。
- 测试：116 通过。
- 验收报告：[ACCEPTANCE-0.9.6.md](ACCEPTANCE-0.9.6.md)。

## 0.9.5 — 标签页音频捕获（1.0 候选）

- 新增 `tabCapture` + `offscreen` 权限与音频采样文档。
- 面板新增「标签页音频 8s」。
- 真实扩展在 Edge 155 加载：Service Worker 模块与选项页验证通过。
- 真实站点标签页音频 E2E 未完成，暂不发布 1.0.0。
- 测试：110 通过。
- 验收报告：[ACCEPTANCE-0.9.5.md](ACCEPTANCE-0.9.5.md)。

## 0.9.0 — 音频自动校准（实验）

- 新增 `content/audio-calibrator.js`：`video.captureStream()`、8 秒 RMS 采样。
- 新增 `alignment/audio-aligner.js`：音频能量与 cue 活动相关性、±15 秒搜索。
- 面板新增「检测音频」「音频校准 8s」。
- 跨域/DRM/无音轨时明确失败并回退手动校准。
- 测试：110 通过。
- 验收报告：[ACCEPTANCE-0.9.0.md](ACCEPTANCE-0.9.0.md)。

## 0.8.0 — 自动时间轴安全分析 2.0

- 首条/末条双锚点一致性检查：首条在开头、末条差 29 秒时拒绝。
- 尾差/自动偏移安全阈值从 120 秒收紧到 **10 秒**。
- 修复当前场景：视频 1:28:42、字幕末条 1:28:13、正确偏移 0，
  不再建议 +28775ms。
- 测试：106 通过。
- 验收报告：[ACCEPTANCE-0.8.0.md](ACCEPTANCE-0.8.0.md)。

## 0.7.1 — 自动分析安全修复

- 尾差 >120 秒直接拒绝自动建议（`TAIL_TOO_FAR`），不显示「应用建议」。
- 自动建议偏移 >120 秒拒绝。
- 修复“字幕末条比视频早 7 分钟”被建议 +7 分钟并误应用的问题。
- 测试：104 通过。
- 验收报告：[ACCEPTANCE-0.7.1.md](ACCEPTANCE-0.7.1.md)。

## 0.7.0 — 启发式自动偏移分析

- 新增 `alignment/offset-estimator.js`：尾锚定建议、置信度、警告、首条越界限制。
- 面板新增「自动分析」：建议偏移、置信度、警告、确认后应用。
- 视频时长优先取 `<video>.duration`，否则用本地元数据时长。
- 不自动应用；不访问音频，不做语音识别。
- 测试：103 通过。
- 验收报告：[ACCEPTANCE-0.7.0.md](ACCEPTANCE-0.7.0.md)。

## 0.6.0 — ASS/SSA 覆盖层

- 新增 ASS/SSA 解析器：Script Info、V4/V4+ Styles、Events、动态 Format。
- 新增 ASS 内联标签解析：`\an`、`\pos`、`\fs`、`\b`、`\i`、颜色、`\bord`、`\shad`、`\r`。
- 新增 ASS 覆盖层渲染：
  - 跟随视频位置/尺寸；
  - 9 宫格、`\pos`、多行、描边、阴影；
  - 支持偏移、启用/禁用、移除、字幕库、在线下载。
- ASS 使用文件内样式；外观面板不覆盖 ASS。
- 新增 7 个 ASS 解析/标签测试和浏览器覆盖层烟测。
- 测试：98 通过。
- 验收报告：[ACCEPTANCE-0.6.0.md](ACCEPTANCE-0.6.0.md)。

## 0.5.2 — 模块加载修复

- 修复 Service Worker 模块加载：
  - `importScripts` 现在使用 `chrome.runtime.getURL(...)` 完整扩展 URL；
  - 修复 `background/shared/...` 404 导致的“在线来源模块未加载”；
  - 新增 Service Worker import URL 回归测试。
- 增加最终交付文档：本文件、[FINAL.md](FINAL.md)。
- 测试：91 通过。

## 0.5.1 — 选项页与连接修复

- 面板右上角新增齿轮 `⚙`，直接打开选项页。
- 保留四种打开选项页的方式。
- 修复原生 `fetch` 被当作对象方法调用导致的 `Illegal invocation`。
- 移除 Chromium 禁止的 `User-Agent` 请求头。
- 域名权限被拒时仍保存 API Key，但来源保持未启用。
- 设置页新增「测试连接」，显示真实 API 返回或错误。
- 测试：90 通过。

## 0.5.0 — OpenSubtitles 在线来源

- 设置页 OpenSubtitles API Key、显式启用、可选域名权限。
- API Key 只存 `chrome.storage.local`，不进入 content script。
- Service Worker 代理搜索/下载。
- 在线结果与本地候选/字幕库统一评分。
- 点击结果后才下载，下载成功写入字幕库。
- ZIP/HTTP/认证/网络错误处理。
- 测试：89 通过。

## 0.4.1 — 字幕库与 IndexedDB

- 扩展源 IndexedDB 字幕库。
- content → Service Worker 缓存消息。
- 面板「加载字幕库」。
- 缓存最多 50 条、最近使用排序。
- 选项页显示缓存数；清除数据同时清缓存。
- 测试：82 通过。

## 0.4.0 — 本地候选匹配

- 面板「字幕匹配」。
- 片名、年份、语言自动预填/手动修正。
- 本地多候选评分、置信度、理由、冲突项。
- 点击「使用此字幕」直接加载。
- 完全离线。
- 测试：77 通过。

## 0.3.0 — 外观 2.0 + Phase 2B 基础

- 面板宽度 420px，外观控件放大。
- 纵向位置实时拖动，直接修改 cue.line，不重建轨道。
- 字重 400–800。
- 投影阴影。
- 元数据识别、候选评分、Provider 契约。
- 测试：77 通过。

## 0.2.1 — 平滑轮廓

- 24/32 向环形 text-shadow 描边。
- 0.5px 描边步进。
- 前后对比截图。

## 0.2.0 — Phase 2A

- 设置持久化、独立选项页、实时预览。
- 字号、颜色、描边、背景、位置。
- 保存/恢复默认/清除本地数据。
- 测试扩展到 55。

## 0.1.0 — Phase 1

- Manifest V3，按需注入，无安装时 host权限。
- 本地 SRT/VTT、编码回退、SRT→WebVTT。
- 原生 `<track>`、多视频、动态检测、轨道清理。
- 整体时间偏移、撤销、归零。
- 悬浮面板。

## 说明

`0.9.11` 是 1.0 发布候选：包含 ASS/SSA、自动分析、多窗口校准、跨窗口共识和整段全局相关性诊断；
仍不是音频/分段对齐或 1.0 完整验收版本。1.0 路线见 [ROADMAP.md](ROADMAP.md)。
