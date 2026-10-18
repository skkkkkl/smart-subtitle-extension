# v0.9.11 全局 40 秒相关性诊断验收报告

- 日期：2026-10-18
- 版本：`0.9.11`
- 输入日志：4 个有效窗口，MAD 7000ms，consensus support 2/5
- 结论：**拒绝正确；逐窗口与候选共识都不稳定；新增整段 40 秒相关性作为最后一项能量证据**

## 1. 这次日志的判断

四个窗口：

```text
W1: media=849s offset=+13250ms score=0.457 secondDistinct=-750
W2: media=857s offset=-9250ms  score=0.278 secondDistinct=+8500
W3: media=865s offset=+4750ms  score=0.364 secondDistinct=+10000
W5: media=881s offset=-7750ms  score=0.746 secondDistinct=-8750
```

- 时间映射：每个窗口的 audio 起止与媒体时间一致；
- 没有 discontinuity；
- 没有 boundary；
- 但偏移从 +13.25s 到 −9.25s，MAD 7000ms 计算正确；
- consensus 只有 2/5 支持，说明没有一个跨窗口稳定的候选；
- W5 的 `margin=0.037` 是相邻搜索点分差；`dmargin=0.334` 是第二独立峰分差，说明它有一个较强的局部峰，但只是一个窗口；
- 4 个有效窗口仍不能强行平均。

## 2. 新增：整段全局相关性

之前只做 5 个 8 秒窗口。现在额外把 **40 秒完整音频特征**与字幕活动做一次相关性：

- 输出 `global.offsetMs`；
- `global.score` / `margin`；
- `global.secondDistinctPeakOffsetMs`；
- 是否贴边；
- 候选峰。

它作为诊断显示，不自动应用。

如果整段 40 秒也没有清晰、唯一的峰，说明不是“窗口切分”或“MAD 阈值”问题，而是能量/字幕活动本身不足以定位。

## 3. 自动测试

```text
tests 119
pass 119
fail 0
duration_ms 692.9001
```

新增断言：多窗口诊断必须包含 `global` 结果。

## 4. 不做什么

- 不降低 MAD 7000ms 阈值；
- 不把 4 个窗口平均；
- 不采用 W5 的 −7750ms；
- 不把 consensus 2/5 当答案；
- 不自动应用。

## 5. 下一步判断

更新后重跑，看新的 `global=` 行：

1. 如果 global 有高分、唯一峰，且与某个候选簇一致：再设计人工确认的低置信度候选；
2. 如果 global 也出现多个相近峰：能量相关性已经到上限，转文本级 ASR；
3. 如果 global 的候选也分散：不是多窗口算法问题，停止继续加窗口。

## 6. 交付

- 版本包：`smart-subtitle-extension-v0.9.11.zip`
- 完整功能：[FINAL.md](FINAL.md)
- 版本历史：[CHANGELOG.md](CHANGELOG.md)
