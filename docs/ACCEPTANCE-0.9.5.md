# v0.9.5 发布候选验收报告

- 日期：2026-10-18
- 版本：`0.9.5`（1.0.0 候选）
- 范围：标签页音频捕获 + 真实扩展加载验证
- 结论：**RC 通过；不能作为“完美生产级自动同步”发布 1.0.0**

## 1. 本次新增

- `tabCapture` + `offscreen` 权限。
- `offscreen/offscreen.html` / `offscreen.js`：
  - 用 `getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',...}}})` 捕获标签页音频；
  - 8 秒 RMS 采样；
  - 采样后停止轨道、关闭 AudioContext；
  - 通过 `source.connect(destination)` 保持标签页可听。
- 面板「标签页音频 8s」：
  - 通过 Service Worker → offscreen 采样；
  - 返回样本给 content，由 `AudioAligner` 计算建议；
  - 必须手动确认。
- 权限：`activeTab`、`scripting`、`storage`、`tabCapture`、`offscreen`。

## 2. 真实扩展加载验收（Edge 155）

使用 `--load-extension` 在 Edge 155 加载未打包扩展：

- 扩展 Service Worker 正常启动；
- `SmartSubtitle.VERSION === 0.9.5`；
- `providerModule / providerStore / subtitleCache` 全部加载；
- `chrome.tabCapture` 和 `chrome.offscreen` 可用；
- manifest 权限为五项；
- `chrome.offscreen.createDocument` + `hasDocument` + `closeDocument` 成功；
- 选项页实际加载：
  - 标题“本地字幕助手 · 设置”；
  - 版本 v0.9.5；
  - 在线来源/缓存 UI 存在；
  - 状态“设置已加载”。

这验证了 Service Worker 模块加载、offscreen 生命周期和选项页真实路径。

## 3. 自动测试

```text
tests 110
pass 110
fail 0
duration_ms 579.4295
```

## 4. 未验收项（阻止 1.0.0）

- 真实网页标签页音频捕获：未在本环境用真实用户手势/媒体站点验证；
- 真实音频样本与字幕相关性准确率：未验证；
- 跨域流媒体、DRM、静音标签页；
- 音频捕获时是否短暂静音/回声（offscreen 已回接 destination，但未听感验收）；
- 真实站点矩阵、全屏、多视频；
- 音频算法在音乐/音效场景的误判率。

## 5. 为什么不能直接发 1.0.0

“完美生产级自动同步”依赖真实站点音频捕获和准确率数据。
目前只能证明：

- 扩展真实加载；
- 模块/选项页/offscreen 生命周期正常；
- 纯算法和 demo 失败路径正常。

不能证明所有流媒体站点可用，也不能保证不误判。
因此 `0.9.5` 是发布候选，不是 1.0.0。

## 6. 建议发布门槛

1. 在至少 3 个真实站点完成标签页音频捕获。
2. 用 10 个不同偏移/片尾场景验证建议准确率。
3. 验证 DRM/跨域失败时不会自动改偏移。
4. 完成全屏、多视频、真实站点回归。
5. 再打 1.0.0。

## 7. 交付

- 版本包：`smart-subtitle-extension-v0.9.5.zip`
- 完整功能：[FINAL.md](FINAL.md)
- 版本历史：[CHANGELOG.md](CHANGELOG.md)
