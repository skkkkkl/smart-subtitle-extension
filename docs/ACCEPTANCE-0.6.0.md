# v0.6.0 ASS/SSA 验收报告

- 日期：2026-10-18
- 版本：`0.6.0`
- 范围：ASS/SSA 常用子集解析 + 覆盖层渲染
- 结论：**子集范围通过，不宣称完整 libass 兼容**

## 1. 验收结论

| 项目 | 结果 | 说明 |
|---|---|---|
| ASS/SSA 文件解析 | 通过 | Script Info、V4/V4+ Styles、Events、动态 Format |
| 对白内逗号 | 通过 | 根据 Text 字段位置合并剩余逗号 |
| 样式/字号/颜色/描边/阴影/边距 | 通过 | 解析并进入覆盖层 |
| 内联标签 | 通过 | `\an`、`\pos`、`\fs`、`\b`、`\i`、颜色、`\bord`、`\shad`、`\r` |
| 多行 | 通过 | `\N` 换行 |
| 覆盖层显示 | 通过 | 跟随视频 rect，9 宫格和 `\pos` |
| 偏移 | 通过 | `currentTime - offset`，偏移后无 cue 时隐藏 |
| 移除 | 通过 | 覆盖层 host 移除 |
| 启用/禁用 | 代码实现 | 本次烟测未单独截图验证 |
| 字幕库/在线下载的 ASS | 代码路径复用 | 未单独验收 |
| SRT/VTT 回归 | 通过 | 既有单元测试和原生 track 路径 |
| 真实扩展安装 | 未验收 | 本环境无法通过命令行加载官方 Chrome 扩展 |

## 2. 自动测试

```powershell
npm test
```

```text
tests 98
pass 98
fail 0
duration_ms 543.8327
```

新增测试：

- ASS 样式、PlayRes、Events、文本逗号；
- SSA V4 Styles / Marked 对白；
- ASS 时间戳、空事件；
- ASS 颜色 BGR/Alpha；
- 内联样式、对齐、`\pos`、`\r`；
- `SubtitleDocument` 路由 ASS/SSA、拒绝转 WebVTT；
- 内容嗅探 ASS。

## 3. 浏览器烟测

环境：headless Chrome 155 + CDP。

1. 注入最新 content 模块。
2. 加载 `sample.ass`（PlayRes 1280×720，1 条对白）。
3. 设置 `video.currentTime = 1.2`。
4. 断言：
   - `subtitleDoc.format === 'ass'`；
   - `assOverlay` 存在；
   - 覆盖层 `.cue` 数量为 1；
   - 文本为 `Hello ASS World\n第二行`；
   - 生成 3 个样式 span（普通/斜体/续行）；
   - 覆盖层 display 为 block。
5. `applyOffset(7000)` 后当前时间无活动 cue，覆盖层 cue 数为 0。
6. `removeSubtitle()` 后 `assOverlay` 为 null，宿主节点移除。

截图：[v06-ass.png](screenshots/v06-ass.png)

## 4. 未通过/未覆盖

- 完整 libass：`\move`、`\t`、卡拉 OK、矢量绘图、复杂旋转/裁剪。
- ASS 字体依赖：文件指定字体未安装时使用回退字体。
- 真实扩展安装后的 ASS 渲染、全屏、多视频切换未在安装版验收。
- ASS 从在线下载/字幕库恢复的端到端未单独验收。
- 覆盖层与站点自身 UI 的 z-index 冲突未做站点矩阵。
- 原生 `<video>` 全屏时覆盖层可能与面板一样被排除在全屏层外。

## 5. 风险与建议

- 当前实现是“常用子集”，不应在 UI/文档中宣称完整 ASS。
- 若后续需要字幕组复杂特效，评估 libass WASM，而不是继续堆自定义解析。
- 测试优先补充：ASS 多视频切换、全屏、下载后加载、缓存恢复、复杂标签降级。

## 6. 交付状态

- 最终文档：[FINAL.md](FINAL.md)
- 版本历史：[CHANGELOG.md](CHANGELOG.md)
- 测试：98/98
