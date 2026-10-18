# Phase 1 交付与测试报告

- 日期：2026-10-18
- 版本：`0.1.0`
- 范围：Manifest V3 基础工程、SRT/VTT 本地加载与显示、整体偏移、多视频与动态页面
- 环境：Windows 11 专业版 10.0.26300；Node.js 24.21.0；npm 11.19.0；Chrome 155.0.8059.80

## 1. 交付内容

| 能力 | 文件 | 状态 |
|---|---|---|
| 扩展清单 | `manifest.json` | 完成 |
| 按需注入 / 图标点击 | `background/service-worker.js` | 完成；真实点击链路未自动化验证 |
| 共享命名空间 | `shared/namespace.js` | 完成 |
| 错误类型 | `subtitles/subtitle-error.js` | 完成 |
| 时间戳 | `subtitles/timing.js` | 完成 |
| 编码 | `subtitles/file-decoder.js` | 完成 |
| SRT | `subtitles/srt-parser.js` | 完成 |
| VTT | `subtitles/vtt-parser.js` | 完成 |
| 格式中立文档 | `subtitles/subtitle-document.js` | 完成 |
| 整体偏移 | `alignment/offset-model.js` | 完成 |
| 视频检测 | `content/video-detector.js` | 完成 |
| 轨道生命周期 | `content/track-controller.js` | 完成 |
| 悬浮 UI | `content/panel-view.js` | 完成 |
| 状态协调 | `content/app.js` | 完成 |
| 单元测试 | `tests/*.test.js` | 38/38 通过 |
| 演示页 | `demo/` | 完成 |
| 面板截图 | `docs/screenshots/phase1-panel.png` | 已生成 |

## 2. 自动单元测试

命令：

```powershell
npm test
```

实际输出摘要：

```text
tests 38
pass 38
fail 0
duration_ms 253.0447
```

覆盖模块与断言数（按测试文件）：

| 文件 | 覆盖点 |
|---|---|
| `timing.test.js` | SRT/VTT 时间戳、分钟/秒越界、毫秒位数、格式化、超过 99 小时 |
| `srt-parser.test.js` | BOM/CRLF、可选序号、多行对白、逗号/点毫秒、非法时间、反向时间、缺空行恢复、尾部坐标警告 |
| `vtt-parser.test.js` | 头部、cue id、settings、短时间格式、NOTE、STYLE、序列化、缺少头部、恶意/畸形块 |
| `file-decoder.test.js` | UTF-8 BOM、UTF-16LE/BE BOM、GB18030 回退、空文件、NUL |
| `offset-model.test.js` | 正/负偏移、零点裁剪、丢弃统计、不可变输入、非法/越界偏移 |
| `subtitle-document.test.js` | 扩展名路由、内容嗅探、ASS 拒绝、VTT 生成、全部丢弃错误 |
| `service-worker.test.js` | 最小权限、注入顺序、二次点击切换、受限页面、消息失败、所有注入文件存在 |

### 测试中修复的问题

第一轮浏览器烟测暴露并修复了两个真实缺陷：

1. **浏览器命名空间解构错误**
   - `NS.subtitles.SubtitleError` 在浏览器里是模块导出对象，不是类本身。
   - 影响：`new SubtitleError(...)` / `getErrorMessage(...)` 在错误路径会抛
     `TypeError`，导致错误提示反而把原始错误覆盖掉。
   - 修复：`app.js` 使用 `ErrorApi.SubtitleError`；`track-controller.js` 使用
     `NS.subtitles.SubtitleError.SubtitleError`。
   - 复测：非法时间戳现在正确显示“SRT 时间戳格式无效…”，并带错误代码与行号。

2. **`isActive` 属性名不一致**
   - 轨道对象保存为 `{ element, ... }`，getter 读取 `active.el`。
   - 影响：拖动偏移后切换显示开关会抛 `TypeError`，状态文字不更新。
   - 修复：getter 读取 `active.element.isConnected`。
   - 复测：`showing ↔ disabled` 与状态文字均通过。

## 3. 浏览器 DOM/交互烟测

### 方法

使用 headless Chrome 155 + Chrome DevTools Protocol，将项目中的生产 content
模块按 Service Worker 的相同顺序注入到本地演示页，再用真实 `File`、`DataTransfer`、
Shadow DOM 按钮和 `<track>` 事件驱动生产代码。

说明：Chrome 155 官方版已经移除了 `--load-extension` 命令行加载能力，因此本环境没有
通过命令行把未打包扩展装进无头浏览器。该烟测验证的是 content 层生产文件与完整 UI
交互；Service Worker 的注入分支使用 Node `vm` + Chrome API mock 单独测试。真实工具栏
点击和 `activeTab` 授权仍需按 README 手动验收。

### 通过的断言

