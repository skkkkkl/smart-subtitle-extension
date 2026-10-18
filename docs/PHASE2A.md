# Phase 2A 交付与测试报告

- 日期：2026-10-18
- 版本：`0.2.0`
- 范围：设置持久化、字幕外观、选项页、数据清理
- 后续：`0.2.1` 的轮廓优化见 [PHASE2A1.md](PHASE2A1.md)
- 环境：Windows 11 专业版 10.0.26300；Node.js 24.21.0；Chrome 155.0.8059.80

## 1. 本次新增

| 能力 | 文件 |
|---|---|
| 设置默认值、校验、CSS/预览生成 | `storage/settings-model.js` |
| `chrome.storage.local` 适配与内存回退 | `storage/settings-store.js` |
| `::cue` 样式注入与清理 | `content/cue-style-controller.js` |
| 面板外观区 | `content/panel-view.js` |
| 设置协调、位置重渲染、外部同步 | `content/app.js` |
| CSS 注入与打开选项页消息 | `background/service-worker.js` |
| 选项页 | `options/options.html`, `options.css`, `options.js` |
| 设置测试 | `tests/settings-model.test.js`, `tests/settings-store.test.js` |
| 版本/权限 | `manifest.json` → `0.2.0`，新增 `storage` |

## 2. 设计要点

### 设置模型

- 纯模块，无 Chrome/DOM 依赖。
- 所有输入都经过 `sanitizeAppearance` / `sanitizeSettings`：
  - 字号 14–48；
  - 描边宽度 0–6；
  - 背景不透明度 0–0.95；
  - 纵向位置 60–96；
  - 颜色归一化为 6 位小写十六进制。
- 生成 `::cue` CSS 时再次 sanitize，避免把未校验值拼入样式。

### 存储

- 键：`smartSubtitle.settings.v1`。
- 读取失败、值不合法 → 默认值或裁剪值。
- 清除：只删除 `smartSubtitle.*`。
- `chrome.storage.onChanged` 订阅：面板和选项页共享设置。
- 没有扩展环境时退回内存区，使 options/panel 的 DOM 烟测可运行。

### 样式注入

首选项：

1. content 发送 `SMART_SUBTITLE_CUE_CSS` 给 Service Worker；
2. SW 用 `chrome.scripting.removeCSS` 删除旧样式；
3. 用 `chrome.scripting.insertCSS(..., origin: 'USER')` 注入新样式；
4. content 只在当前本地字幕的 `<video>` 上设置
   `data-smart-subtitle-cue="true"`，避免影响站点原生字幕。

回退：没有 `chrome.runtime` 或注入失败时，在页面中创建
`#smart-subtitle-cue-style` 的 `<style>`。

### 纵向位置

- 外观位置作为 `line:xx%` 写入生成的 WebVTT cue。
- 已有 `line:` 的 VTT cue 不覆盖，尊重字幕作者设置。
- 位置改变时重新生成轨道；字号/颜色等只更新 CSS，不重建轨道。

### 数据清理

- 选项页「清除本地数据」调用 `SettingsStore.clearAll()`。
- 当前没有字幕缓存；只清除 `smartSubtitle.*` 设置键。
- 面板通过存储订阅恢复默认外观。

## 3. 自动测试

命令：

```powershell
npm test
```

结果：

```text
tests 54
pass 54
fail 0
duration_ms 322.947
```

新增覆盖：

- 默认设置结构；
- 数字裁剪、颜色归一化、NaN 回退；
- `::cue` CSS 内容、背景 rgba、描边；
- `line` 设置的添加/保留；
- 设置保存、重置、清除、订阅；
- 内存回退；
- Service Worker 的 CSS 删除/插入参数；
- 空 CSS 只删除不插入；
- 超过 20,000 字符的 CSS 拒绝；
- 打开选项页消息；
- manifest 新增 `storage` 但仍无 `host_permissions` / `<all_urls>`。

### 测试中发现并修复的问题

