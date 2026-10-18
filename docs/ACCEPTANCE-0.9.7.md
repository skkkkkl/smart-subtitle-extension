# v0.9.7 逐窗口诊断验收报告

- 日期：2026-10-18
- 版本：`0.9.7`
- 触发问题：多窗口校准被拒绝，MAD 约 4375ms
- 结论：**不调整 MAD 阈值；先输出逐窗口证据，定位错误来源**

## 1. 当前判断

MAD 4375ms 只说明：

- 5 个窗口的偏移估计没有通过一致性检查；
- 系统拒绝自动应用是正确行为；
- 不能直接据此认定字幕版本不匹配。

可能原因：

1. 音频相关性峰值误判；
2. 音频/媒体时间映射错误；
3. 字幕与影片局部剪辑差异；
4. 字幕时间轴漂移/跳变，而非固定偏移。

## 2. 本次实现

### 多窗口诊断

`AudioSession` 现在为每个窗口保留：

- 窗口编号；
- 媒体开始/结束时间；
- 窗口偏移估计；
- 相关性分数；
- 第二候选分数（由 margin 推导）；
- 峰分差 margin；
- 音频活动比例；
- 字幕活动比例；
- 有效/总窗口数；
- MAD；
- 拒绝原因。

### 面板

- 「校准诊断」折叠面板；
- 可复制文本；
- 失败时不强制应用、不降低阈值。

示例格式：

```text
code=INCONSISTENT_WINDOWS
MAD=4375ms
validWindows=5/5
Window 1: media=120s offset=1200ms score=0.82 margin=0.31 active=45% cue=38%
...
Rejected Window 3: LOW_CORRELATION ...
```

## 3. 自动测试

```text
tests 116
pass 116
fail 0
duration_ms 653.9462
```

新增断言：

- 多窗口结果包含 `diagnostics.windows`；
- 每个窗口有 `margin`、`activeRatio`、`cueActivityRatio`；
- 失败结果仍保留窗口/拒绝列表。

## 4. 不做什么

- 不降低 MAD 500ms 阈值；
- 不强行平均 5 个窗口；
- 不把 MAD 当成最终偏移；
- 不自动应用不一致结果。

## 5. 需要你提供的数据

更新后重新做一次标签页多窗口校准，展开「校准诊断」并点「复制诊断」，把以下内容发我：

- 5 个窗口的 media time / offset / score / margin；
- active/cue 比例；
- 拒绝原因；
- MAD。

有了这组数据，才能判断下一步该修：

- 候选峰搜索；
- 多窗口聚合；
- 音频时间映射；
- 还是引入文本级 ASR。

## 6. 交付

- 版本包：`smart-subtitle-extension-v0.9.7.zip`
- 完整功能：[FINAL.md](FINAL.md)
- 版本历史：[CHANGELOG.md](CHANGELOG.md)