| 场景 | 结果 |
|---|---|
| 面板单例、Shadow DOM 挂载 | 通过 |
| 初始检测到 1 个 `<video>` | 通过 |
| 通过隐藏 file input 选择 `sample.zh.srt` | 通过 |
| 5 条 SRT cue 解析 | 通过 |
| 轨道 `mode === "showing"`，cue 文本与时间正确 | 通过 |
| 状态显示“字幕已显示 · 原始时间轴 · 5 条” | 通过 |
| `+100 ms` 后第一条 cue `0.5s → 0.6s` | 通过 |
| 偏移更新后轨道元素始终为 1 个 | 通过 |
| 旧 Blob URL 在替换时被回收 | 通过 |
| 撤销恢复 `0 ms` / `0.5s` | 通过 |
| 归零 | 通过 |
| 关闭显示：`mode = disabled`，状态含“关闭” | 通过 |
| 重新打开：`mode = showing` | 通过 |
| 动态添加第二个 `<video>` | 通过 |
| 选择第二视频后轨道移动到第二视频 | 通过 |
| 删除选中的第二视频后自动回退并重新挂载 | 通过 |
| `sample.zh.vtt` 解析 4 条 cue | 通过 |
| 非法 SRT 显示错误，旧轨道仍保留 | 通过 |
| 移除字幕后轨道数为 0 | 通过 |
| Blob URL：6 创建 / 6 回收 | 通过 |
| 网页原生 TextTrack：`showing → disabled → showing` | 通过 |
| 面板折叠：宽度 360 → 264，body 隐藏，`aria-expanded=false` | 通过 |
| 拖动标题栏：left/top 按指针位移更新 | 通过 |
| 关闭按钮隐藏；`togglePanel()` 恢复 | 通过 |
| 420×700 窄视口：面板被夹在视口内，无溢出 | 通过 |

### 媒体活动 cue 验证

另外用 `canvas.captureStream()` 给 `<video>` 提供活动媒体，播放到 1.2 秒时：

```json
{
  "currentTime": 1.205261,
  "mode": "showing",
  "activeCues": [
    "欢迎使用本地字幕助手。\n所有字幕文件都只在本地处理。"
  ]
}
```

这验证了 cue 在媒体时间轴上确实被激活。headless 截图中 MediaStream 视频区域为黑帧，
因此**没有**把“像素级字幕可见”标记为已验证；真实可见性按手动清单验证。

### 未通过的测试

- 自动单元测试：无。
- DOM 交互烟测：无。
- 真实扩展安装/工具栏点击的端到端自动化：未执行，标记为未验证，不算通过。

## 4. 手动验收步骤

见 README 的「手动安装验收清单」。重点：

1. 在 `chrome://extensions/` 加载目录。
2. 用 `demo/server.js` 打开演示页并选择本地视频。
3. 点击图标，加载 `demo/sample.zh.srt`。
4. 播放视频，确认字幕显示和偏移生效。
5. 检查多视频、切换、移除、错误提示。

## 5. 失败处理与误差边界

- 非法时间戳：抛出带 `INVALID_TIMESTAMP` 和行号的 `SubtitleError`；旧字幕不被替换。
- 结束时间早于开始：`SRT_END_BEFORE_START` / `VTT_END_BEFORE_START`。
- 没有 cue：`SRT_NO_CUES` / `VTT_NO_CUES`。
- ASS/SSA：`ASS_NOT_SUPPORTED`，明确提示第三阶段，不降级。
- 文件 > 8 MB：`FILE_TOO_LARGE`。
- 偏移非整数/越界：`INVALID_OFFSET` / `OFFSET_OUT_OF_RANGE`。
- 偏移导致全部 cue 消失：`OFFSET_DROPS_ALL`，不生成空轨道。
- 轨道加载失败/超时：`TRACK_LOAD_FAILED` / `TRACK_LOAD_TIMEOUT`，旧轨道保留。
- 新轨道加载成功前旧轨道不删除；旧轨道的 Blob URL 在换轨后回收。
- 负偏移裁剪跨零 cue；结束时间 `<= 0` 的 cue 被移除并计数。
- 轨道加载超时 10 秒。
- 文件大小上限 8 MB。
- 偏移允许范围 ±1 小时。

## 6. 已知限制（第一阶段）

1. 只检测顶层文档的 `video`；iframe 不支持。
2. 只支持原生 HTML5 `<video>`；Shadow DOM、Canvas、DRM、自定义播放器未验证。
3. 原生 `<video>.requestFullscreen()` 时面板不可见；容器全屏做了重挂载。
4. ASS/SSA、在线搜索、自动校准、样式设置、持久化均未实现。
5. 站点删除/重建 `<track>` 后没有自动巡检重挂载。
6. VTT 只实现常用子集；NOTE 不保留，STYLE/REGION 尽力保留。
7. SRT 时间轴尾部的旧式坐标被忽略并警告。
8. 不保证所有字幕编码；非 UTF-8 先尝试 GB18030。
9. 未在 YouTube/Netflix/Bilibili 等真实站点矩阵验证，不能声称“全站兼容”。

## 7. 下一阶段

### 第二阶段

- 设置存储（`chrome.storage.local`）与 IndexedDB 字幕缓存。
- 选项页与清除数据。
- 影片元数据提取、字幕 Provider 接口、候选评分和置信度。
- 面板字体/颜色/描边/背景/位置设置（可能需要自定义渲染层）。
- 偏移按影片 + 字幕指纹 + 版本保存，避免跨版本误用。

### 第三阶段

- 评估并集成 libass WASM 或经过验证的渲染方案。
- 检查许可证、维护状态、CSP、离线能力和体积。
- 记录 ASS 标签/特效兼容性边界。

### 第四阶段

- 整体偏移估计接口、分段对齐接口、置信度与回退。
- 本地音频捕获可行性验证；不假设任意网页音频可读。
- 模型资源评估。

### 第五阶段

- 桌面 Chrome 稳定后再评估 Android/Firefox Android。
- 核心解析、匹配、校准保持纯 JS/TS。
