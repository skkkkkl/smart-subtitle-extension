# v0.9.9 相关峰/时间映射诊断验收报告

- 日期：2026-10-18
- 版本：`0.9.9`
- 输入日志：W2 +6750ms、W4 −5750ms，只有 2/5 有效窗口
- 结论：**拒绝正确；先确认第二独立峰和时间映射，不降阈值、不求平均**

## 1. 对这次日志的判断

- 5 个窗口里 3 个 `LOW_CORRELATION`；
- W2/W4 的 margin 只有 0.040/0.033，刚刚超过 0.03 的峰值质量门槛；
- 两个有效窗口偏移相差 12.5 秒；
- 不能计算 MAD，`n/a` 是正确的；
- 不能把 +6750 和 −5750 平均成 +500ms。

## 2. 新增诊断字段

每个窗口现在输出：

- `windowStartMediaMs` / `windowEndMediaMs`；
- `audioSampleStartMs` / `audioSampleEndMs`；
- `bestPeakOffsetMs` / `bestPeakScore`；
- `secondDistinctPeakOffsetMs` / `secondDistinctPeakScore`；
- `distinctMargin`；
- `searchBoundaryHit`；
- `mediaTimeDiscontinuity`；
- `rejectReason`；
- 最多 8 个候选峰。

关键变化：`secondDistinctPeakOffsetMs` 会跳过最佳峰附近 1 秒内的相邻搜索点，取真正的第二个独立峰。这样能判断：

- 最佳峰和次佳峰是同一座宽峰，还是两个不同偏移；
- 是否在一个错误峰和另一个错误峰之间摇摆；
- 搜索边界是否造成假峰。

## 3. 时间映射

- 每个窗口记录实际音频帧的首末媒体时间；
- App 仍做 40 秒会话结束后的 `currentTime`/playbackRate 校验；
- 暂停、拖动、倍速变化会丢弃本次会话；
- `mediaTimeDiscontinuity` 用于标记窗口内时间不连续。

## 4. 自动测试

```text
tests 118
pass 118
fail 0
duration_ms 623.2688
```

新增：

- 独立第二峰选择：跳过相邻 250ms 搜索点，取 1000ms 外的峰；
- 多窗口诊断包含 `secondDistinctPeakOffsetMs`；
- 原有正/负偏移、MAD、5 窗口、拒绝路径回归。

## 5. 仍不做什么

- 不把最少有效窗口数从 3 改成 2；
- 不降低相关性阈值；
- 不降低 peak margin；
- 不扩大搜索范围后直接采用边界峰；
- 不平均两个方向相反的结果。

## 6. 下一步

更新后重跑，重点看：

1. W2/W4 的 `secondDistinctPeakOffsetMs` 与最佳峰相差多远；
2. `audioSampleStartMs` 是否与窗口媒体时间一致；
3. 是否出现 `mediaTimeDiscontinuity` 或 `searchBoundaryHit`；
4. 3 个 `LOW_CORRELATION` 窗口的候选峰是否也分散。

如果第二独立峰很远，优先修候选峰搜索；
如果音频时间与媒体时间不一致，优先修时间映射；
如果两者都正常但相关性持续低，再考虑文本级 ASR。

## 7. 交付

- 版本包：`smart-subtitle-extension-v0.9.9.zip`
- 完整功能：[FINAL.md](FINAL.md)
- 版本历史：[CHANGELOG.md](CHANGELOG.md)
