/*
 * Floating Shadow-DOM panel. This module owns presentation and input events
 * only; subtitle parsing, attachment and offset state live in app.js.
 */
(function (root) {
  'use strict';

  const NS = root.SmartSubtitle;
  const Timing = NS.subtitles.Timing;
  const OffsetModel = NS.alignment.OffsetModel;
  const SettingsModel = NS.storage.SettingsModel;

  const PANEL_WIDTH = 420;
  const COLLAPSED_WIDTH = 300;
  const EDGE_GAP = 12;

  const TEMPLATE = `
    <style>
      :host { color-scheme: dark; }
      *, *::before, *::after { box-sizing: border-box; }
      .panel {
        --bg: #11151b;
        --bg-soft: #171c24;
        --bg-raised: #202732;
        --line: rgba(255,255,255,.09);
        --line-strong: rgba(255,255,255,.16);
        --text: #f2f6f7;
        --muted: #93a1ad;
        --accent: #5eead4;
        --accent-strong: #2dd4bf;
        --accent-ink: #07221e;
        --danger: #ff8e86;
        --danger-bg: rgba(255, 91, 82, .11);
        --shadow: 0 24px 70px rgba(0,0,0,.48), 0 2px 10px rgba(0,0,0,.35);
        width: 100%;
        max-height: calc(100vh - 24px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--line-strong);
        border-radius: 18px;
        background:
          radial-gradient(130% 70% at 100% 0%, rgba(45,212,191,.10), transparent 52%),
          rgba(17,21,27,.975);
        box-shadow: var(--shadow);
        color: var(--text);
        font-family: "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
        font-size: 13px;
        line-height: 1.45;
        letter-spacing: .01em;
        -webkit-font-smoothing: antialiased;
        backdrop-filter: blur(18px) saturate(120%);
        animation: ss-panel-in .18s ease-out;
      }
      @keyframes ss-panel-in {
        from { opacity: 0; transform: translateY(-6px) scale(.985); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel { animation: none; }
      }
      .header {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 12px 11px 14px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,0));
        cursor: grab;
        touch-action: none;
        user-select: none;
      }
      .header:active { cursor: grabbing; }
      .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .logo {
        width: 32px; height: 32px;
        display: grid; place-items: center;
        border-radius: 10px;
        background: linear-gradient(145deg, #7ff7e3, #2dd4bf 58%, #0f9f8c);
        color: #05211c;
        font-size: 17px;
        font-weight: 800;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.45), 0 4px 16px rgba(45,212,191,.23);
      }
      .title-wrap { min-width: 0; }
      .title-wrap h1 {
        margin: 0;
        font-size: 14px;
        line-height: 1.25;
        font-weight: 700;
        letter-spacing: .02em;
      }
      .title-wrap p {
        margin: 1px 0 0;
        color: var(--muted);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: .18em;
      }
      .header-actions { display: flex; align-items: center; gap: 4px; }
      .icon-btn {
        width: 28px; height: 28px;
        display: grid; place-items: center;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: var(--muted);
        font-size: 17px;
        line-height: 1;
        cursor: pointer;
      }
      .icon-btn:hover { background: rgba(255,255,255,.07); color: var(--text); }
      .body {
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: #39424e transparent;
      }
      .body::-webkit-scrollbar { width: 8px; }
      .body::-webkit-scrollbar-thumb { background: #39424e; border-radius: 99px; border: 2px solid transparent; background-clip: padding-box; }
      .tab-nav {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4px;
        margin: 0 0 10px;
        padding: 4px;
        border: 1px solid var(--line);
        border-radius: 9px;
        background: rgba(0,0,0,.18);
      }
      .tab-nav button {
        height: 30px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #85939c;
        font-size: 10px;
        cursor: pointer;
      }
      .tab-nav button:hover { color: #dbe5e8; }
      .tab-nav button.active {
        background: var(--bg-raised);
        color: var(--accent);
        font-weight: 700;
      }
      .page-hidden { display: none !important; }
      .font-quick {
        margin-bottom: 12px;
        padding: 12px;
        border: 1px solid rgba(94,234,212,.28);
        border-radius: 10px;
        background: linear-gradient(145deg, rgba(94,234,212,.10), rgba(94,234,212,.025));
      }
      .font-quick-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .font-quick-head h2 { margin: 0; font-size: 11px; color: #dbe5e8; letter-spacing: .06em; }
      .font-quick-head output {
        color: var(--accent);
        font: 700 24px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      .font-quick-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
      }
      .font-quick-row button {
        flex: 0 0 34px;
        height: 34px;
        border: 1px solid var(--line-strong);
        border-radius: 8px;
        background: var(--bg-raised);
        color: var(--accent);
        font-size: 18px;
        cursor: pointer;
      }
      .font-quick-row input[type="range"] { flex: 1; accent-color: var(--accent); }
      .font-quick-note { margin: 9px 0 0; color: #8f9da5; font-size: 9px; line-height: 1.45; }
      .section {
        padding: 13px 14px;
        border-bottom: 1px solid var(--line);
      }
      .section:last-of-type { border-bottom: 0; }
      .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }
      .section h2 {
        margin: 0;
        color: #dbe5e8;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .hint {
        margin: 7px 0 0;
        color: var(--muted);
        font-size: 11px;
        line-height: 1.55;
      }
      .hint.warning { color: #f2c879; }
      .movie-info {
        margin: 8px 0 0;
        padding: 7px 9px;
        border: 1px solid rgba(94,234,212,.12);
        border-radius: 7px;
        background: rgba(94,234,212,.035);
        color: #9fb2b8;
        font-size: 10px;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }
      .movie-info strong {
        color: #cfece8;
        font-weight: 600;
      }
      select, input[type="number"] {
        width: 100%;
        height: 34px;
        border: 1px solid var(--line-strong);
        border-radius: 9px;
        outline: none;
        background: var(--bg-soft);
        color: var(--text);
        padding: 0 10px;
      }
      select { cursor: pointer; }
      select:disabled { color: #6f7c87; cursor: not-allowed; }
      select:focus-visible, input:focus-visible, button:focus-visible {
        outline: 2px solid var(--accent-strong);
        outline-offset: 2px;
      }
      .primary-btn {
        width: 100%;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        border: 1px solid rgba(94,234,212,.65);
        border-radius: 10px;
        background: linear-gradient(180deg, #8ff8e8, #5eead4 62%, #3ddbc5);
        color: var(--accent-ink);
        font-weight: 750;
        font-size: 13px;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(45,212,191,.13), inset 0 1px 0 rgba(255,255,255,.45);
      }
      .primary-btn:hover { filter: brightness(1.04); }
      .primary-btn:active { transform: translateY(1px); }
      .plus { font-size: 17px; line-height: 1; margin-top: -1px; }
      .text-btn {
        padding: 2px 4px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--accent);
        font-size: 11px;
        cursor: pointer;
      }
      .text-btn:hover { background: rgba(94,234,212,.08); }
      button {
        font-family: inherit;
      }
      button:disabled { opacity: .38; cursor: not-allowed; }
      .subtitle-section { background: rgba(255,255,255,.018); }
      .tag {
        flex: 0 0 auto;
        padding: 2px 7px;
        border: 1px solid rgba(94,234,212,.25);
        border-radius: 999px;
        background: rgba(94,234,212,.08);
        color: var(--accent);
        font-size: 9px;
        font-weight: 800;
        letter-spacing: .08em;
      }
      .filename {
        margin: 0;
        color: #f6fbfb;
        font-size: 12px;
        font-weight: 650;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .meta-row {
        display: flex;
        gap: 12px;
        margin-top: 4px;
        color: var(--muted);
        font-size: 10.5px;
        font-variant-numeric: tabular-nums;
      }
      .button-row { display: flex; gap: 8px; margin-top: 10px; }
      .button-row button, .offset-apply button {
        flex: 1;
        height: 32px;
        border: 1px solid var(--line-strong);
        border-radius: 8px;
        background: var(--bg-raised);
        color: #dce5e8;
        font-size: 11.5px;
        cursor: pointer;
      }
      .button-row button:hover, .offset-apply button:hover { background: #29313d; }
      .button-row button.danger { color: var(--danger); }
      .button-row button.danger:hover { background: var(--danger-bg); border-color: rgba(255,142,134,.25); }
      .offset-value {
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(255,255,255,.06);
        color: #dbe5e8;
        font-size: 10.5px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .offset-value.positive { color: #74f0dd; background: rgba(45,212,191,.1); }
      .offset-value.negative { color: #ffb0a9; background: rgba(255,142,134,.1); }
      .nudge-grid {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 5px;
      }
      .nudge-grid button {
        height: 28px;
        padding: 0;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--bg-soft);
        color: #b7c4cc;
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
      }
      .nudge-grid button:hover { border-color: rgba(94,234,212,.32); color: var(--accent); background: rgba(45,212,191,.06); }
      .offset-apply { display: flex; align-items: stretch; gap: 7px; margin-top: 8px; }
      .number-wrap { position: relative; flex: 1; min-width: 0; }
      .number-wrap input { padding-right: 32px; font-variant-numeric: tabular-nums; }
      .number-wrap span {
        position: absolute;
        top: 50%;
        right: 10px;
        transform: translateY(-50%);
        color: #7d8994;
        font-size: 10px;
        pointer-events: none;
      }
      .offset-apply button { flex: 0 0 66px; }
      .auto-estimate {
        margin-top: 12px;
        padding: 9px;
        border: 1px solid var(--line);
        border-radius: 9px;
        background: rgba(255,255,255,.02);
      }
      .auto-estimate-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .auto-estimate-head strong { color: #dbe5e8; font-size: 10.5px; }
      .auto-estimate-head button,
      .estimate-apply {
        height: 27px;
        padding: 0 8px;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
        background: var(--bg-raised);
        color: #cbd7da;
        font-size: 9.5px;
        cursor: pointer;
      }
      .auto-estimate-head button:hover,
      .estimate-apply:hover { background: #29313d; }
      .estimate-result {
        margin: 8px 0 0;
        color: var(--accent);
        font-size: 10px;
        line-height: 1.5;
      }
      .estimate-result.low { color: #e7c57a; }
      .estimate-result.high { color: var(--accent); font-weight: 600; }
      .estimate-apply { margin-top: 7px; color: var(--accent); }
      .audio-calibration {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
      }
      .audio-calibration button {
        height: 25px;
        padding: 0 7px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--bg-raised);
        color: #b7c5ca;
        font-size: 9px;
        cursor: pointer;
      }
      .audio-calibration button:hover { background: #29313d; }
      .audio-calibration span {
        color: #77848e;
        font-size: 9px;
      }
      .audio-diagnostics {
        margin-top: 8px;
        color: #9ba9b0;
        font-size: 9px;
      }
      .audio-diagnostics summary { cursor: pointer; color: #c6d3d7; }
      .audio-diagnostics pre {
        max-height: 180px;
        margin: 6px 0;
        padding: 7px;
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: rgba(0,0,0,.18);
        color: #b9c7cc;
        font: 9px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .audio-diagnostics button {
        height: 24px;
        padding: 0 7px;
        border: 1px solid var(--line);
        border-radius: 5px;
        background: var(--bg-raised);
        color: #b7c5ca;
        font-size: 9px;
        cursor: pointer;
      }
      .anchor-sync {
        margin-top: 10px;
        padding: 9px;
        border: 1px solid var(--line);
        border-radius: 9px;
        background: rgba(255,255,255,.02);
      }
      .anchor-sync-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .anchor-sync-head strong { color: #dbe5e8; font-size: 10.5px; }
      .anchor-sync-head span { color: #77848e; font-size: 9px; }
      .anchor-search {
        display: flex;
        gap: 6px;
        margin-top: 8px;
      }
      .anchor-search input {
        flex: 1;
        min-width: 0;
        height: 29px;
        padding: 0 8px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: rgba(0,0,0,.22);
        color: #e6eef0;
        font-size: 10px;
        outline: none;
      }
      .anchor-search input:focus { border-color: var(--accent); }
      .anchor-search button,
      .anchor-apply {
        height: 29px;
        padding: 0 9px;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
        background: var(--bg-raised);
        color: #cbd7da;
        font-size: 9.5px;
        cursor: pointer;
      }
      .anchor-search button:hover,
      .anchor-apply:hover:not(:disabled) { background: #29313d; }
      .anchor-results {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 154px;
        margin-top: 7px;
        overflow: auto;
      }
      .anchor-result {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        width: 100%;
        padding: 6px 7px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: rgba(0,0,0,.14);
        color: #c6d3d6;
        text-align: left;
        font-size: 9.5px;
        line-height: 1.4;
        cursor: pointer;
      }
      .anchor-result:hover { background: #29313d; }
      .anchor-result time {
        flex: 0 0 auto;
        color: var(--accent);
        font: 9px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      .anchor-result span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .anchor-selected {
        margin: 7px 0 0;
        padding: 6px 7px;
        border-left: 2px solid var(--accent);
        background: rgba(72, 228, 194, .06);
        color: #b9c7cb;
        font-size: 9.5px;
        line-height: 1.45;
      }
      .anchor-apply { width: 100%; margin-top: 7px; }
      .anchor-apply:disabled { opacity: .45; cursor: default; }
      .anchor-status { margin: 6px 0 0; color: #77848e; font-size: 9px; line-height: 1.4; }
      .anchor-status.ok { color: var(--accent); }
      .anchor-status.warn { color: #e7c57a; }
      .first-line-sync {
        margin-top: 10px;
        padding: 9px;
        border: 1px solid var(--line);
        border-radius: 9px;
        background: rgba(255,255,255,.02);
      }
      .first-line-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .first-line-actions button {
        height: 28px;
        padding: 0 8px;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
        background: var(--bg-raised);
        color: #cbd7da;
        font-size: 9.5px;
        cursor: pointer;
      }
      .first-line-actions button:hover { background: #29313d; }
      .first-line-status { margin: 6px 0 0; color: #77848e; font-size: 9px; line-height: 1.4; }
      .first-line-status.ok { color: var(--accent); }
      .first-line-status.warn { color: #e7c57a; }
      .auto-estimate-note {
        margin: 7px 0 0;
        color: #77848e;
        font-size: 9px;
        line-height: 1.4;
      }
      .appearance-details, .match-details { padding: 0; }
      .appearance-details summary, .match-details summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 13px 14px;
        color: #dbe5e8;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
        cursor: pointer;
        list-style: none;
      }
      .appearance-details summary::-webkit-details-marker,
      .match-details summary::-webkit-details-marker { display: none; }
      .appearance-details summary:hover,
      .match-details summary:hover { background: rgba(255,255,255,.025); }
      .appearance-details[open] summary,
      .match-details[open] summary { border-bottom: 1px solid var(--line); }
      .appearance-summary-hint {
        color: var(--muted);
        font-size: 9px;
        font-weight: 500;
        letter-spacing: .02em;
        text-transform: none;
      }
      .appearance-body { padding: 14px 16px 16px; }
      .cue-preview {
        min-height: 104px;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding: 14px;
        margin-bottom: 4px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background:
          radial-gradient(330px 150px at 50% 90%, rgba(45,212,191,.10), transparent 70%),
          linear-gradient(135deg, #1a2832, #21151f);
        overflow: hidden;
      }
      .cue-preview span {
        display: inline-block;
        max-width: 100%;
        padding: 2px 7px;
        border-radius: 3px;
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
      .appearance-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .appearance-field { margin-top: 12px; min-width: 0; }
      .appearance-grid .appearance-field { margin-top: 12px; }
      .appearance-field-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 5px;
        color: #c5d0d4;
        font-size: 11.5px;
      }
      .appearance-field-head output {
        color: var(--accent);
        font-size: 10.5px;
        font-variant-numeric: tabular-nums;
      }
      .appearance-field input[type="range"] {
        display: block;
        width: 100%;
        height: 22px;
        margin: 0;
        padding: 0;
        accent-color: var(--accent-strong);
        background: transparent;
        cursor: pointer;
      }
      .appearance-select {
        width: 100%;
        height: 34px;
        border: 1px solid var(--line-strong);
        border-radius: 8px;
        background: var(--bg-soft);
        color: var(--text);
        padding: 0 9px;
        font: inherit;
        font-size: 11.5px;
        outline: none;
      }
      .appearance-select:focus-visible {
        outline: 2px solid var(--accent-strong);
        outline-offset: 2px;
      }
      .color-fields {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 12px;
      }
      .color-field {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 44px;
        padding: 8px 10px;
        border: 1px solid var(--line);
        border-radius: 9px;
        background: var(--bg-soft);
        color: #c5d0d4;
        font-size: 11px;
      }
      .color-field.full { grid-column: 1 / -1; }
      .color-field input[type="color"] {
        width: 36px;
        height: 26px;
        padding: 2px;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
        background: #0e1217;
        cursor: pointer;
      }
      .shadow-panel {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--line);
      }
      .shadow-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: #d5e0e3;
        font-size: 11.5px;
        font-weight: 600;
      }
      .shadow-head .mini-switch {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: var(--muted);
        font-size: 10.5px;
        font-weight: 500;
        cursor: pointer;
      }
      .mini-switch input {
        width: 14px;
        height: 14px;
        accent-color: var(--accent-strong);
        cursor: pointer;
      }
      .shadow-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0 12px;
      }
      .shadow-grid .color-field { margin-top: 10px; }
      .shadow-panel.is-disabled .appearance-field,
      .shadow-panel.is-disabled .color-field {
        opacity: .42;
      }
      .shadow-panel.is-disabled input[disabled] {
        cursor: not-allowed;
      }
      .ass-override {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-top: 12px;
        color: #c6d3d6;
        font-size: 10.5px;
        cursor: pointer;
      }
      .ass-override input { accent-color: var(--accent); }
      .appearance-actions {
        display: flex;
        gap: 8px;
        margin-top: 14px;
      }
      .appearance-actions button {
        flex: 1;
        height: 34px;
        border: 1px solid var(--line-strong);
        border-radius: 8px;
        background: var(--bg-raised);
        color: #dce5e8;
        font-size: 11px;
        cursor: pointer;
      }
      .appearance-actions button:hover { background: #29313d; }
      .appearance-actions button.accent {
        border-color: rgba(94,234,212,.30);
        background: rgba(45,212,191,.08);
        color: var(--accent);
      }
      .appearance-note {
        margin: 9px 0 0;
        color: #77848e;
        font-size: 9.5px;
        line-height: 1.5;
      }
      .match-body { padding: 12px 14px 14px; }
      .match-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.6fr) minmax(80px, .7fr);
        gap: 9px;
      }
      .match-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        color: #aebbc1;
        font-size: 10px;
      }
      .match-field.full { grid-column: 1 / -1; }
      .match-field input, .match-field select {
        width: 100%;
        height: 32px;
        border: 1px solid var(--line-strong);
        border-radius: 8px;
        background: var(--bg-soft);
        color: var(--text);
        padding: 0 9px;
        outline: none;
        font: inherit;
        font-size: 11.5px;
      }
      .match-field input:focus, .match-field select:focus {
        border-color: rgba(94,234,212,.55);
      }
      .match-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
      }
      .match-actions button {
        height: 29px;
        padding: 0 9px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--bg-raised);
        color: #cbd7da;
        font-size: 10px;
        cursor: pointer;
      }
      .match-actions button:hover { background: #29313d; }
      .match-actions button.primary-match {
        border-color: rgba(94,234,212,.28);
        background: rgba(45,212,191,.08);
        color: var(--accent);
      }
      .match-actions button:disabled { opacity: .38; cursor: not-allowed; }
      .match-note {
        margin: 8px 0 0;
        color: #77848e;
        font-size: 9.5px;
        line-height: 1.5;
      }
      .match-status {
        margin: 9px 0 0;
        color: #8e9ba4;
        font-size: 10px;
        line-height: 1.45;
      }
      .match-status.ok { color: #9edbd1; }
      .match-status.warn { color: #e7c57a; }
      .match-status.error { color: #ffb0a9; }
      .candidate-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
        max-height: 250px;
        margin-top: 9px;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: #39424e transparent;
      }
      .candidate-list:empty { display: none; }
      .candidate-card {
        padding: 9px;
        border: 1px solid var(--line);
        border-radius: 9px;
        background: rgba(255,255,255,.025);
      }
      .candidate-card.selected {
        border-color: rgba(94,234,212,.42);
        background: rgba(45,212,191,.07);
      }
      .candidate-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }
      .candidate-title {
        min-width: 0;
        color: #e8f1f2;
        font-size: 11.5px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .candidate-score {
        flex: 0 0 auto;
        padding: 1px 6px;
        border-radius: 999px;
        background: rgba(255,255,255,.06);
        color: #cbd7da;
        font-size: 9.5px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .candidate-score.high { color: var(--accent); background: rgba(45,212,191,.10); }
      .candidate-score.medium { color: #f2c879; background: rgba(242,200,121,.10); }
      .candidate-score.low { color: #ffb0a9; background: rgba(255,142,134,.09); }
      .candidate-meta {
        margin: 3px 0 0;
        color: #7f8d97;
        font-size: 9.5px;
        overflow-wrap: anywhere;
      }
      .candidate-reasons {
        margin: 5px 0 0;
        color: #a7b7bd;
        font-size: 9.5px;
        line-height: 1.5;
      }
      .candidate-mismatch { color: #d2a07a; }
      .candidate-use {
        margin-top: 7px;
        height: 25px;
        padding: 0 9px;
        border: 1px solid rgba(94,234,212,.24);
        border-radius: 6px;
        background: rgba(45,212,191,.06);
        color: var(--accent);
        font-size: 9.5px;
        cursor: pointer;
      }
      .candidate-use:hover { background: rgba(45,212,191,.12); }
      .toggle-section { padding-top: 12px; padding-bottom: 12px; }
      .switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        cursor: pointer;
      }
      .switch-row strong { display: block; font-size: 12px; font-weight: 600; }
      .switch-row small { display: block; margin-top: 2px; color: var(--muted); font-size: 10.5px; }
      .switch-row input {
        position: absolute;
        width: 1px; height: 1px;
        opacity: 0;
        pointer-events: none;
      }
      .switch {
        flex: 0 0 auto;
        position: relative;
        width: 36px; height: 21px;
        border: 1px solid var(--line-strong);
        border-radius: 999px;
        background: #29313b;
        transition: background .16s ease, border-color .16s ease;
      }
      .switch::after {
        content: "";
        position: absolute;
        top: 3px; left: 3px;
        width: 13px; height: 13px;
        border-radius: 50%;
        background: #9aa6b0;
        transition: transform .16s ease, background .16s ease;
      }
      .switch-row input:checked + .switch {
        background: rgba(45,212,191,.23);
        border-color: rgba(94,234,212,.55);
      }
      .switch-row input:checked + .switch::after {
        transform: translateX(15px);
        background: var(--accent);
      }
      .switch-row input:focus-visible + .switch {
        outline: 2px solid var(--accent-strong);
        outline-offset: 2px;
      }
      .status {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        padding: 10px 14px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .dot {
        flex: 0 0 auto;
        width: 6px; height: 6px;
        margin-top: 4px;
        border-radius: 50%;
        background: #6f7c87;
        box-shadow: 0 0 0 3px rgba(111,124,135,.12);
      }
      .status.ok { color: #a9c3bf; }
      .status.ok .dot { background: var(--accent); box-shadow: 0 0 0 3px rgba(94,234,212,.12); }
      .status.busy .dot { background: #f2c879; box-shadow: 0 0 0 3px rgba(242,200,121,.12); animation: ss-pulse 1.1s ease-in-out infinite; }
      .status.error { color: #ffc0ba; }
      .status.error .dot { background: var(--danger); box-shadow: 0 0 0 3px rgba(255,142,134,.12); }
      @keyframes ss-pulse { 50% { opacity: .35; } }
      .error-box {
        margin: 0 14px 12px;
        padding: 10px 11px;
        border: 1px solid rgba(255,142,134,.27);
        border-radius: 10px;
        background: var(--danger-bg);
      }
      .error-head { display: flex; align-items: center; gap: 6px; color: #ffc0ba; font-size: 11.5px; }
      .error-icon {
        width: 16px; height: 16px;
        display: grid; place-items: center;
        border-radius: 50%;
        background: rgba(255,142,134,.18);
        color: var(--danger);
        font-size: 10px;
        font-weight: 800;
      }
      .error-box p {
        margin: 6px 0 0;
        color: #ffd7d3;
        font-size: 11px;
        line-height: 1.55;
        overflow-wrap: anywhere;
      }
      .error-box .error-detail { color: #c49591; font-size: 10px; }
      .error-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
      .error-actions button {
        height: 27px;
        padding: 0 12px;
        border: 1px solid rgba(255,142,134,.32);
        border-radius: 7px;
        background: rgba(255,142,134,.1);
        color: #ffd7d3;
        font-size: 10.5px;
        cursor: pointer;
      }
      footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 4px 12px;
        padding: 9px 14px 11px;
        border-top: 1px solid var(--line);
        color: #687580;
        font-size: 9px;
        letter-spacing: .02em;
      }
      .is-hidden { display: none !important; }
      .panel.collapsed .body { display: none; }
      .panel.collapsed .header { border-bottom: 0; }
      .panel.collapsed .title-wrap p { display: none; }
    </style>
    <div class="panel" data-role="panel" aria-label="本地字幕控制面板">
      <header class="header" data-role="drag-handle">
        <div class="brand">
          <div class="logo" aria-hidden="true">字</div>
          <div class="title-wrap">
            <h1>本地字幕</h1>
            <p>LOCAL SUBTITLE</p>
          </div>
        </div>
        <div class="header-actions">
          <button class="icon-btn" type="button" data-action="open-options" title="更多设置" aria-label="打开更多设置">⚙</button>
          <button class="icon-btn" type="button" data-action="collapse" title="折叠面板" aria-label="折叠面板" aria-expanded="true">−</button>
          <button class="icon-btn" type="button" data-action="close" title="关闭面板" aria-label="关闭面板">×</button>
        </div>
      </header>
      <div class="body">
        <section class="section">
          <div class="section-head">
            <h2>目标视频</h2>
            <button class="text-btn" type="button" data-action="rescan">重新扫描</button>
          </div>
          <select data-role="video-select" aria-label="选择目标视频"></select>
          <p class="hint" data-role="video-hint">正在检测页面中的 HTML5 视频…</p>
          <p class="movie-info is-hidden" data-role="movie-info"></p>
        </section>

        <nav class="tab-nav" data-role="tab-nav" aria-label="面板页面">
          <button type="button" class="active" data-action="tab" data-tab="subtitle">字幕</button>
          <button type="button" data-action="tab" data-tab="sync">同步</button>
          <button type="button" data-action="tab" data-tab="style">外观</button>
          <button type="button" data-action="tab" data-tab="search">搜索</button>
        </nav>

        <details class="section match-details" data-role="match-details" data-page="search">
          <summary>
            <span>字幕匹配</span>
            <span class="appearance-summary-hint">本地候选 · 评分</span>
          </summary>
          <div class="match-body">
            <div class="match-grid">
              <label class="match-field full">
                片名
                <input data-role="match-title" type="text" maxlength="200" placeholder="自动识别或手动输入">
              </label>
              <label class="match-field">
                年份
                <input data-role="match-year" type="number" min="1900" max="2099" step="1" placeholder="可选">
              </label>
              <label class="match-field">
                语言
                <select data-role="match-language">
                  <option value="">自动</option>
                  <option value="zh">中文</option>
                  <option value="en">英语</option>
                  <option value="ja">日语</option>
                  <option value="ko">韩语</option>
                  <option value="fr">法语</option>
                  <option value="de">德语</option>
                  <option value="es">西语</option>
                  <option value="ru">俄语</option>
                </select>
              </label>
            </div>
            <div class="match-actions">
              <button class="primary-match" type="button" data-action="choose-candidates">选择候选字幕…</button>
              <button type="button" data-action="search-provider">在线搜索</button>
              <button type="button" data-action="load-library">加载字幕库</button>
              <button type="button" data-action="rank-candidates">重新匹配</button>
              <button type="button" data-action="use-detected">用识别结果</button>
            </div>
            <input class="is-hidden" data-role="candidate-input" type="file" accept=".srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip,text/x-ssa" multiple>
            <p class="match-note">在线搜索使用 OpenSubtitles；需在设置页配置 API Key。只发送片名、年份、语言和集数，不发送视频或字幕文件。</p>
            <p class="match-status" data-role="match-status">尚未选择候选字幕。</p>
            <div class="candidate-list" data-role="candidate-list"></div>
          </div>
        </details>

        <section class="section" data-page="subtitle">
          <button class="primary-btn" type="button" data-action="choose-file">
            <span class="plus" aria-hidden="true">＋</span>
            选择 SRT / VTT / ASS 字幕
          </button>
          <input class="is-hidden" data-role="file-input" type="file" accept=".srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip,text/x-ssa">
          <p class="hint">文件只在当前页面本地解析，不上传字幕或视频。</p>
        </section>

        <section class="section subtitle-section is-hidden" data-role="subtitle-section" data-page="subtitle">
          <div class="section-head">
            <h2>当前字幕</h2>
            <span class="tag" data-role="format-tag">SRT</span>
          </div>
          <p class="filename" data-role="file-name"></p>
          <div class="meta-row">
            <span data-role="cue-count"></span>
            <span data-role="duration"></span>
          </div>
          <p class="hint warning is-hidden" data-role="warning"></p>
          <div class="button-row">
            <button type="button" data-action="reload">重新加载</button>
            <button class="danger" type="button" data-action="remove">移除字幕</button>
          </div>
        </section>

        <section class="section" data-page="subtitle">
          <div class="section-head">
            <h2>时间偏移</h2>
            <output class="offset-value" data-role="offset-label">0 ms</output>
          </div>
          <div class="nudge-grid" aria-label="快速微调偏移">
            <button type="button" data-nudge="-500">−500</button>
            <button type="button" data-nudge="-100">−100</button>
            <button type="button" data-nudge="-50">−50</button>
            <button type="button" data-nudge="50">+50</button>
            <button type="button" data-nudge="100">+100</button>
            <button type="button" data-nudge="500">+500</button>
          </div>
          <div class="offset-apply">
            <div class="number-wrap">
              <input data-role="offset-input" type="number" step="10" min="-3600000" max="3600000" value="0" inputmode="numeric" aria-label="偏移毫秒">
              <span>ms</span>
            </div>
            <button type="button" data-action="apply-offset">应用</button>
          </div>
          <div class="button-row">
            <button type="button" data-action="undo" disabled>撤销</button>
            <button type="button" data-action="reset-offset">归零</button>
          </div>
          <p class="hint">正数延迟字幕，负数提前字幕；归零可恢复原始时间轴。</p>
        </section>

        <section class="section" data-page="sync">
          <div class="section-head">
            <h2>同步工具</h2>
            <span class="appearance-summary-hint">首句 / 台词 / 音频</span>
          </div>
          <div class="auto-estimate">
            <div class="auto-estimate-head">
              <strong>自动分析</strong>
              <button type="button" data-action="estimate-offset">分析时间轴</button>
            </div>
            <p class="estimate-result is-hidden" data-role="estimate-result"></p>
            <button class="estimate-apply is-hidden" type="button" data-action="apply-estimate">应用建议</button>
            <p class="auto-estimate-note">只根据“末条字幕与视频结尾”做启发式建议，没有音频/语音识别；低置信度时请手动确认。</p>
            <div class="audio-calibration">
              <button type="button" data-action="probe-audio">检测音频</button>
              <button type="button" data-action="audio-calibrate">视频音频 8s</button>
              <button type="button" data-action="tab-audio-calibrate">标签页多窗口 40s</button>
              <span data-role="audio-status">未检测音频</span>
            </div>
            <p class="auto-estimate-note" data-role="audio-note">标签页多窗口需要 tabCapture 权限：连续采样约 40 秒，分成 5 个窗口做一致性校验；仅在本机分析，DRM/静音标签页可能失败。</p>
            <details class="audio-diagnostics is-hidden" data-role="audio-diagnostics">
              <summary>校准诊断</summary>
              <pre data-role="audio-diagnostics-text"></pre>
              <button type="button" data-action="copy-diagnostics">复制诊断</button>
            </details>
          </div>
          <div class="anchor-sync">
            <div class="anchor-sync-head">
              <strong>台词锚点</strong>
              <span>文本定位 · 手动确认</span>
            </div>
            <p class="auto-estimate-note">播放到目标台词并暂停，输入其中几个字，选中后用当前视频时间计算偏移。适用于跨域、DRM 或音频不可用的页面。</p>
            <div class="anchor-search">
              <input data-role="anchor-query" type="text" maxlength="80" placeholder="输入你听到的台词片段" aria-label="台词片段">
              <button type="button" data-action="search-anchor">查找</button>
            </div>
            <div class="anchor-results" data-role="anchor-results"></div>
            <p class="anchor-selected is-hidden" data-role="anchor-selected"></p>
            <button class="anchor-apply" data-action="apply-anchor" type="button" data-role="anchor-apply" disabled>以当前时间对齐</button>
            <p class="anchor-status" data-role="anchor-status"></p>
          </div>
          <div class="first-line-sync">
            <div class="anchor-sync-head">
              <strong>首句对齐</strong>
              <span>无需理解台词 · 自动/手动</span>
            </div>
            <p class="auto-estimate-note">从片头播放。自动模式会捕获约 30 秒标签页音频，检测第一段持续声音；片头音乐可能误检，建议确认后应用。</p>
            <div class="first-line-actions">
              <button type="button" data-action="auto-first-line">自动检测首句 30s</button>
              <button type="button" data-action="manual-first-line">手动标记首句</button>
            </div>
            <p class="first-line-status" data-role="first-line-status"></p>
          </div>
        </section>

        <section class="section" data-page="style">
          <div class="font-quick">
            <div class="font-quick-head">
              <h2>字幕字号</h2>
              <output data-role="font-size-out">24px</output>
            </div>
            <div class="font-quick-row">
              <button type="button" data-action="font-step" data-delta="-1" aria-label="减小字号">−</button>
              <input id="ss-font-size" data-role="font-size" type="range" min="10" max="48" step="1" value="24" aria-label="字幕字号">
              <button type="button" data-action="font-step" data-delta="1" aria-label="增大字号">＋</button>
            </div>
            <label class="ass-override">
              <input data-role="override-ass" type="checkbox">
              <span>应用到 ASS 字幕</span>
            </label>
            <p class="font-quick-note">勾选后，字号、颜色、描边、阴影和位置会覆盖 ASS 文件样式。</p>
          </div>
          <details class="section appearance-details" data-role="appearance-details">
          <summary>
            <span>字幕外观</span>
            <span class="appearance-summary-hint">字号 / 字重 / 描边 / 阴影 / 位置</span>
          </summary>
          <div class="appearance-body">
            <div class="cue-preview" data-role="cue-preview" aria-label="样式预览">
              <span data-role="cue-preview-text">字幕样式预览
第二行示例</span>
            </div>

            <div class="appearance-grid">
              <div class="appearance-field">
                <div class="appearance-field-head"><label for="ss-font-weight">字重</label></div>
                <select id="ss-font-weight" class="appearance-select" data-role="font-weight" aria-label="字幕字重">
                  <option value="400">常规 400</option>
                  <option value="500">中等 500</option>
                  <option value="600" selected>半粗 600</option>
                  <option value="700">粗体 700</option>
                  <option value="800">特粗 800</option>
                </select>
              </div>
            </div>

            <div class="color-fields">
              <div class="color-field">
                <label for="ss-text-color">文字颜色</label>
                <input id="ss-text-color" data-role="text-color" type="color" value="#ffffff" aria-label="字幕文字颜色">
              </div>
              <div class="color-field">
                <label for="ss-outline-color">描边颜色</label>
                <input id="ss-outline-color" data-role="outline-color" type="color" value="#000000" aria-label="字幕描边颜色">
              </div>
              <div class="color-field full">
                <label for="ss-background-color">背景颜色</label>
                <input id="ss-background-color" data-role="background-color" type="color" value="#000000" aria-label="字幕背景颜色">
              </div>
            </div>

            <div class="appearance-grid">
              <div class="appearance-field">
                <div class="appearance-field-head">
                  <label for="ss-outline-width">描边宽度</label>
                  <output data-role="outline-width-out">2px</output>
                </div>
                <input id="ss-outline-width" data-role="outline-width" type="range" min="0" max="6" step="0.5" value="2" aria-label="字幕描边宽度">
              </div>
              <div class="appearance-field">
                <div class="appearance-field-head">
                  <label for="ss-background-opacity">背景不透明度</label>
                  <output data-role="background-opacity-out">70%</output>
                </div>
                <input id="ss-background-opacity" data-role="background-opacity" type="range" min="0" max="95" step="5" value="70" aria-label="字幕背景不透明度">
              </div>
            </div>

            <div class="appearance-field">
              <div class="appearance-field-head">
                <label for="ss-position">纵向位置</label>
                <output data-role="position-out">90%</output>
              </div>
              <input id="ss-position" data-role="position" type="range" min="60" max="96" step="1" value="90" aria-label="字幕纵向位置">
              <p class="appearance-note">拖动时字幕实时移动；自带 line 设置的 cue 保留原位置。</p>
            </div>

            <div class="shadow-panel" data-role="shadow-panel">
              <div class="shadow-head">
                <span>投影阴影</span>
                <label class="mini-switch">
                  <input data-role="shadow-enabled" type="checkbox" checked>
                  启用
                </label>
              </div>
              <div class="shadow-grid">
                <div class="color-field full">
                  <label for="ss-shadow-color">阴影颜色</label>
                  <input id="ss-shadow-color" data-role="shadow-color" type="color" value="#000000" aria-label="字幕阴影颜色">
                </div>
                <div class="appearance-field">
                  <div class="appearance-field-head">
                    <label for="ss-shadow-opacity">不透明度</label>
                    <output data-role="shadow-opacity-out">55%</output>
                  </div>
                  <input id="ss-shadow-opacity" data-role="shadow-opacity" type="range" min="0" max="90" step="5" value="55" aria-label="字幕阴影不透明度">
                </div>
                <div class="appearance-field">
                  <div class="appearance-field-head">
                    <label for="ss-shadow-blur">模糊</label>
                    <output data-role="shadow-blur-out">4px</output>
                  </div>
                  <input id="ss-shadow-blur" data-role="shadow-blur" type="range" min="0" max="16" step="1" value="4" aria-label="字幕阴影模糊">
                </div>
                <div class="appearance-field">
                  <div class="appearance-field-head">
                    <label for="ss-shadow-x">X 偏移</label>
                    <output data-role="shadow-offset-x-out">0px</output>
                  </div>
                  <input id="ss-shadow-x" data-role="shadow-offset-x" type="range" min="-16" max="16" step="1" value="0" aria-label="字幕阴影水平偏移">
                </div>
                <div class="appearance-field">
                  <div class="appearance-field-head">
                    <label for="ss-shadow-y">Y 偏移</label>
                    <output data-role="shadow-offset-y-out">2px</output>
                  </div>
                  <input id="ss-shadow-y" data-role="shadow-offset-y" type="range" min="-16" max="16" step="1" value="2" aria-label="字幕阴影垂直偏移">
                </div>
              </div>
            </div>

            <div class="appearance-actions">
              <button type="button" data-action="reset-appearance">恢复默认外观</button>
              <button class="accent" type="button" data-action="open-options">更多设置</button>
            </div>
            <p class="appearance-note">外观设置保存在本机；阴影和描边都由原生 cue 样式实现。</p>
          </div>
        </details>
        </section>

        <section class="section toggle-section">
          <label class="switch-row">
            <span>
              <strong>显示字幕</strong>
              <small>关闭后保留已加载文件</small>
            </span>
            <input data-role="enabled" type="checkbox" checked>
            <span class="switch" aria-hidden="true"></span>
          </label>
        </section>

        <div class="status" data-role="status" role="status" aria-live="polite">
          <span class="dot" aria-hidden="true"></span>
          <span data-role="status-text">正在初始化…</span>
        </div>

        <div class="error-box is-hidden" data-role="error" role="alert">
          <div class="error-head">
            <span class="error-icon" aria-hidden="true">!</span>
            <strong>操作未完成</strong>
          </div>
          <p data-role="error-message"></p>
          <p class="error-detail is-hidden" data-role="error-detail"></p>
          <div class="error-actions">
            <button type="button" data-action="retry">重试</button>
            <button class="text-btn" type="button" data-action="dismiss-error">关闭</button>
          </div>
        </div>

        <footer>
          <span>v0.13.0 · SRT / VTT / ASS</span>
          <span>在线搜索可选 · 自动分析</span>
        </footer>
      </div>
    </div>
  `;

  class PanelView {
    constructor(callbacks) {
      this.callbacks = callbacks || {};
      this.capabilities = (NS.capabilities || {});
      this.host = null;
      this.shadow = null;
      this.panel = null;
      this.drag = null;
      this._videoSignature = '';
      this._mounted = false;
      this._onClick = this._onClick.bind(this);
      this._onFileChange = this._onFileChange.bind(this);
      this._onVideoChange = this._onVideoChange.bind(this);
      this._onEnabledChange = this._onEnabledChange.bind(this);
      this._onHeaderPointerDown = this._onHeaderPointerDown.bind(this);
      this._onDragMove = this._onDragMove.bind(this);
      this._onDragEnd = this._onDragEnd.bind(this);
      this._onViewportResize = this._onViewportResize.bind(this);
      this._onFullscreenChange = this._onFullscreenChange.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._onAppearanceInput = this._onAppearanceInput.bind(this);
      this._onAppearanceCommit = this._onAppearanceCommit.bind(this);
      this._onCandidateFilesChange = this._onCandidateFilesChange.bind(this);
      this._onMatchQueryChange = this._onMatchQueryChange.bind(this);
      this.activeTab = 'subtitle';
      this._matchRoles = ['match-title', 'match-year', 'match-language'];
      this._appearanceRoles = [
        'font-size',
        'font-weight',
        'text-color',
        'outline-color',
        'background-color',
        'outline-width',
        'background-opacity',
        'position',
        'shadow-enabled',
        'shadow-color',
        'shadow-opacity',
        'shadow-blur',
        'shadow-offset-x',
        'shadow-offset-y',
        'override-ass'
      ];
    }

    _applyCapabilities() {
      if (this.capabilities.audioCapture !== false) return;
      const selectors = [
        '.audio-calibration',
        '.audio-diagnostics',
        '[data-role="audio-note"]',
        '[data-action="auto-first-line"]'
      ];
      for (const selector of selectors) {
        const node = this.shadow.querySelector(selector);
        if (node) node.classList.add('is-hidden');
      }
      const note = this.shadow.querySelector('.first-line-sync .auto-estimate-note');
      if (note) {
        note.textContent =
          '当前浏览器不支持标签页音频捕获；请使用「手动标记首句」或「台词锚点」。';
      }
    }

    mount() {
      if (this._mounted) return;
      if (!document.documentElement) {
        throw new Error('document.documentElement is unavailable');
      }

      this.host = document.createElement('div');
      this.host.id = 'smart-subtitle-host';
      this.host.setAttribute('data-smart-subtitle-host', 'true');
      this.host.style.position = 'fixed';
      this.host.style.top = '18px';
      this.host.style.right = '18px';
      this.host.style.zIndex = '2147483646';
      this.host.style.width =
        'min(' + PANEL_WIDTH + 'px, calc(100vw - 24px))';
      this.host.style.maxHeight = 'calc(100vh - 24px)';
      this.host.style.pointerEvents = 'auto';

      this.shadow = this.host.attachShadow({ mode: 'open' });
      const templateDoc = new DOMParser().parseFromString(
        '<template>' + TEMPLATE + '</template>',
        'text/html'
      );
      const templateNode = templateDoc.querySelector('template');
      this.shadow.append(document.importNode(templateNode.content, true));
      this._applyCapabilities();
      this.panel = this.shadow.querySelector('[data-role="panel"]');
      this._appendHost();

      this.shadow.addEventListener('click', this._onClick);
      this.shadow.addEventListener('keydown', this._onKeyDown);
      this.shadow.addEventListener('input', this._onAppearanceInput);
      this.shadow.addEventListener('change', this._onAppearanceCommit);
      this.shadow.addEventListener('change', this._onMatchQueryChange);
      this.shadow
        .querySelector('[data-role="file-input"]')
        .addEventListener('change', this._onFileChange);
      this.shadow
        .querySelector('[data-role="candidate-input"]')
        .addEventListener('change', this._onCandidateFilesChange);
      this.shadow
        .querySelector('[data-role="video-select"]')
        .addEventListener('change', this._onVideoChange);
      this.shadow
        .querySelector('[data-role="enabled"]')
        .addEventListener('change', this._onEnabledChange);
      this.shadow
        .querySelector('[data-role="drag-handle"]')
        .addEventListener('pointerdown', this._onHeaderPointerDown);
      this.shadow
        .querySelector('[data-role="offset-input"]')
        .addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            const apply = this.shadow.querySelector('[data-action="apply-offset"]');
            if (apply) apply.click();
          }
        }.bind(this));

      root.addEventListener('resize', this._onViewportResize, { passive: true });
      document.addEventListener('fullscreenchange', this._onFullscreenChange);
      this._mounted = true;
      this.setTab('subtitle');
    }

    setTab(name) {
      const next = ['subtitle', 'sync', 'style', 'search'].includes(name)
        ? name
        : 'subtitle';
      this.activeTab = next;
      for (const button of this.shadow.querySelectorAll('[data-action="tab"]')) {
        button.classList.toggle(
          'active',
          button.getAttribute('data-tab') === next
        );
      }
      for (const section of this.shadow.querySelectorAll('[data-page]')) {
        section.classList.toggle(
          'page-hidden',
          section.getAttribute('data-page') !== next
        );
      }
    }

    _appendHost() {
      if (!this.host) return;
      const fullscreen = document.fullscreenElement;
      let target = document.documentElement;
      if (
        fullscreen &&
        fullscreen !== document.documentElement &&
        fullscreen !== document.body &&
        !(fullscreen instanceof HTMLVideoElement) &&
        !(fullscreen instanceof HTMLIFrameElement)
      ) {
        target = fullscreen;
      }
      if (this.host.parentNode !== target) {
        target.appendChild(this.host);
      }
    }

    _q(role) {
      return this.shadow
        ? this.shadow.querySelector('[data-role="' + role + '"]')
        : null;
    }

    _action(name) {
      return this.shadow
        ? this.shadow.querySelector('[data-action="' + name + '"]')
        : null;
    }

    _onClick(event) {
      const target = event.target && event.target.closest
        ? event.target.closest('[data-action], [data-nudge]')
        : null;
      if (!target) return;

      if (target.hasAttribute('data-nudge')) {
        const delta = Number(target.getAttribute('data-nudge'));
        if (Number.isInteger(delta) && this.callbacks.onOffsetNudge) {
          this.callbacks.onOffsetNudge(delta);
        }
        return;
      }

      const action = target.getAttribute('data-action');
      switch (action) {
        case 'choose-file': {
          const input = this._q('file-input');
          if (input) {
            input.value = '';
            input.click();
          }
          break;
        }
        case 'choose-candidates': {
          const input = this._q('candidate-input');
          if (input) {
            input.value = '';
            input.click();
          }
          break;
        }
        case 'rank-candidates':
          if (this.callbacks.onRankCandidates) {
            this.callbacks.onRankCandidates();
          }
          break;
        case 'load-library':
          if (this.callbacks.onLoadLibrary) {
            this.callbacks.onLoadLibrary();
          }
          break;
        case 'search-provider':
          if (this.callbacks.onSearchProvider) {
            this.callbacks.onSearchProvider();
          }
          break;
        case 'use-detected':
          if (this.callbacks.onUseDetectedMetadata) {
            this.callbacks.onUseDetectedMetadata();
          }
          break;
        case 'use-candidate': {
          const id = target.getAttribute('data-candidate-id');
          if (id && this.callbacks.onUseCandidate) {
            this.callbacks.onUseCandidate(id);
          }
          break;
        }
        case 'rescan':
          if (this.callbacks.onRescan) this.callbacks.onRescan();
          break;
        case 'reload':
          if (this.callbacks.onReload) this.callbacks.onReload();
          break;
        case 'remove':
          if (this.callbacks.onRemove) this.callbacks.onRemove();
          break;
        case 'apply-offset': {
          const input = this._q('offset-input');
          const value = input ? Number(input.value) : NaN;
          if (this.callbacks.onOffsetSet) {
            this.callbacks.onOffsetSet(Number.isFinite(value) ? value : NaN);
          }
          break;
        }
        case 'undo':
          if (this.callbacks.onUndoOffset) this.callbacks.onUndoOffset();
          break;
        case 'reset-offset':
          if (this.callbacks.onResetOffset) this.callbacks.onResetOffset();
          break;
        case 'estimate-offset':
          if (this.callbacks.onEstimateOffset) this.callbacks.onEstimateOffset();
          break;
        case 'apply-estimate':
          if (this.callbacks.onApplyEstimate) this.callbacks.onApplyEstimate();
          break;
        case 'probe-audio':
          if (this.callbacks.onProbeAudio) this.callbacks.onProbeAudio();
          break;
        case 'audio-calibrate':
          if (this.callbacks.onAudioCalibrate) this.callbacks.onAudioCalibrate();
          break;
        case 'tab-audio-calibrate':
          if (this.callbacks.onTabAudioCalibrate) this.callbacks.onTabAudioCalibrate();
          break;
        case 'copy-diagnostics':
          this._copyDiagnostics();
          break;
        case 'search-anchor': {
          const input = this._q('anchor-query');
          if (this.callbacks.onSearchAnchor) {
            this.callbacks.onSearchAnchor(input ? input.value : '');
          }
          break;
        }
        case 'select-anchor': {
          const cueIndex = Number(target.getAttribute('data-cue-index'));
          if (Number.isInteger(cueIndex) && this.callbacks.onSelectAnchor) {
            this.callbacks.onSelectAnchor(cueIndex);
          }
          break;
        }
        case 'apply-anchor':
          if (this.callbacks.onApplyAnchor) this.callbacks.onApplyAnchor();
          break;
        case 'auto-first-line':
          if (this.callbacks.onAutoFirstLine) this.callbacks.onAutoFirstLine();
          break;
        case 'manual-first-line':
          if (this.callbacks.onManualFirstLine) this.callbacks.onManualFirstLine();
          break;
        case 'tab':
          this.setTab(target.getAttribute('data-tab'));
          break;
        case 'font-step': {
          const delta = Number(target.getAttribute('data-delta'));
          if (Number.isInteger(delta) && this.callbacks.onFontStep) {
            this.callbacks.onFontStep(delta);
          }
          break;
        }
        case 'reset-appearance':
          if (this.callbacks.onResetAppearance) {
            this.callbacks.onResetAppearance();
          }
          break;
        case 'open-options':
          if (this.callbacks.onOpenOptions) this.callbacks.onOpenOptions();
          break;
        case 'collapse':
          this.toggleCollapsed();
          break;
        case 'close':
          this.hide();
          break;
        case 'retry':
          if (this.callbacks.onRetry) this.callbacks.onRetry();
          break;
        case 'dismiss-error':
          if (this.callbacks.onDismissError) this.callbacks.onDismissError();
          break;
        default:
          break;
      }
    }

    _onFileChange(event) {
      const input = event.currentTarget;
      const file = input.files && input.files[0];
      input.value = '';
      if (file && this.callbacks.onFileSelected) {
        this.callbacks.onFileSelected(file);
      }
    }

    _onCandidateFilesChange(event) {
      const input = event.currentTarget;
      const files = input.files ? Array.from(input.files) : [];
      input.value = '';
      if (files.length && this.callbacks.onCandidateFilesSelected) {
        this.callbacks.onCandidateFilesSelected(files);
      }
    }

    _onMatchQueryChange(event) {
      const target = event.target;
      if (!target || !target.getAttribute) return;
      if (!this._matchRoles.includes(target.getAttribute('data-role'))) return;
      if (!this.callbacks.onMatchQueryChange) return;
      const title = this._q('match-title');
      const year = this._q('match-year');
      const language = this._q('match-language');
      this.callbacks.onMatchQueryChange({
        title: title ? title.value.trim() : '',
        year: year && year.value ? Number(year.value) : null,
        language: language ? language.value : ''
      });
    }

    setMatchQuery(query) {
      const value = query || {};
      const title = this._q('match-title');
      const year = this._q('match-year');
      const language = this._q('match-language');
      if (title) title.value = value.title || '';
      if (year) year.value = value.year ? String(value.year) : '';
      if (language) {
        const next = value.language || '';
        language.value = Array.from(language.options).some(function (option) {
          return option.value === next;
        })
          ? next
          : '';
      }
    }

    setMatchStatus(text, tone) {
      const status = this._q('match-status');
      if (!status) return;
      status.className = 'match-status' + (tone ? ' ' + tone : '');
      status.textContent = text || '';
    }

    setCandidates(results, options) {
      const list = this._q('candidate-list');
      if (!list) return;
      const opts = options || {};
      const items = Array.isArray(results) ? results : [];
      list.textContent = '';

      for (const result of items) {
        const candidate = result.candidate || {};
        const card = document.createElement('div');
        card.className =
          'candidate-card' +
          (candidate.id === opts.selectedId ? ' selected' : '');

        const head = document.createElement('div');
        head.className = 'candidate-head';
        const title = document.createElement('div');
        title.className = 'candidate-title';
        title.textContent =
          result.title || candidate.title || candidate.fileName || '未命名候选';
        const score = document.createElement('span');
        score.className = 'candidate-score ' + (result.confidence || 'low');
        score.textContent =
          String(result.score) + ' · ' + (result.confidenceLabel || '低');
        head.appendChild(title);
        head.appendChild(score);
        card.appendChild(head);

        const metaParts = [];
        if (candidate.fromCache) metaParts.push('字幕库');
        if (candidate.providerName) metaParts.push(candidate.providerName);
        if (candidate.fileName) metaParts.push(candidate.fileName);
        if (candidate.format) metaParts.push(String(candidate.format).toUpperCase());
        if (candidate.cueCount) metaParts.push(candidate.cueCount + ' 条');
        if (candidate.year) metaParts.push(String(candidate.year));
        if (candidate.downloadCount) {
          metaParts.push(candidate.downloadCount + ' 次下载');
        }
        const meta = document.createElement('p');
        meta.className = 'candidate-meta';
        meta.textContent = metaParts.join(' · ');
        card.appendChild(meta);

        if (result.reasons && result.reasons.length) {
          const reasons = document.createElement('p');
          reasons.className = 'candidate-reasons';
          reasons.textContent = result.reasons.slice(0, 2).join(' / ');
          card.appendChild(reasons);
        }
        if (result.mismatches && result.mismatches.length) {
          const mismatch = document.createElement('p');
          mismatch.className = 'candidate-reasons candidate-mismatch';
          mismatch.textContent = result.mismatches.slice(0, 2).join(' / ');
          card.appendChild(mismatch);
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'candidate-use';
        button.setAttribute('data-action', 'use-candidate');
        button.dataset.candidateId = String(candidate.id || '');
        button.textContent = '使用此字幕';
        card.appendChild(button);
        list.appendChild(card);
      }

      if (opts.status) {
        this.setMatchStatus(opts.status, opts.tone);
      } else if (items.length) {
        this.setMatchStatus(
          items.length + ' 个本地候选，按匹配分排序。',
          'ok'
        );
      } else {
        this.setMatchStatus('尚未选择候选字幕。', '');
      }
      if (opts.errorCount) {
        this.setMatchStatus(
          (opts.status ||
            items.length + ' 个本地候选，按匹配分排序。') +
            ' ' + opts.errorCount + ' 个文件读取失败。',
          opts.tone || 'warn'
        );
      }
    }

    _onVideoChange(event) {
      if (this.callbacks.onVideoSelected) {
        this.callbacks.onVideoSelected(event.currentTarget.value);
      }
    }

    _onEnabledChange(event) {
      if (this.callbacks.onEnabledChange) {
        this.callbacks.onEnabledChange(Boolean(event.currentTarget.checked));
      }
    }

    _isAppearanceControl(target) {
      if (!target || !target.getAttribute) return false;
      return this._appearanceRoles.includes(target.getAttribute('data-role'));
    }

    _collectAppearance() {
      const fontSize = this._q('font-size');
      const fontWeight = this._q('font-weight');
      const textColor = this._q('text-color');
      const outlineColor = this._q('outline-color');
      const backgroundColor = this._q('background-color');
      const outlineWidth = this._q('outline-width');
      const backgroundOpacity = this._q('background-opacity');
      const position = this._q('position');
      const shadowEnabled = this._q('shadow-enabled');
      const shadowColor = this._q('shadow-color');
      const shadowOpacity = this._q('shadow-opacity');
      const shadowBlur = this._q('shadow-blur');
      const shadowOffsetX = this._q('shadow-offset-x');
      const shadowOffsetY = this._q('shadow-offset-y');
      return {
        fontSize: fontSize ? Number(fontSize.value) : 24,
        color: textColor ? textColor.value : '#ffffff',
        fontWeight: fontWeight ? Number(fontWeight.value) : 600,
        outlineColor: outlineColor ? outlineColor.value : '#000000',
        backgroundColor: backgroundColor ? backgroundColor.value : '#000000',
        outlineWidth: outlineWidth ? Number(outlineWidth.value) : 2,
        backgroundOpacity: backgroundOpacity
          ? Number(backgroundOpacity.value) / 100
          : 0.7,
        position: position ? Number(position.value) : 90,
        shadowEnabled: shadowEnabled ? shadowEnabled.checked : true,
        shadowColor: shadowColor ? shadowColor.value : '#000000',
        shadowOpacity: shadowOpacity
          ? Number(shadowOpacity.value) / 100
          : 0.55,
        shadowBlur: shadowBlur ? Number(shadowBlur.value) : 4,
        shadowOffsetX: shadowOffsetX ? Number(shadowOffsetX.value) : 0,
        shadowOffsetY: shadowOffsetY ? Number(shadowOffsetY.value) : 2,
        overrideAss: Boolean(
          this._q('override-ass') && this._q('override-ass').checked
        )
      };
    }

    _syncAppearanceOutputs(appearance) {
      const fontOut = this._q('font-size-out');
      const outlineOut = this._q('outline-width-out');
      const backgroundOut = this._q('background-opacity-out');
      const positionOut = this._q('position-out');
      const shadowOpacityOut = this._q('shadow-opacity-out');
      const shadowBlurOut = this._q('shadow-blur-out');
      const shadowXOut = this._q('shadow-offset-x-out');
      const shadowYOut = this._q('shadow-offset-y-out');
      const signed = function (value) {
        return (value > 0 ? '+' : '') + value + 'px';
      };
      if (fontOut) fontOut.textContent = appearance.fontSize + 'px';
      if (outlineOut) outlineOut.textContent = appearance.outlineWidth + 'px';
      if (backgroundOut) {
        backgroundOut.textContent =
          Math.round(appearance.backgroundOpacity * 100) + '%';
      }
      if (positionOut) positionOut.textContent = appearance.position + '%';
      if (shadowOpacityOut) {
        shadowOpacityOut.textContent =
          Math.round(appearance.shadowOpacity * 100) + '%';
      }
      if (shadowBlurOut) shadowBlurOut.textContent = appearance.shadowBlur + 'px';
      if (shadowXOut) {
        shadowXOut.textContent = signed(appearance.shadowOffsetX);
      }
      if (shadowYOut) {
        shadowYOut.textContent = signed(appearance.shadowOffsetY);
      }
    }

    _updateShadowControls(enabled) {
      const panel = this._q('shadow-panel');
      if (panel) panel.classList.toggle('is-disabled', !enabled);
      for (const role of [
        'shadow-color',
        'shadow-opacity',
        'shadow-blur',
        'shadow-offset-x',
        'shadow-offset-y'
      ]) {
        const input = this._q(role);
        if (input) input.disabled = !enabled;
      }
    }

    _renderAppearancePreview(appearance) {
      const preview = this._q('cue-preview-text');
      if (!preview) return;
      const style = SettingsModel.buildPreviewStyle(appearance);
      preview.style.color = style.color;
      preview.style.fontSize = style.fontSize;
      preview.style.fontWeight = style.fontWeight;
      preview.style.lineHeight = style.lineHeight;
      preview.style.textAlign = style.textAlign;
      preview.style.backgroundColor = style.backgroundColor;
      preview.style.textShadow = style.textShadow;
      this._syncAppearanceOutputs(appearance);
      this._updateShadowControls(appearance.shadowEnabled !== false);
    }

    setAppearance(appearance) {
      const value = SettingsModel.sanitizeAppearance(appearance);
      const controls = {
        'font-size': value.fontSize,
        'font-weight': value.fontWeight,
        'text-color': value.color,
        'outline-color': value.outlineColor,
        'background-color': value.backgroundColor,
        'outline-width': value.outlineWidth,
        'background-opacity': Math.round(value.backgroundOpacity * 100),
        position: value.position,
        'shadow-color': value.shadowColor,
        'shadow-opacity': Math.round(value.shadowOpacity * 100),
        'shadow-blur': value.shadowBlur,
        'shadow-offset-x': value.shadowOffsetX,
        'shadow-offset-y': value.shadowOffsetY
      };
      for (const [role, controlValue] of Object.entries(controls)) {
        const input = this._q(role);
        if (input) input.value = String(controlValue);
      }
      const shadowEnabled = this._q('shadow-enabled');
      if (shadowEnabled) shadowEnabled.checked = value.shadowEnabled;
      const overrideAss = this._q('override-ass');
      if (overrideAss) overrideAss.checked = value.overrideAss;
      this._renderAppearancePreview(value);
    }

    _onAppearanceInput(event) {
      if (!this._isAppearanceControl(event.target)) return;
      const role = event.target.getAttribute('data-role');
      if (role === 'shadow-enabled') {
        this._updateShadowControls(Boolean(event.target.checked));
      }
      const appearance = this._collectAppearance();
      this._renderAppearancePreview(appearance);
      if (role === 'position' && this.callbacks.onPositionPreview) {
        this.callbacks.onPositionPreview(Number(event.target.value));
      }
    }

    _onAppearanceCommit(event) {
      if (!this._isAppearanceControl(event.target)) return;
      if (event.target.getAttribute('data-role') === 'shadow-enabled') {
        this._updateShadowControls(Boolean(event.target.checked));
      }
      if (this.callbacks.onAppearanceChange) {
        this.callbacks.onAppearanceChange(this._collectAppearance());
      }
    }

    _onHeaderPointerDown(event) {
      if (event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest('button')) {
        return;
      }
      const rect = this.host.getBoundingClientRect();
      this.drag = {
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top
      };
      this.host.style.left = rect.left + 'px';
      this.host.style.top = rect.top + 'px';
      this.host.style.right = 'auto';
      this.host.style.bottom = 'auto';
      root.addEventListener('pointermove', this._onDragMove);
      root.addEventListener('pointerup', this._onDragEnd, { once: true });
      root.addEventListener('pointercancel', this._onDragEnd, { once: true });
      event.preventDefault();
    }

    _onDragMove(event) {
      if (!this.drag) return;
      const left = this.drag.left + (event.clientX - this.drag.startX);
      const top = this.drag.top + (event.clientY - this.drag.startY);
      const clamped = this._clamp(left, top);
      this.host.style.left = clamped.left + 'px';
      this.host.style.top = clamped.top + 'px';
    }

    _onDragEnd() {
      this.drag = null;
      root.removeEventListener('pointermove', this._onDragMove);
      root.removeEventListener('pointerup', this._onDragEnd);
      root.removeEventListener('pointercancel', this._onDragEnd);
    }

    _clamp(left, top) {
      const width = this.host.offsetWidth || PANEL_WIDTH;
      const height = this.host.offsetHeight || 100;
      const maxLeft = Math.max(EDGE_GAP, root.innerWidth - width - EDGE_GAP);
      const maxTop = Math.max(EDGE_GAP, root.innerHeight - height - EDGE_GAP);
      return {
        left: Math.min(maxLeft, Math.max(EDGE_GAP, left)),
        top: Math.min(maxTop, Math.max(EDGE_GAP, top))
      };
    }

    _onViewportResize() {
      if (!this.host || this.host.hidden) return;
      if (this.host.style.left && this.host.style.left !== 'auto') {
        const rect = this.host.getBoundingClientRect();
        const clamped = this._clamp(rect.left, rect.top);
        this.host.style.left = clamped.left + 'px';
        this.host.style.top = clamped.top + 'px';
      }
    }

    _onFullscreenChange() {
      this._appendHost();
    }

    _onKeyDown(event) {
      if (event.key === 'Escape') {
        this.hide();
      }
    }

    toggleCollapsed() {
      if (!this.panel) return;
      const collapsed = this.panel.classList.toggle('collapsed');
      const button = this._action('collapse');
      if (button) {
        button.textContent = collapsed ? '+' : '−';
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        button.setAttribute('title', collapsed ? '展开面板' : '折叠面板');
        button.setAttribute('aria-label', collapsed ? '展开面板' : '折叠面板');
      }
      this.host.style.width = collapsed
        ? 'min(' + COLLAPSED_WIDTH + 'px, calc(100vw - 24px))'
        : 'min(' + PANEL_WIDTH + 'px, calc(100vw - 24px))';
      this._onViewportResize();
    }

    show() {
      if (!this.host) return;
      this.host.hidden = false;
      this._appendHost();
      this._onViewportResize();
    }

    isVisible() {
      return Boolean(this.host && !this.host.hidden);
    }

    hide() {
      if (!this.host) return;
      this.host.hidden = true;
    }

    toggle() {
      if (!this.host) return;
      if (this.host.hidden) this.show();
      else this.hide();
    }

    setVideos(entries, selectedId) {
      if (!this.shadow) return;
      const select = this._q('video-select');
      const hint = this._q('video-hint');
      const list = Array.isArray(entries) ? entries : [];
      const signature = list
        .map(function (entry) {
          return entry.id + ':' + entry.label;
        })
        .join('|');

      if (signature !== this._videoSignature) {
        this._videoSignature = signature;
        select.textContent = '';
        if (list.length === 0) {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = '未检测到 HTML5 视频';
          select.appendChild(option);
        } else {
          for (const entry of list) {
            const option = document.createElement('option');
            option.value = entry.id;
            option.textContent = entry.label;
            select.appendChild(option);
          }
        }
      }

      select.disabled = list.length === 0;
      if (list.length === 0) {
        select.value = '';
        if (hint) {
          hint.textContent =
            '未找到 video 元素。该网页可能使用 iframe、Shadow DOM、Canvas 或 DRM 播放器。';
        }
      } else {
        const hasSelected = list.some(function (entry) {
          return entry.id === selectedId;
        });
        select.value = hasSelected ? selectedId : list[0].id;
        if (hint) {
          hint.textContent =
            list.length > 1
              ? '检测到 ' + list.length + ' 个视频，请选择要显示字幕的目标。'
              : '已检测到 HTML5 视频。若播放器由 iframe 加载，当前阶段无法访问。';
        }
      }
    }

    setVideoHint(text) {
      const hint = this._q('video-hint');
      if (hint && text) hint.textContent = text;
    }

    setMovieInfo(info) {
      const element = this._q('movie-info');
      if (!element) return;
      if (!info || !info.title || Number(info.confidence) < 0.5) {
        element.textContent = '';
        element.classList.add('is-hidden');
        return;
      }

      const parts = [];
      if (info.year) parts.push(String(info.year));
      if (info.durationMs) parts.push(Timing.formatClock(info.durationMs));
      if (info.season || info.episode) {
        parts.push(
          'S' + String(info.season || 0).padStart(2, '0') +
            'E' + String(info.episode || 0).padStart(2, '0')
        );
      }
      if (info.language) parts.push(info.language);
      const confidence =
        info.confidence >= 0.7 ? '较高' : info.confidence >= 0.45 ? '中' : '低';
      parts.push('识别度 ' + confidence);

      element.textContent = '';
      const prefix = document.createTextNode('自动识别：');
      const title = document.createElement('strong');
      title.textContent = String(info.title).slice(0, 80);
      element.appendChild(prefix);
      element.appendChild(title);
      element.appendChild(
        document.createTextNode(
          (parts.length ? ' · ' + parts.join(' · ') : '') +
            (confidence === '低' ? ' · 建议手动确认' : '')
        )
      );
      element.title = '仅在本机读取页面元数据，不会上传；用于后续字幕匹配。';
      element.classList.remove('is-hidden');
    }

    setSubtitleInfo(info) {
      const section = this._q('subtitle-section');
      if (!section) return;
      if (!info) {
        section.classList.add('is-hidden');
        this._q('warning').classList.add('is-hidden');
        return;
      }

      section.classList.remove('is-hidden');
      this._q('file-name').textContent = info.fileName || '本地字幕';
      this._q('format-tag').textContent = String(info.format || '').toUpperCase();
      this._q('cue-count').textContent = (info.cueCount || 0) + ' 条字幕';
      this._q('duration').textContent =
        '结尾 ' + Timing.formatClock(info.durationMs || 0);

      const warning = this._q('warning');
      if (info.warningText) {
        warning.textContent = info.warningText;
        warning.classList.remove('is-hidden');
      } else {
        warning.textContent = '';
        warning.classList.add('is-hidden');
      }
    }

    setFirstLineStatus(text, tone) {
      const node = this._q('first-line-status');
      if (!node) return;
      node.textContent = text || '';
      node.className = 'first-line-status' + (tone ? ' ' + tone : '');
    }

    setAnchorResults(results, message) {
      const list = this._q('anchor-results');
      const selected = this._q('anchor-selected');
      const apply = this._q('anchor-apply');
      if (!list) return;
      list.replaceChildren();
      if (selected) {
        selected.textContent = '';
        selected.classList.add('is-hidden');
      }
      if (apply) apply.disabled = true;
      if (!results || !results.length) {
        this.setAnchorStatus(message || '没有匹配的台词，试试更短的片段。', 'warn');
        return;
      }
      for (const result of results) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'anchor-result';
        button.setAttribute('data-action', 'select-anchor');
        button.setAttribute('data-cue-index', String(result.cueIndex));
        const time = document.createElement('time');
        time.textContent = Timing.formatClock(result.startMs);
        const text = document.createElement('span');
        text.textContent = String(result.text || '').replace(/\s+/g, ' ').trim();
        button.append(time, text);
        list.append(button);
      }
      this.setAnchorStatus(
        message || '找到 ' + results.length + ' 条，先选中正确的一句。',
        ''
      );
    }

    setAnchorSelected(result, preview, videoTimeMs) {
      const selected = this._q('anchor-selected');
      const apply = this._q('anchor-apply');
      if (!selected || !apply || !result) return;
      let text =
        Timing.formatClock(result.startMs) +
        '  ' +
        String(result.text || '').replace(/\s+/g, ' ').trim();
      if (preview && preview.ok) {
        text +=
          '  · 当前 ' +
          Timing.formatClock(videoTimeMs) +
          ' → 建议 ' +
          OffsetModel.formatOffset(preview.offsetMs);
      }
      selected.textContent = text;
      selected.classList.remove('is-hidden');
      apply.disabled = !(preview && preview.ok);
      if (preview && preview.ok) {
        this.setAnchorStatus('确认无误后点击「以当前时间对齐」。', 'ok');
      } else {
        this.setAnchorStatus('请先选择视频并暂停在对应台词。', 'warn');
      }
    }

    setAnchorStatus(text, tone) {
      const node = this._q('anchor-status');
      if (!node) return;
      node.textContent = text || '';
      node.className = 'anchor-status' + (tone ? ' ' + tone : '');
    }

    clearAnchor() {
      const list = this._q('anchor-results');
      const selected = this._q('anchor-selected');
      const apply = this._q('anchor-apply');
      if (list) list.replaceChildren();
      if (selected) {
        selected.textContent = '';
        selected.classList.add('is-hidden');
      }
      if (apply) apply.disabled = true;
      this.setAnchorStatus('', '');
    }

    setOffset(offsetMs, canUndo) {
      const value = Number(offsetMs) || 0;
      const label = this._q('offset-label');
      const input = this._q('offset-input');
      if (label) {
        label.textContent = OffsetModel.formatOffset(value);
        label.classList.toggle('positive', value > 0);
        label.classList.toggle('negative', value < 0);
      }
      if (input && this.shadow.activeElement !== input) {
        input.value = String(value);
      }
      const undo = this._action('undo');
      if (undo) undo.disabled = !canUndo;
    }

    setEstimate(result) {
      const text = this._q('estimate-result');
      const apply = this._action('apply-estimate');
      if (!text || !apply) return;
      if (!result || !result.ok) {
        text.classList.add('is-hidden');
        apply.classList.add('is-hidden');
        return;
      }
      const confidence = result.confidence === 'high' ? '高' : result.confidence === 'medium' ? '中' : '低';
      const warning =
        result.warnings && result.warnings.length
          ? ' · ' + result.warnings[0]
          : '';
      let detail = '';
      if (Number.isInteger(result.validWindows) && Number.isInteger(result.totalWindows)) {
        detail =
          ' · ' +
          result.validWindows +
          '/' +
          result.totalWindows +
          ' 窗口';
      }
      if (Number.isInteger(result.madMs)) detail += ' · MAD ' + result.madMs + 'ms';
      text.textContent =
        '建议 ' +
        OffsetModel.formatOffset(result.offsetMs) +
        ' · ' +
        confidence +
        '置信度' +
        detail +
        warning;
      text.className =
        'estimate-result' + (confidence === '低' ? ' low' : confidence === '高' ? ' high' : '');
      apply.classList.remove('is-hidden');
    }

    clearEstimate() {
      const text = this._q('estimate-result');
      const apply = this._action('apply-estimate');
      if (text) {
        text.textContent = '';
        text.classList.add('is-hidden');
      }
      if (apply) apply.classList.add('is-hidden');
    }

    setAudioDiagnostics(result) {
      const details = this._q('audio-diagnostics');
      const text = this._q('audio-diagnostics-text');
      if (!details || !text) return;
      if (!result) {
        details.classList.add('is-hidden');
        text.textContent = '';
        return;
      }
      const data = result.diagnostics || result;
      const lines = [];
      lines.push('code=' + (result.code || 'OK'));
      lines.push('message=' + (result.message || result.reasons || ''));
      lines.push('MAD(median)=' + (data.madMs != null ? data.madMs + 'ms' : 'n/a'));
      lines.push(
        'targetResidualMad=' +
          (data.targetResidualMadMs != null ? data.targetResidualMadMs + 'ms' : 'n/a')
      );
      lines.push(
        'medianOffset=' +
          (data.medianOffsetMs != null ? data.medianOffsetMs + 'ms' : 'n/a')
      );
      lines.push(
        'validWindows=' +
          (data.validWindows != null ? data.validWindows : 'n/a') +
          '/' +
          (data.totalWindows != null ? data.totalWindows : 'n/a')
      );
      if (data.global) {
        if (data.global.ok) {
          lines.push(
            'global=' +
              data.global.offsetMs +
              'ms score=' +
              data.global.score +
              ' margin=' +
              data.global.margin +
              ' secondDistinct=' +
              (data.global.secondDistinctPeakOffsetMs != null
                ? data.global.secondDistinctPeakOffsetMs
                : 'n/a')
          );
        } else {
          lines.push('global=' + data.global.code + ' ' + (data.global.message || ''));
        }
      }
      if (data.consensus) {
        lines.push(
          'consensus=' +
            data.consensus.offsetMs +
            'ms support=' +
            data.consensus.support +
            '/' +
            data.consensus.totalWindows +
            ' medianScore=' +
            data.consensus.medianScore +
            ' second=' +
            (data.consensus.secondOffsetMs != null
              ? data.consensus.secondOffsetMs
              : 'n/a')
        );
      }
      const windows = data.windows || [];
      for (const item of windows) {
        lines.push(
          'Window ' +
            (item.index + 1) +
            ': media=' +
            Math.round(item.startMs / 1000) +
            's' +
            (item.audioSampleStartMs != null
              ? ' audio=' +
                Math.round(item.audioSampleStartMs / 1000) +
                '-' +
                Math.round(item.audioSampleEndMs / 1000) +
                's'
              : '') +
            ' offset=' +
            (item.offsetMs != null ? item.offsetMs : item.value) +
            'ms best=' +
            (item.bestPeakOffsetMs != null ? item.bestPeakOffsetMs : item.offsetMs) +
            's2=' +
            (item.secondDistinctPeakOffsetMs != null
              ? item.secondDistinctPeakOffsetMs
              : 'n/a') +
            ' score=' +
            item.score +
            ' second=' +
            (item.secondScore != null ? item.secondScore : 'n/a') +
            ' margin=' +
            item.margin +
            ' dmargin=' +
            (item.distinctMargin != null ? item.distinctMargin : 'n/a') +
            ' active=' +
            Math.round((item.activeRatio || 0) * 100) +
            '% cue=' +
            Math.round((item.cueActivityRatio || 0) * 100) +
            '% boundary=' +
            (item.searchBoundaryHit ? 'yes' : 'no') +
            ' discontinuity=' +
            (item.mediaTimeDiscontinuity ? 'yes' : 'no')
        );
      }
      for (const item of data.rejected || []) {
        lines.push(
          'Rejected Window ' +
            (item.index + 1) +
            ': ' +
            (item.rejectReason || item.code) +
            ' ' +
            (item.offsetMs != null ? 'offset=' + item.offsetMs + 'ms ' : '') +
            (item.secondDistinctPeakOffsetMs != null
              ? 'secondDistinct=' + item.secondDistinctPeakOffsetMs + 'ms '
              : '') +
            (item.score != null ? 'score=' + item.score + ' ' : '') +
            (item.margin != null ? 'margin=' + item.margin + ' ' : '') +
            (item.message || '')
        );
      }
      text.textContent = lines.join('\\n');
      details.classList.remove('is-hidden');
    }

    clearAudioDiagnostics() {
      const details = this._q('audio-diagnostics');
      const text = this._q('audio-diagnostics-text');
      if (details) details.classList.add('is-hidden');
      if (text) text.textContent = '';
    }

    async _copyDiagnostics() {
      const text = this._q('audio-diagnostics-text');
      if (!text || !text.textContent) return;
      try {
        await navigator.clipboard.writeText(text.textContent);
        this.setAudioStatus('诊断信息已复制。', 'ok');
      } catch (error) {
        this.setAudioStatus('复制失败，请手动选择诊断文本。', 'warn');
      }
    }

    setAudioStatus(text, tone) {
      const node = this._q('audio-status');
      if (!node) return;
      node.textContent = text || '';
      node.className = tone || '';
    }

    setEnabled(enabled) {
      const input = this._q('enabled');
      if (input) input.checked = Boolean(enabled);
    }

    setStatus(text, tone) {
      const status = this._q('status');
      const textNode = this._q('status-text');
      if (!status || !textNode) return;
      status.className =
        'status' + (tone ? ' ' + tone : '');
      textNode.textContent = text || '';
    }

    setBusy(busy) {
      if (!this.panel) return;
      this.panel.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    setError(error) {
      const box = this._q('error');
      if (!box) return;
      if (!error) {
        box.classList.add('is-hidden');
        return;
      }

      this._q('error-message').textContent =
        typeof error === 'string' ? error : error.message || '发生未知错误。';

      const detail = this._q('error-detail');
      const retry = this._action('retry');
      if (error && typeof error === 'object' && error.detail) {
        detail.textContent = error.detail;
        detail.classList.remove('is-hidden');
      } else {
        detail.textContent = '';
        detail.classList.add('is-hidden');
      }
      if (retry) {
        retry.classList.toggle(
          'is-hidden',
          Boolean(error && typeof error === 'object' && error.canRetry === false)
        );
      }
      box.classList.remove('is-hidden');
    }

    destroy() {
      if (!this._mounted) return;
      root.removeEventListener('resize', this._onViewportResize);
      document.removeEventListener('fullscreenchange', this._onFullscreenChange);
      root.removeEventListener('pointermove', this._onDragMove);
      root.removeEventListener('pointerup', this._onDragEnd);
      root.removeEventListener('pointercancel', this._onDragEnd);
      if (this.shadow) {
        this.shadow.removeEventListener('click', this._onClick);
        this.shadow.removeEventListener('keydown', this._onKeyDown);
        this.shadow.removeEventListener('input', this._onAppearanceInput);
        this.shadow.removeEventListener('change', this._onAppearanceCommit);
        this.shadow.removeEventListener('change', this._onMatchQueryChange);
      }
      if (this.host && this.host.parentNode) this.host.remove();
      this._mounted = false;
      this.host = null;
      this.shadow = null;
      this.panel = null;
    }
  }

  NS.content.PanelView = PanelView;
})(typeof globalThis !== 'undefined' ? globalThis : this);