1. **`SettingsStore` 浏览器导出形状错误**
   - UMD 导出的是包含 `SettingsStore` 的模块对象，而 options 页把它当构造函数。
   - 现象：选项页一直停在“正在读取设置…”，无预览更新。
   - 修复：`NS.storage.SettingsStore.SettingsStore`。
   - 复测：选项页加载、预览、保存、清除全部通过。

2. **Node 测试中 UMD factory 引用了不存在的 `root`**
   - 现象：`ReferenceError: root is not defined`。
   - 修复：factory 内使用独立的 `host = globalThis`。
   - 复测：storage 测试全部通过。

## 4. 浏览器 DOM/交互烟测

方法：headless Chrome 155 + CDP，加载生产模块 / 选项页。

### 选项页

通过 `http://127.0.0.1:8790/options/options.html` 打开（非扩展页，因此 storage 使用
内存回退）：

| 场景 | 结果 |
|---|---|
| 页面加载、默认字号 24、预览存在 | 通过 |
| 字号 32、文字色、描边色/宽度、背景色/透明度、位置 72% | 通过 |
| 预览 CSS 同步为 `32px` / `rgba(17, 34, 51, 0.4)` / `top:72%` | 通过 |
| 提交保存 → 状态“已保存到临时内存” | 通过 |
| 恢复默认值 → 字号 24、位置 90% | 通过 |
| 清除数据 → “已清除 1 项本地数据” | 通过 |

截图：[phase2-options.png](screenshots/phase2-options.png)

### 面板与样式

| 场景 | 结果 |
|---|---|
| 面板外观区默认值 | 通过 |
| SRT 5 条加载、轨道 `showing` | 通过 |
| 当前 `<video>` 获得 `data-smart-subtitle-cue="true"` | 通过 |
| 回退 `<style>` 生成 `::cue` CSS，包含 24px / 背景 / 描边 | 通过 |
| 生成的 VTT 包含 `line:90%` | 通过 |
| 字号改为 32 → CSS 与面板预览同步 | 通过 |
| 位置改为 80 → 重新生成 VTT，内容包含 `line:80%` | 通过 |
| 恢复默认 → 24 / 90% | 通过 |
| 移除字幕 → 标记与样式节点清理 | 通过 |

截图：[phase2-panel.png](screenshots/phase2-panel.png)

### 媒体 cue

使用生成的 WebM（MediaRecorder）播放到约 1.2 秒：

```json
{
  "currentTime": 1.010772,
  "mode": "showing",
  "activeCues": [
    "欢迎使用本地字幕助手。\n所有字幕文件都只在本地处理。"
  ]
}
```

`activeCues` 证明 cue 在媒体时间轴激活。headless 截图中视频帧为黑屏，因此
**没有**把 `::cue` 的像素级视觉效果标记为已验证。

## 5. 未验证项（不计为通过）

1. 真实工具栏点击 + `activeTab` 注入链路（Chrome 155 移除命令行加载）。
2. 真实 `chrome.storage.local` 持久化；选项页烟测使用内存回退。
3. 真实 Service Worker `insertCSS` 的 USER origin 注入；烟测使用 `<style>` 回退。
4. `::cue` 在真实视频帧上的最终视觉（字号、背景、描边、位置）。
5. 多标签页设置同步。
6. Firefox / Edge / Android / macOS。
7. YouTube / Netflix / Bilibili 等站点。

## 6. 失败项

- 自动单元测试：无。
- Phase 2A DOM 烟测：无。
- 真实扩展安装/点击 E2E：未执行，标为未验证，不冒充通过。

## 7. 限制

- 原生 `::cue` 只支持 CSS 子集；不能替代 ASS 渲染器。
- 不提供字体族、任意二维定位、旋转、动画。
- VTT 自带 `line` 时位置滑块不覆盖。
- 视觉结果受浏览器版本和站点样式影响。
- 没有 IndexedDB 字幕缓存。
- 没有在线搜索、自动校准。

## 8. 下一阶段

1. Phase 2B：元数据提取、Provider 接口、候选评分、IndexedDB 缓存。
2. 无合法来源时不显示伪造搜索结果。
3. 真实 Chrome 手动验收并记录站点矩阵。
4. 第三阶段评估 libass WASM。
5. 第四阶段自动校准。
