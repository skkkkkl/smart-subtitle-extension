# Smart Subtitle · 本地字幕助手

面向 Chrome 的本地优先字幕扩展。在网页 HTML5 视频上加载 SRT、VTT、ASS/SSA 字幕，实时调整时间轴和外观；字幕与媒体文件默认不离开本机。

> 状态：`0.14.0`。桌面版支持 Chrome/Edge；Firefox Android 版使用独立构建。音频自动对齐仍为实验能力；推荐使用「首句对齐」或「台词锚点」完成可靠校准。

## 功能

- **多格式字幕**：SRT、WebVTT、ASS/SSA。
- **时间轴**：增减偏移、撤销、归零；正数表示字幕延后。
- **字幕外观**：字号、字重、颜色、描边、阴影、背景、纵向位置；面板分为字幕 / 同步 / 外观 / 搜索四个页面，字号提升为独立大控件。
- **ASS/SSA 覆盖层**：常用样式、9 宫格、`\pos`、颜色、描边、阴影；可在外观面板选择覆盖 ASS 样式。
- **避免双字幕**：ASS 覆盖层启用时静音网页自带 TextTrack；自绘 DOM 字幕可点「隐藏站内字幕」后直接点选多余的层。
- **字号下限**：外观字号范围 10–48px；ASS 覆盖使用屏幕相对字号，不再被 ASS 原始大字号放大。
- **本地匹配**：根据片名、年份、时长、语言、集数对本地字幕评分。
- **字幕库**：扩展源 IndexedDB，本地缓存最近使用字幕。
- **在线来源**：可选启用 OpenSubtitles；API Key 只保存于本地。
- **多视频**：自动发现 HTML5 `<video>`，支持 SPA 动态切换。
- **时间轴分析**：首尾锚点建议 + 音频多窗口诊断（实验）。
- **台词锚点**：输入听到的台词片段，按当前视频时间计算目标偏移；不依赖音频采集。
- **首句对齐**：用首条字幕作为锚点；自动检测片头首段声音，或手动标记首句，无需理解台词内容。

## 安装

1. 下载或克隆本仓库。
2. 打开 `chrome://extensions/`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本目录（`manifest.json` 所在目录）。
4. 打开网页并播放 HTML5 视频，点击扩展图标或按 `Alt + Shift + S`。

首次点击通过 `activeTab` 授予当前页访问权限；刷新页面后需要重新点击。

## 使用

1. 在面板中选择目标视频。
2. 点击「选择 SRT / VTT / ASS 字幕」。
3. 用偏移按钮或输入框调整时间轴；可在「字幕外观」中调整样式。
4. 需要本地候选时，打开「字幕匹配」，选择多个字幕文件进行评分。
5. 需要在线字幕时，在设置页配置 OpenSubtitles API Key 并显式启用。
6. 音频自动校准不稳定时，用「台词锚点」：暂停在目标台词，输入其中几个字，选中后按当前时间对齐。
7. 也可用「首句对齐」：从片头播放，自动检测第一段持续声音，或手动标记首句。

完整操作说明见 [docs/USAGE.md](docs/USAGE.md)。

## Firefox Android

Firefox Android 版是独立构建，使用 Manifest V2：

```bash
npm run build:firefox
# 输出：dist/firefox/
```

### 在手机上安装（不需要自己搞签名）

Android 版 Firefox **没有**桌面版那种「关闭签名校验」的开关：`xpinstall.signatures.required` 在正式版 Android 上无效，`about:config` 里也改不动，所以未签名的 XPI 无法装到手机上。唯一可行的路线是让 Mozilla 帮你签一次名，全程不用购买证书：

1. 打包：
   ```bash
   npm run release:firefox
   # 输出：dist/smart-subtitle-firefox-mobile-0.14.0.zip
   ```
