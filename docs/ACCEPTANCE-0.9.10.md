# v0.9.10 跨窗口候选共识验收报告

- 日期：2026-10-18
- 版本：`0.9.10`
- 输入日志：只有 1/5 有效窗口；W4 offset −250ms，W2/5 的第二峰也接近 −250/500ms
- 结论：**1 个有效窗口仍必须拒绝；新增跨窗口候选共识作为诊断，不自动应用**

## 1. 这次日志说明了什么

W4：

```text
media=800s audio=800-808s
offset=-250ms
best=-250
secondDistinct=14000
score=0.253 second=0.192 margin=0.061
active=48% cue=66%
boundary=no discontinuity=no
```

- 时间映射看起来一致：窗口媒体 800s，音频采样 800–808s；
- W4 的最佳峰 −250ms，第二独立峰 14000ms，峰分差 0.061；
- 但最佳分只有 0.253，单窗口证据弱；
- 1 个有效窗口不能计算 MAD，必须拒绝。

另外 4 个窗口：

- W1：`LOW_CORRELATION`，secondDistinct −2500ms；
- W2：`LOW_CORRELATION`，secondDistinct −250ms；
- W3：`AMBIGUOUS_PEAK`，best 1250ms，secondDistinct −7000ms，margin 0.029；
- W5：`LOW_CORRELATION`，secondDistinct 500ms。

值得注意的是：W2 的 −250ms、W4 的 −250ms、W5 的 500ms 可能形成同一候选簇。但仅凭 secondDistinct 不足以确认，且这些窗口的最佳分都不高。

## 2. 本次新增：跨窗口候选共识

`alignment/audio-session.js` 新增 `candidateConsensus`：

- 收集每个窗口的候选峰（最多 8 个）；
- 将 ±1000ms 内的候选合并成簇；
- 按**支持窗口数**排序，而不是只看单窗口最高分；
- 输出：
  - `offsetMs`
  - `support` / `totalWindows`
  - `medianScore` / `maxScore`
  - `secondOffsetMs` / `secondSupport`
  - `marginSupport`

这是**诊断**，不改变 `NOT_ENOUGH_VALID_WINDOWS` 的拒绝逻辑。
即使候选共识支持 3 个窗口，也不会自动应用。

## 3. 诊断输出

```text
consensus=-250ms support=3/5 medianScore=0.31 second=5000
Window 4: media=800s audio=800-808s offset=-250ms best=-250 s2=14000 score=0.253 ...
Rejected Window 2: LOW_CORRELATION secondDistinct=-250ms ...
```

## 4. 自动测试

```text
tests 119
pass 119
fail 0
duration_ms 615.6951
```

新增：

- 跨窗口候选簇按支持窗口数排序；
- 同一窗口的多个近似候选只算一次支持；
- 第二个独立候选簇；
- 原有 118 项回归。

## 5. 仍不做什么

- 不把最少有效窗口数从 3 改成 1；
- 不降低相关性/峰值门槛；
- 不因为 consensus=−250ms 就自动应用；
- 不把 W2/W4/W5 的候选强行合并成确定偏移；
- 不引入 ASR（等这轮共识诊断结果）。

## 6. 下一步

更新后重跑，重点看新的 `consensus` 行：

1. `support` 是否达到 3/5 以上；
2. `secondSupport` 是否接近；
3. consensus 的 `medianScore` 是否明显高于其他簇；
4. W1/W2/W3/W5 的完整候选峰是否围绕同一偏移。

如果 support 只有 2/5，或 secondSupport 接近，继续拒绝；
如果 support ≥3 且候选簇稳定，再设计低置信度、人工确认的候选流程；
如果仍然分散，下一步应转向文本级 ASR，而不是继续加窗口。

## 7. 交付

- 版本包：`smart-subtitle-extension-v0.9.10.zip`
- 完整功能：[FINAL.md](FINAL.md)
- 版本历史：[CHANGELOG.md](CHANGELOG.md)
