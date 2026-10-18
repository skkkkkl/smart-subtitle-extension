# v0.2.1 字幕轮廓优化报告

- 日期：2026-10-18
- 版本：`0.2.1`
- 触发问题：实际试用时字幕轮廓“非常粗糙”
- 范围：仅优化原生字幕轮廓算法与描边精度，不改字幕解析、偏移和视频生命周期

## 1. 原因

旧实现只有 4 个对角方向的 `text-shadow`：

```css
text-shadow:
  -2px -2px 0 #000,
   2px -2px 0 #000,
  -2px  2px 0 #000,
   2px  2px 0 #000;
```

问题：

1. **12 / 3 / 6 / 9 点方向没有覆盖**，横竖边缘会出现缺口。
2. 大字号或宽描边时，缺口更明显，视觉上像锯齿。
3. 描边宽度只能整数递增，无法在 1–2px 之间微调。
4. `::cue` 支持的属性有限，不能依赖 `-webkit-text-stroke`；
   `outline` 也只作用于 cue 盒子，不是逐字轮廓。

## 2. 新算法

`storage/settings-model.js` 的 `buildTextShadow`：

- 以描边宽度为半径，沿圆周采样：
  - 2px 及以下：24 个方向；
  - 4px 及以上：32 个方向。
- 每个采样点生成一个 `text-shadow`，颜色为描边色。
- 加 0.12–0.4px 的极小模糊，抹平多边形采样接缝。
- 所有值仍经过 `sanitizeAppearance` 校验，颜色/宽度不会把 CSS 注入。
- 支持 0.5px 描边步进，例如 `1.5px`、`2.5px`。

输出示例（2px）：

```css
text-shadow:
  2px 0px 0.24px #001122,
  1.93px 0.52px 0.24px #001122,
  1.73px 1px 0.24px #001122,
  ...
  2px 0px 0.24px #001122;
```

实际共有 24 项，不是 4 项。

## 3. 前后对比

静态对比图（使用同样的 CSS，普通 HTML 文本渲染，便于看清边缘）：

![轮廓对比](screenshots/outline-comparison.png)

- 左：旧版 4 向硬阴影；
- 右：新版 24/32 向环形阴影；
- 上：2px 描边；
- 下：4px 描边。

从对比图可见：

- 横竖方向的缺口消失；
- 宽描边的边缘更连续；
- 2px 新轮廓略厚于旧版四角轮廓，这是环形覆盖完整后的正常结果；
- 如果希望更细，可把描边宽度调到 1.5px 或 1px。

## 4. 验证结果

### 自动测试

```powershell
npm test
```

```text
tests 55
pass 55
fail 0
duration_ms 315.1086
```

新增覆盖：

- 2px 生成 24 个 shadow；
- 4px 生成 32 个 shadow；
- 0.5px 宽度可用；
- 0 宽度输出 `text-shadow: none`；
- 输出包含 0.12px 微模糊；
- 设置整体 sanitize 仍限制 0–6px。

### 浏览器 DOM 验证

- 选项页/面板预览使用同一个 `SettingsModel.buildTextShadow`；
- 面板实际生成 24 个 `text-shadow`（通过读取注入的 `<style>` 验证）；
- 重新生成截图：
  - `docs/screenshots/phase2-options.png`
  - `docs/screenshots/phase2-panel.png`
- 静态对比页使用 Chrome 155 渲染。

### 仍未验证

- `::cue` 在真实视频帧上的最终像素效果。headless Chrome 的视频层截图仍为黑帧，
  只能验证 CSS 内容和普通 HTML 文本渲染。
- 极宽描边（5–6px）在低分辨率视频/高 DPI 屏幕上的实际观感。
- 原生 `::cue` 是否对 32 个 shadow 有内部数量限制；CSS 本身被接受。

## 5. 性能

- 只在当前活动字幕上应用；不会对整页文本生效。
- 每条 cue 典型 1–2 行，24/32 个 `text-shadow` 的绘制量很小。
- 对 4K、超长多行字幕或低端设备，32 个 shadow 仍可能带来额外合成开销；
  后续可以按视频分辨率自动降到 16/24 个采样。
- 目前没有做帧率/GPU 基准测试，标记为未验证。

## 6. 已知限制

1. 仍是 `text-shadow` 环形近似，不是矢量描边（SVG/Canvas）。
2. 极宽描边仍可能有轻微多边形感；微模糊会带来轻微柔化。
3. `-webkit-text-stroke` 不在 WebVTT `::cue` 的允许属性列表中，未依赖它。
4. 站点自己的 `::cue` 样式可能覆盖或叠加。
5. 未在真实站点做视觉回归。

## 7. 下一步

- 若你仍觉得轮廓偏厚，建议在面板把宽度调到 1–1.5px。
- 若需要真正的逐字矢量描边，下一阶段可评估独立的 Canvas/SVG 字幕渲染层，
  但会牺牲一部分原生 TextTrack 的全屏/兼容性，需单独验证。
- Phase 2B 仍为：元数据提取、Provider 接口、候选评分、IndexedDB 缓存。