2. 登录 [addons.mozilla.org Developer Hub](https://addons.mozilla.org/developers/) → Submit a New Add-on → **选择「On your own」（unlisted）**。unlisted 不会出现在商店搜索结果里，只用于自己安装，仍需 Mozilla 的人工/自动审核（通常几分钟到一天）。
3. 选 `dist/firefox/` 或上一步的 ZIP，提交后回到「My Add-ons」，在该版本上点 **Download file**，得到已签名的 `.xpi`。
4. 把 `.xpi` 传到手机（数据线 / 网盘 / `adb push`），在文件管理器里点击它，选择用 Firefox 打开即可安装。安装后可在 `about:addons` 中检查。
5. 以后每次发版：把 `version` 加一，重复步骤 1–4，走同一个 add-on 的「Upload New Version」，覆盖安装不会丢设置。

插件 ID 固定为 `smart-subtitle-mobile@skkkkkl.github.io`（见 `firefox/manifest.json`），请始终用同一个 ID 提交，否则会被当成另一个插件，`storage` 里的设置和字幕缓存不会延续。

如果已经拿到 AMO API 凭据，也可以一行命令签名，省去网页操作：

```bash
WEB_EXT_API_KEY=user:xxxxx:yy WEB_EXT_API_SECRET=... npm run pack:firefox
# 输出的是已签名产物，直接拷到手机安装
```

常见替代方案与不能用的原因：

- **桌面 Firefox 关闭签名校验**：只对 Firefox Nightly / Developer Edition / ESR 的桌面版有效，且不能同步扩展到 Android；
- **Chrome / Edge Android**：官方不支持桌面式扩展；
- **Kiwi / Lemur 等 Chromium 分支**：可以直接装 `manifest.json`（Chrome 版）的「加载已解压」等价流程，但手机端拿不到标签页音频，详见下一节；
- **把扩展改成书签小工具（bookmarklet）或用户脚本**：能在手机浏览器里跑，但受页面 CSP、Shadow DOM 与文件选择限制，不是等价方案。

### Kiwi 等 Chromium 分支

Kiwi 是基于 Chromium 的 Android 浏览器，保留桌面扩展支持，可以加载本项目的 Chrome 构建：

1. 电脑上把仓库压缩成 ZIP（不要把 `node_modules/`、`dist/`、`.git/` 打进去，根目录必须直接是 `manifest.json`）；
2. 传到手机，解压到内部存储的任意目录；
3. Kiwi → 设置 → 扩展程序 → 打开「开发者模式」→「加载已解压的扩展程序」→ 选中该目录（部分版本提供「从文件安装」直接选 ZIP）。

`shared/capabilities.js` 会按运行时探测降级，手机 Chromium 上表现为：

- 自动音频校准、自动首句检测按钮隐藏（`tabCapture` + `offscreen` 在手机 Kiwi 上不可用，即使 `manifest.json` 里声明了）；
- 面板切换为触摸尺寸（更大的关闭/折叠按钮、更大的页签），启动时停靠在屏幕顶部；
- SRT / VTT / ASS 加载、偏移、外观、台词锚点、手动首句、字幕库、OpenSubtitles 都与桌面一致；
- 最低需要 `minimum_chrome_version: 109` 对应的 Chromium 内核；新版 Kiwi（Chromium 126+）可用。

Kiwi 版与 Firefox Android 版的差别：

| | Kiwi（Chrome 构建） | Firefox Android（`dist/firefox/`） |
| --- | --- | --- |
| 安装 | 解压加载，无需签名 | 必须 AMO 签名的 XPI |
| 音频自动校准 | 不可用 | 不可用 |
| 在线 OpenSubtitles | 可用（需在设置页授权域名） | 可用 |
| 更新 | 重新解压覆盖 | 覆盖安装 XPI，设置保留 |

Firefox Android 版：

- 支持 SRT/VTT/ASS、外观、偏移、文本锚点、手动首句；
- 不包含 `tabCapture`/`offscreen`，自动音频/首句检测按钮会隐藏；
- 最低 Firefox Android `142.0`；
- 不做全站权限申请，仅 `activeTab` + 可选 OpenSubtitles 域名。

## 自动时间轴（实验）

扩展提供两条路径：

- **首尾锚点分析**：根据首条字幕、末条字幕与视频时长给出建议；尾差超过 10 秒或首尾冲突时拒绝。
- **音频校准**：通过视频音轨或标签页音频采样，比较音频活动与字幕活动的时间关系。

音频路径仍处于实验阶段：

- 跨域、DRM、无音轨媒体可能无法采集；
- 音乐、音效、环境声会造成错误相关性；
- 多窗口结果不一致时会拒绝，不自动应用；
- 所有建议都需要手动确认。

不要把它当作所有站点都可用的自动同步功能。音频不可用或结果不稳定时，优先使用「台词锚点」或「首句对齐」；两者都不依赖字幕语言理解，适用于跨域、DRM 页面。

## 权限与隐私

安装权限：

- `activeTab`：点击扩展后访问当前标签页；
- `scripting`：注入字幕面板；
- `storage`：保存设置与字幕缓存；
- `tabCapture`：仅在用户点击标签页音频校准时捕获当前标签页声音；
- `offscreen`：在扩展页面中做本地音频采样。

可选权限：

- `https://*.opensubtitles.com/*`：只有用户在设置页显式启用在线搜索时才请求。

数据说明：

- 字幕、视频、音频默认不上传；
- 启用在线搜索后，只发送片名、年份、语言、季/集等查询信息；
- OpenSubtitles API Key 只保存在 `chrome.storage.local`；
- 标签页音频仅在用户主动点击时捕获，采样后停止；
- 清除本地数据会删除设置、字幕缓存和 API Key。

## 已知限制

- ASS/SSA 是常用子集渲染，不支持 `\move`、`\t`、卡拉 OK、矢量绘图、复杂旋转/裁剪。
- 自动时间轴仍为实验能力，不保证所有站点、所有片源可用。
- iframe、Shadow DOM 内视频、Canvas/DRM 播放器不支持。
- 播放器容器全屏时 ASS 字幕会跟随；若站点直接让 `<video>` 元素全屏，覆盖层可能无法显示。
- 原生全屏时面板可能被排除在全屏层外。
- OpenSubtitles 返回 ZIP 时不会自动解压。
- 在线搜索需要用户自己的 API Key 和账号配额。
- 桌面 Chrome/Edge 与 Firefox Android 为受支持目标；Kiwi 等 Chromium 分支可加载 Chrome 构建，但手机上没有标签页音频自动校准。

## 开发

要求 Node.js 20+。

```bash
npm test
npm run demo
```

- 测试：`node --test`，当前 **134** 项。
- Firefox 构建：`npm run build:firefox`，`web-ext lint` 0 errors / 0 warnings。
- 演示站：`http://localhost:8787/demo/`（`npm run demo` 后打开）。

## 目录

```text
.
├── manifest.json
├── background/          # Service Worker
├── content/             # 面板、视频探测、轨道、ASS 覆盖层、音频采样
├── subtitles/           # SRT/VTT/ASS 解析与文档模型
├── alignment/           # 偏移、文本锚点、首句检测、音频特征、多窗口校准
├── matching/            # 元数据、候选评分、OpenSubtitles Provider
├── storage/             # 设置、字幕缓存、Provider 配置
├── options/             # 设置页
├── offscreen/           # 标签页音频采样
├── tests/               # node:test 单元测试
├── demo/                # 本地演示页
├── firefox/             # Firefox Android Manifest/背景页
├── scripts/             # 构建脚本
└── docs/                # 使用说明
```

## 许可

本仓库未附带开源许可证。未经作者许可，请勿再分发或商用。
