/*
 * Content-script application coordinator.
 *
 * Responsibilities:
 *  - own UI state (selected video, parsed document, offset history, enabled),
 *  - read local files and call pure parsers,
 *  - ask the track controller to attach generated WebVTT,
 *  - clean up when the page is unloaded or a video disappears.
 *
 * Phase 2A adds local appearance settings only. There is still no network code
 * and no host permission: subtitle files and settings stay on this machine.
 */
(function (root) {
  'use strict';

  // Defensive singleton: normal action clicks are guarded in the service worker,
  // but a double-click can race two injections.
  if (root.__SMART_SUBTITLE_APP__) {
    root.__SMART_SUBTITLE_APP__.showPanel();
    return;
  }

  const NS = root.SmartSubtitle;
  const DocumentModule = NS.subtitles.SubtitleDocument;
  const parseSubtitleFile = DocumentModule.parseSubtitleFile;
  const FileDecoder = NS.subtitles.FileDecoder;
  const ErrorApi = NS.subtitles.SubtitleError;
  const SubtitleError = ErrorApi.SubtitleError;
  const Timing = NS.subtitles.Timing;
  const OffsetModel = NS.alignment.OffsetModel;
  const OffsetEstimator = NS.alignment.OffsetEstimator;
  const AnchorSync = NS.alignment.AnchorSync;
  const FirstLine = NS.alignment.FirstLine;
  const AudioCalibrator = NS.content.AudioCalibrator.AudioCalibrator;
  const AudioAligner = NS.alignment.AudioAligner;
  const AudioSession = NS.alignment.AudioSession;
  const SettingsModel = NS.storage.SettingsModel;
  const SettingsStore = NS.storage.SettingsStore.SettingsStore;
  const SubtitleCacheClient = NS.storage.CacheClient.SubtitleCacheClient;
  const ProviderClient = NS.storage.ProviderClient.ProviderClient;
  const MetadataExtractor = NS.matching.MetadataExtractor;
  const CandidateRanker = NS.matching.CandidateRanker;
  const VideoDetector = NS.content.VideoDetector;
  const SubtitleTrackController = NS.content.SubtitleTrackController;
  const AssOverlay = NS.content.AssOverlay.AssOverlay;
  const CueStyleController = NS.content.CueStyleController;
  const PanelView = NS.content.PanelView;

  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_HISTORY = 50;

  function trimForUi(text, maxLength) {
    const value = String(text || '');
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength - 1) + '…';
  }

  class SmartSubtitleApp {
    constructor() {
      this.started = false;
      this.destroyed = false;
      this.didInitialScan = false;

      this.view = null;
      this.detector = null;
      this.trackController = null;
      this.assOverlay = null;

      this.entries = [];
      this.selectedId = null;
      this.selectedVideo = null;
      this.movieMetadata = null;

      this.matchQuery = { title: '', year: null, language: '' };
      this.cache = new SubtitleCacheClient();
      this.provider = new ProviderClient();
      this.localCandidates = [];
      this.cachedCandidates = [];
      this.providerCandidates = [];
      this.candidateResults = [];
      this.selectedCandidateId = null;
      this.candidateToken = 0;
      this.providerToken = 0;
      this.nextCandidateId = 1;

      this.subtitleDoc = null;
      this.fileName = '';
      this.offsetMs = 0;
      this.offsetHistory = [];
      this.enabled = true;
      this.warnings = [];
      this.lastShift = null;
      this.autoSuggestion = null;
      this.anchorResults = [];
      this.anchorSelected = null;
      this.audioCalibrator = null;
      this.audioCalibratorBusy = false;
      this.assMutedTracks = null;
      this.assTrackListener = null;

      this.settingsStore = new SettingsStore();
      this.settings = SettingsModel.createDefaultSettings();
      this.appearance = this.settings.appearance;
      this.settingsUnsubscribe = null;
      this.settingsLoaded = false;
      this.settingsSaveChain = Promise.resolve();
      this.cueStyle = new CueStyleController({
        appearance: this.appearance
      });

      this.loadToken = 0;
      this.renderToken = 0;
      this.retryAction = null;

      this._onPageHide = this._onPageHide.bind(this);
      this._onRuntimeMessage = this._onRuntimeMessage.bind(this);
    }

    start() {
      if (this.started) return;
      this.started = true;

      this.view = new PanelView({
        onFileSelected: (file) => {
          void this.loadFile(file);
        },
        onVideoSelected: (id) => {
          this.selectVideo(id);
        },
        onRescan: () => {
          this.rescan();
        },
        onReload: () => {
          this.reloadSubtitle();
        },
        onRemove: () => {
          this.removeSubtitle();
        },
        onOffsetSet: (value) => {
          this.applyOffset(value, { recordHistory: true });
        },
        onOffsetNudge: (delta) => {
          this.nudgeOffset(delta);
        },
        onUndoOffset: () => {
          this.undoOffset();
        },
        onResetOffset: () => {
          this.resetOffset();
        },
        onEstimateOffset: () => {
          this.estimateOffset();
        },
        onApplyEstimate: () => {
          this.applyAutoEstimate();
        },
        onSearchAnchor: (query) => {
          this.searchAnchor(query);
        },
        onSelectAnchor: (cueIndex) => {
          this.selectAnchor(cueIndex);
        },
        onApplyAnchor: () => {
          this.applyAnchor();
        },
        onAutoFirstLine: () => {
          void this.autoFirstLine();
        },
        onManualFirstLine: () => {
          this.manualFirstLine();
        },
        onProbeAudio: () => {
          void this.probeAudio();
        },
        onAudioCalibrate: () => {
          void this.calibrateAudio();
        },
        onTabAudioCalibrate: () => {
          void this.calibrateTabAudio();
        },
        onEnabledChange: (enabled) => {
          this.setEnabled(enabled);
        },
        onRetry: () => {
          this.retryLastAction();
        },
        onDismissError: () => {
          this.clearError();
        },
        onAppearanceChange: (appearance) => {
          this.updateAppearance(appearance);
        },
        onPositionPreview: (position) => {
          this.previewPosition(position);
        },
        onResetAppearance: () => {
          this.resetAppearance();
        },
        onOpenOptions: () => {
          this.openOptionsPage();
        },
        onMatchQueryChange: (query) => {
          this.updateMatchQuery(query);
        },
        onCandidateFilesSelected: (files) => {
          void this.readCandidateFiles(files);
        },
        onRankCandidates: () => {
          this.rankLocalCandidates();
        },
        onLoadLibrary: () => {
          void this.loadCachedCandidates();
        },
        onSearchProvider: () => {
          void this.searchProvider();
        },
        onUseDetectedMetadata: () => {
          this.useDetectedMetadata();
        },
        onUseCandidate: (id) => {
          void this.useCandidate(id);
        }
      });

      this.view.mount();
      this.view.show();
      this.view.setVideos([], null);
      this.view.setSubtitleInfo(null);
      this.view.setMovieInfo(null);
      this.view.setMatchQuery(this.matchQuery);
      this.view.setCandidates([], { status: '尚未选择候选字幕。' });
      this.view.setOffset(0, false);
      this.view.setEnabled(true);
      this.view.setAppearance(this.appearance);
      this.view.setStatus('正在检测页面中的 HTML5 视频…', 'busy');

      void this.initializeSettings();

      this.detector = new VideoDetector({
        onChange: (entries, best) => {
          this.handleVideosChanged(entries, best);
        }
      });
      this.detector.start();

      if (
        root.chrome &&
        root.chrome.runtime &&
        root.chrome.runtime.onMessage
      ) {
        root.chrome.runtime.onMessage.addListener(this._onRuntimeMessage);
      }
      root.addEventListener('pagehide', this._onPageHide);
    }

    async initializeSettings() {
      try {
        const loaded = await this.settingsStore.load();
        if (!this.started) return;
        this.settingsLoaded = true;
        this.applySettings(loaded, { persist: false });
        this.settingsUnsubscribe = this.settingsStore.subscribe((next) => {
          this.handleExternalSettings(next);
        });
      } catch (error) {
        if (!this.started) return;
        this.settingsLoaded = true;
        this.view.setStatus('读取外观设置失败，当前使用默认样式。', 'warn');
        console.warn('[本地字幕] 读取设置失败：', error);
      }
    }

    applySettings(settings, options) {
      const next = SettingsModel.sanitizeSettings(settings);
      this.settings = next;
      this.appearance = next.appearance;
      this.cueStyle.setAppearance(this.appearance);
      if (this.assOverlay) {
        this.assOverlay.setAppearance(this.appearance);
      }
      if (this.trackController) {
        this.trackController.setLinePosition(this.appearance.position);
      }
      if (this.view) this.view.setAppearance(this.appearance);
      if (this.subtitleDoc) this.refreshSubtitleCard();
      if (options && options.persist) {
        this.persistSettings();
      }
      return next;
    }

    previewPosition(position) {
      const value = SettingsModel.sanitizeAppearance(
        Object.assign({}, this.appearance, { position: position })
      ).position;
      if (this.trackController) {
        this.trackController.setLinePosition(value);
      }
    }

    persistSettings() {
      const snapshot = SettingsModel.sanitizeSettings(this.settings);
      this.settingsSaveChain = this.settingsSaveChain
        .then(() => this.settingsStore.save(snapshot))
        .catch((error) => {
          console.warn('[本地字幕] 保存设置失败：', error);
          if (this.started && this.view) {
            this.view.setStatus('外观已应用，但保存设置失败。', 'warn');
          }
        });
      return this.settingsSaveChain;
    }

    updateAppearance(patch) {
      const next = SettingsModel.sanitizeSettings({
        version: this.settings.version,
        appearance: Object.assign({}, this.appearance, patch || {})
      });
      if (SettingsModel.sameSettings(next, this.settings)) return;
      this.applySettings(next, { persist: true });
    }

    resetAppearance() {
      const defaults = SettingsModel.createDefaultSettings();
      this.updateAppearance(defaults.appearance);
      this.view.setStatus('字幕外观已恢复默认。', 'ok');
    }

    handleExternalSettings(next) {
      if (!this.started) return;
      if (SettingsModel.sameSettings(next, this.settings)) return;
      this.applySettings(next, { persist: false });
    }

    openOptionsPage() {
      const runtime =
        root.browser && root.browser.runtime
          ? root.browser.runtime
          : root.chrome && root.chrome.runtime;
      try {
        if (runtime && typeof runtime.openOptionsPage === 'function') {
          const result = runtime.openOptionsPage();
          if (result && typeof result.catch === 'function') {
            result.catch(() => {
              this.view.setStatus('当前环境无法打开扩展选项页。', 'warn');
            });
          }
          return;
        }
        if (runtime && runtime.sendMessage) {
          const result = runtime.sendMessage({
            type: 'SMART_SUBTITLE_OPEN_OPTIONS'
          });
          if (result && typeof result.catch === 'function') {
            result.catch(() => {
              this.view.setStatus('当前环境无法打开扩展选项页。', 'warn');
            });
          }
          return;
        }
      } catch (error) {
        // Fall through to the status message.
      }
      this.view.setStatus('当前环境无法打开扩展选项页。', 'warn');
    }

    handleVideosChanged(entries, best) {
      if (!this.started) return;
      this.entries = entries;

      let selected = entries.find((entry) => entry.id === this.selectedId);
      if (!selected) {
        selected = best || entries[0] || null;
      }

      const nextId = selected ? selected.id : null;
      const nextVideo = selected ? selected.video : null;
      const videoChanged = nextVideo !== this.selectedVideo;

      this.selectedId = nextId;
      this.view.setVideos(entries, nextId);

      if (videoChanged) {
        this.detachTrackController();
        this.selectedVideo = nextVideo;
        this.clearAutoSuggestion();
        this.resetMatchCandidates();

        if (nextVideo) {
          this.createTrackController();
          if (this.subtitleDoc) {
            void this.renderSubtitle('正在为新视频加载字幕…');
          } else {
            this.view.setStatus('已检测到视频，请选择 SRT、VTT 或 ASS 字幕。', 'ok');
          }
        } else if (this.subtitleDoc) {
          this.view.setStatus(
            '字幕已解析，但当前页面没有可用的视频。请等待视频加载后再试。',
            'warn'
          );
        } else {
          this.view.setStatus(
            '未检测到 HTML5 视频。iframe、Shadow DOM、Canvas 或 DRM 播放器可能不受支持。',
            'idle'
          );
        }
        this.refreshMovieMetadata({ updateQuery: true });
      } else if (
        this.selectedVideo &&
        (!this.movieMetadata || !this.movieMetadata.durationMs)
      ) {
        this.refreshMovieMetadata({ updateQuery: false });
      } else if (!this.didInitialScan) {
        if (nextVideo) {
          this.view.setStatus('已检测到视频，请选择 SRT、VTT 或 ASS 字幕。', 'ok');
        } else if (!this.subtitleDoc) {
          this.view.setStatus(
            '未检测到 HTML5 视频。iframe、Shadow DOM、Canvas 或 DRM 播放器可能不受支持。',
            'idle'
          );
        }
      }

      this.didInitialScan = true;
    }

    selectVideo(id) {
      const entry = this.entries.find((item) => item.id === id);
      if (!entry || entry.video === this.selectedVideo) return;

      this.clearError();
      this.detachTrackController();
      this.selectedId = entry.id;
      this.selectedVideo = entry.video;
      this.createTrackController();
      this.view.setVideos(this.entries, entry.id);
      this.resetMatchCandidates();
      this.refreshMovieMetadata({ updateQuery: true });

      if (this.subtitleDoc) {
        void this.renderSubtitle('正在切换目标视频…');
      } else {
        this.view.setStatus('已选择视频，请选择 SRT、VTT 或 ASS 字幕。', 'ok');
      }
    }

    refreshMovieMetadata(options) {
      const opts = options || {};
      if (!this.started || !this.view) return;
      if (!this.selectedVideo) {
        this.movieMetadata = null;
        this.view.setMovieInfo(null);
        if (opts.updateQuery) {
          this.matchQuery = { title: '', year: null, language: '' };
          this.view.setMatchQuery(this.matchQuery);
        }
        return;
      }
      try {
        const metadata = MetadataExtractor.extractFromDocument(
          document,
          this.selectedVideo
        );
        this.movieMetadata = metadata;
        this.view.setMovieInfo(metadata);
        if (opts.updateQuery) {
          this.matchQuery = {
            title: metadata.title || '',
            year: metadata.year || null,
            language: metadata.language || ''
          };
          this.view.setMatchQuery(this.matchQuery);
        }
      } catch (error) {
        this.movieMetadata = null;
        this.view.setMovieInfo(null);
        console.warn('[本地字幕] 影片元数据识别失败：', error);
      }
    }

    resetMatchCandidates() {
      this.candidateToken += 1;
      this.localCandidates = [];
      this.cachedCandidates = [];
      this.providerCandidates = [];
      this.candidateResults = [];
      this.selectedCandidateId = null;
      this.providerToken += 1;
      if (this.view) {
        this.view.setCandidates([], { status: '尚未选择候选字幕。' });
      }
    }

    updateMatchQuery(query) {
      const input = query || {};
      this.matchQuery = {
        title: String(input.title || '').trim(),
        year:
          Number.isFinite(Number(input.year)) && input.year
            ? Number(input.year)
            : null,
        language: input.language || ''
      };
      this.rankLocalCandidates();
    }

    useDetectedMetadata() {
      const metadata = this.movieMetadata;
      if (!metadata || !metadata.title) {
        this.view.setMatchStatus(
          '当前页面没有识别到可靠片名，请手动填写。',
          'warn'
        );
        return;
      }
      this.matchQuery = {
        title: metadata.title,
        year: metadata.year || null,
        language: metadata.language || ''
      };
      this.view.setMatchQuery(this.matchQuery);
      this.rankLocalCandidates();
    }

    rankLocalCandidates(options) {
      const opts = options || {};
      if (!this.view) return [];
      const candidates = this.localCandidates
        .concat(this.cachedCandidates)
        .concat(this.providerCandidates);
      if (!candidates.length) {
        this.view.setCandidates([], {
          status: opts.status || '尚未选择候选字幕。',
          tone: opts.tone
        });
        return [];
      }
      if (!this.matchQuery.title.trim()) {
        this.view.setCandidates([], {
          status: '请先填写或识别片名，再匹配候选字幕。',
          tone: 'warn'
        });
        return [];
      }

      const query = {
        title: this.matchQuery.title.trim(),
        year: this.matchQuery.year,
        durationMs: this.movieMetadata ? this.movieMetadata.durationMs : null,
        language: this.matchQuery.language || null,
        season: this.movieMetadata ? this.movieMetadata.season : null,
        episode: this.movieMetadata ? this.movieMetadata.episode : null
      };
      const results = CandidateRanker.rankCandidates(query, candidates);
      this.candidateResults = results;
      this.view.setCandidates(results, {
        selectedId: this.selectedCandidateId,
        errorCount: opts.errorCount || 0,
        status: opts.status,
        tone: opts.tone
      });
      return results;
    }

    async searchProvider() {
      if (!this.matchQuery.title.trim()) {
        this.view.setMatchStatus('请先填写或识别片名。', 'warn');
        return;
      }
      if (!this.provider.available) {
        this.view.setMatchStatus(
          '当前不是扩展环境，无法连接在线字幕来源。',
          'warn'
        );
        return;
      }
      const token = ++this.providerToken;
      this.view.setMatchStatus('正在搜索 OpenSubtitles…', '');
      try {
        const response = await this.provider.search({
          title: this.matchQuery.title.trim(),
          year: this.matchQuery.year,
          language: this.matchQuery.language,
          season: this.movieMetadata ? this.movieMetadata.season : null,
          episode: this.movieMetadata ? this.movieMetadata.episode : null,
          durationMs: this.movieMetadata ? this.movieMetadata.durationMs : null
        });
        if (token !== this.providerToken || !this.started) return;
        const candidates = Array.isArray(response.candidates)
          ? response.candidates
          : [];
        this.providerCandidates = candidates.map((candidate) =>
          Object.assign({}, candidate, {
            id: 'provider-' + (candidate.id || this.nextCandidateId++),
            fromProvider: true
          })
        );
        if (!this.providerCandidates.length) {
          this.view.setMatchStatus('OpenSubtitles 没有返回字幕。', 'warn');
          this.rankLocalCandidates({
            status: 'OpenSubtitles 没有返回字幕。',
            tone: 'warn'
          });
          return;
        }
        this.rankLocalCandidates({
          status:
            'OpenSubtitles 返回 ' +
            this.providerCandidates.length +
            ' 条结果。',
          tone: 'ok'
        });
      } catch (error) {
        if (token !== this.providerToken || !this.started) return;
        const message = error && error.message ? error.message : '未知错误';
        this.view.setMatchStatus(
          '在线搜索失败：' + message + ' 请在设置页检查 API Key 和域名权限。',
          'error'
        );
      }
    }

    async loadCachedCandidates() {
      try {
        this.view.setMatchStatus('正在读取字幕库…', '');
        const items = await this.cache.list(50);
        if (!items.length) {
          this.cachedCandidates = [];
          this.view.setMatchStatus(
            '字幕库为空。加载过一次字幕或候选后会自动缓存。',
            'warn'
          );
          this.rankLocalCandidates({ status: '字幕库为空。', tone: 'warn' });
          return;
        }
        this.cachedCandidates = items.map((item) => ({
          id: 'cache-' + item.id,
          cacheId: item.id,
          fileName: item.fileName,
          title:
            item.title ||
            MetadataExtractor.parseReleaseName(item.fileName || '').title ||
            item.fileName ||
            '缓存字幕',
          year: item.year || null,
          durationMs: null,
          language: item.language || null,
          format: item.format || '',
          cueCount: item.cueCount || 0,
          fromCache: true
        }));
        this.rankLocalCandidates({
          status: '已加载 ' + items.length + ' 条缓存字幕。',
          tone: 'ok'
        });
      } catch (error) {
        this.view.setMatchStatus(
          '字幕库读取失败：' +
            (error && error.message ? error.message : '未知错误'),
          'error'
        );
      }
    }

    async readCandidateFiles(files) {
      const list = Array.isArray(files) ? files.slice(0, 16) : [];
      if (!list.length) return;
      const token = ++this.candidateToken;
      const errors = [];
      const candidates = [];
      this.view.setCandidates([], {
        status: '正在读取 ' + list.length + ' 个候选字幕…'
      });

      for (const file of list) {
        if (token !== this.candidateToken || !this.started) return;
        try {
          const parsed = await this.readSubtitleFile(file);
          const release = MetadataExtractor.parseReleaseName(file.name);
          candidates.push({
            id: 'candidate-' + this.nextCandidateId,
            fileName: file.name,
            title: release.title || file.name.replace(/\.[^.]+$/u, ''),
            year: release.year || null,
            durationMs: null,
            language: release.language || null,
            format: parsed.doc.format,
            cueCount: parsed.doc.cueCount,
            doc: parsed.doc,
            text: parsed.text,
            warnings: parsed.warnings
          });
          this.nextCandidateId += 1;
        } catch (error) {
          errors.push({
            fileName: file.name,
            message: error && error.message ? error.message : '读取失败'
          });
        }
      }

      if (token !== this.candidateToken || !this.started) return;
      this.localCandidates = candidates;
      this.selectedCandidateId = null;
      if (!candidates.length) {
        this.view.setCandidates([], {
          status:
            '候选读取失败：' +
            (errors[0] ? errors[0].message : '没有可用的 SRT/VTT/ASS 文件。'),
          tone: 'error'
        });
        return;
      }
      this.rankLocalCandidates({
        errorCount: errors.length,
        status:
          '已读取 ' + candidates.length + ' 个候选' +
          (errors.length ? '，' + errors.length + ' 个失败' : '') + '。',
        tone: errors.length ? 'warn' : 'ok'
      });
    }

    async readSubtitleFile(file) {
      if (!file) {
        throw new SubtitleError('INVALID_INPUT', '没有选择字幕文件。');
      }
      if (file.size === 0) {
        throw new SubtitleError('EMPTY_FILE', '字幕文件为空。');
      }
      if (file.size > MAX_FILE_BYTES) {
        throw new SubtitleError(
          'FILE_TOO_LARGE',
          '字幕文件超过 8 MB。请确认文件选择正确，或拆分为较小的文件。'
        );
      }
      const buffer = await file.arrayBuffer();
      const decoded = FileDecoder.decode(buffer);
      const doc = parseSubtitleFile(file.name, decoded.text);
      return {
        doc,
        text: decoded.text,
        warnings: decoded.warnings.concat(doc.warnings)
      };
    }

    async applyParsedSubtitle(doc, fileName, warnings, reason, text, source) {
      this.clearAutoSuggestion();
      this.subtitleDoc = doc;
      this.fileName = fileName || '本地字幕';
      this.offsetMs = 0;
      this.offsetHistory = [];
      this.enabled = true;
      this.lastShift = null;
      this.warnings = warnings || [];
      this.clearError();
      this.refreshSubtitleCard();
      this.view.setOffset(0, false);
      this.view.setEnabled(true);
      this.view.setStatus('字幕解析完成，正在显示…', 'ok');
      if (text) {
        this.cacheSubtitle(text, this.fileName, doc, source);
      }

      if (this.selectedVideo) {
        await this.renderSubtitle(reason || '正在显示字幕…');
      } else {
        this.view.setStatus(
          '字幕已解析；当前没有视频。视频出现后会自动尝试显示。',
          'warn'
        );
      }
    }

    cacheSubtitle(text, fileName, doc, source) {
      if (!text || !fileName || !this.cache) return;
      const release = MetadataExtractor.parseReleaseName(fileName);
      const metadata = this.movieMetadata;
      this.cache
        .put({
          fileName,
          text,
          format: doc.format,
          cueCount: doc.cueCount,
          title:
            release.title ||
            (metadata && metadata.title ? metadata.title : fileName),
          year:
            release.year ||
            (metadata && metadata.year ? metadata.year : null),
          language:
            release.language ||
            (metadata && metadata.language ? metadata.language : null),
          source: source || 'local'
        })
        .catch((error) => {
          console.warn('[本地字幕] 写入字幕库失败：', error);
        });
    }

    async useCandidate(id) {
      const result = this.candidateResults.find(function (item) {
        return item.candidate && item.candidate.id === id;
      });
      if (!result) return;
      const candidate = result.candidate;
      const token = ++this.loadToken;
      this.selectedCandidateId = id;
      this.view.setBusy(true);
      this.view.setStatus('正在加载候选字幕…', 'busy');
      try {
        if (!candidate.doc && candidate.cacheId) {
          const entry = await this.cache.get(candidate.cacheId);
          if (!entry || !entry.text) {
            throw new SubtitleError(
              'CACHE_ENTRY_MISSING',
              '字幕库中的该条目已不存在，请重新选择文件。'
            );
          }
          candidate.doc = parseSubtitleFile(
            entry.fileName || candidate.fileName,
            entry.text
          );
          candidate.text = entry.text;
          candidate.warnings = candidate.doc.warnings;
          await this.cache.touch(candidate.cacheId).catch(function () {});
        }
        if (!candidate.doc && candidate.provider === 'opensubtitles') {
          const downloaded = await this.provider.download(candidate);
          candidate.fileName = downloaded.fileName || candidate.fileName;
          candidate.text = downloaded.text;
          candidate.doc = parseSubtitleFile(
            candidate.fileName,
            downloaded.text
          );
          candidate.warnings = candidate.doc.warnings;
        }
        await this.applyParsedSubtitle(
          candidate.doc,
          candidate.fileName,
          candidate.warnings,
          '正在显示候选字幕…',
          candidate.text,
          candidate.fromProvider
            ? 'opensubtitles'
            : candidate.fromCache
              ? 'cache'
              : 'candidate'
        );
        if (token !== this.loadToken || !this.started) return;
        this.view.setCandidates(this.candidateResults, {
          selectedId: id,
          status: '已选择候选：' + candidate.fileName,
          tone: 'ok'
        });
      } catch (error) {
        if (token !== this.loadToken || !this.started) return;
        this.showError(error, () => this.useCandidate(id));
        this.view.setStatus('候选字幕加载失败', 'error');
      } finally {
        if (token === this.loadToken) this.view.setBusy(false);
      }
    }

    rescan() {
      if (!this.detector) return;
      this.view.setStatus('正在重新扫描页面视频…', 'busy');
      this.detector.refresh(true);
    }

    async loadFile(file) {
      if (!file) return;
      const token = ++this.loadToken;
      this.clearError();
      this.view.setBusy(true);
      this.view.setStatus('正在读取“' + trimForUi(file.name, 34) + '”…', 'busy');

      try {
        const parsed = await this.readSubtitleFile(file);
        if (token !== this.loadToken || !this.started) return;
        this.selectedCandidateId = null;
        await this.applyParsedSubtitle(
          parsed.doc,
          file.name,
          parsed.warnings,
          '正在显示字幕…',
          parsed.text,
          'local'
        );
        if (this.candidateResults.length) {
          this.view.setCandidates(this.candidateResults, {
            selectedId: null,
            status: '已手动加载：' + file.name,
            tone: 'ok'
          });
        }
      } catch (error) {
        if (token !== this.loadToken || !this.started) return;
        this.showError(error, () => this.loadFile(file));
        this.view.setStatus('字幕加载失败', 'error');
      } finally {
        if (token === this.loadToken) {
          this.view.setBusy(false);
        }
      }
    }

    async renderSubtitle(reason) {
      if (!this.subtitleDoc) {
        this.showError(
          new SubtitleError('NO_SUBTITLE', '请先选择本地 SRT、VTT 或 ASS 字幕。'),
          null
        );
        return false;
      }
      if (!this.selectedVideo) {
        this.showError(
          new SubtitleError(
            'NO_VIDEO',
            '当前没有可用的 HTML5 视频。请先播放页面中的视频。'
          ),
          null
        );
        return false;
      }
      if (this.isAssDocument()) {
        return this.renderAssSubtitle(reason);
      }

      if (this.assOverlay) {
        this.detachAssOverlay();
      }
      if (
        !this.trackController ||
        this.trackController.video !== this.selectedVideo
      ) {
        this.createTrackController();
      }

      const token = ++this.renderToken;
      let generated;
      try {
        generated = this.subtitleDoc.toVtt(this.offsetMs, {
          linePercent: this.appearance.position
        });
      } catch (error) {
        this.showError(error, null);
        this.view.setStatus('无法应用时间偏移', 'error');
        return false;
      }

      this.lastShift = generated.shift;
      this.view.setBusy(true);
      this.view.setStatus(reason || '正在更新字幕…', 'busy');

      try {
        const result = await this.trackController.show(generated.vtt, {
          label: '本地字幕',
          enabled: this.enabled,
          lineManaged: generated.lineManaged
        });
        if (token !== this.renderToken || !this.started) return false;

        this.trackController.setLinePosition(this.appearance.position);
        this.clearError();
        this.cueStyle.attach(this.selectedVideo);
        this.refreshSubtitleCard();
        this.view.setOffset(this.offsetMs, this.offsetHistory.length > 0);
        this.view.setEnabled(this.enabled);
        this.view.setStatus(this.successStatus(result), 'ok');
        return true;
      } catch (error) {
        if (error && error.code === 'TRACK_ABORTED') return false;
        if (token !== this.renderToken || !this.started) return false;
        this.showError(error, () => this.renderSubtitle('正在重试加载字幕…'));
        this.view.setStatus('字幕显示失败', 'error');
        return false;
      } finally {
        if (token === this.renderToken) {
          this.view.setBusy(false);
        }
      }
    }

    isAssDocument() {
      return Boolean(
        this.subtitleDoc &&
          (this.subtitleDoc.format === 'ass' ||
            this.subtitleDoc.format === 'ssa')
      );
    }

    renderAssSubtitle(reason) {
      this.renderToken += 1;
      this.clearError();
      if (this.trackController) {
        this.trackController.destroy();
        this.trackController = null;
      }
      this.cueStyle.detach();
      this.mutePageTracks();
      if (!this.assOverlay || this.assOverlay.video !== this.selectedVideo) {
        this.detachAssOverlay();
        this.assOverlay = new AssOverlay(this.selectedVideo, {
          appearance: this.appearance
        });
      }
      let shift;
      try {
        shift = OffsetModel.shiftCues(this.subtitleDoc.cues, this.offsetMs);
      } catch (error) {
        this.showError(error, null);
        this.view.setStatus('无法应用时间偏移', 'error');
        return false;
      }
      if (!shift.cues.length) {
        this.showError(
          new SubtitleError(
            'OFFSET_DROPS_ALL',
            '该偏移会把所有字幕移出视频时间轴，请减小偏移量。'
          ),
          null
        );
        this.view.setStatus('无法应用时间偏移', 'error');
        return false;
      }
      this.lastShift = shift;
      this.assOverlay.show(this.subtitleDoc, {
        offsetMs: this.offsetMs,
        enabled: this.enabled
      });
      this.refreshSubtitleCard();
      this.view.setOffset(this.offsetMs, this.offsetHistory.length > 0);
      this.view.setEnabled(this.enabled);
      this.view.setBusy(false);
      this.view.setStatus(
        reason && !this.enabled
          ? 'ASS 字幕已加载，显示已关闭。'
          : this.assStatus(),
        this.enabled ? 'ok' : 'idle'
      );
      return true;
    }

    assStatus() {
      const parts = [];
      parts.push(this.enabled ? 'ASS 字幕已显示' : 'ASS 字幕已加载，显示已关闭');
      parts.push(
        this.offsetMs === 0
          ? '原始时间轴'
          : '偏移 ' + OffsetModel.formatOffset(this.offsetMs)
      );
      parts.push(this.subtitleDoc.cueCount + ' 条');
      if (this.lastShift && this.lastShift.dropped > 0) {
        parts.push('移出 ' + this.lastShift.dropped + ' 条');
      }
      if (this.lastShift && this.lastShift.clamped > 0) {
        parts.push('起点归零 ' + this.lastShift.clamped + ' 条');
      }
      return parts.join(' · ');
    }

    successStatus(result) {
      const parts = [];
      parts.push(this.enabled ? '字幕已显示' : '字幕已加载，显示已关闭');
      parts.push(
        this.offsetMs === 0
          ? '原始时间轴'
          : '偏移 ' + OffsetModel.formatOffset(this.offsetMs)
      );
      parts.push((result && result.cueCount ? result.cueCount : 0) + ' 条');

      if (this.lastShift && this.lastShift.dropped > 0) {
        parts.push('移出 ' + this.lastShift.dropped + ' 条');
      }
      if (this.lastShift && this.lastShift.clamped > 0) {
        parts.push('起点归零 ' + this.lastShift.clamped + ' 条');
      }
      return parts.join(' · ');
    }

    async probeAudio() {
      if (!this.selectedVideo) {
        this.view.setStatus('请先选择视频，再检测音频。', 'warn');
        return;
      }
      if (!this.audioCalibrator || this.audioCalibrator.video !== this.selectedVideo) {
        this.audioCalibrator = new AudioCalibrator(this.selectedVideo);
      }
      this.view.setAudioStatus('正在检测音频轨…', '');
      const result = await this.audioCalibrator.probe();
      if (!result.ok) {
        this.view.setAudioStatus(
          '不可分析：' + (result.message || '未知原因'),
          'warn'
        );
        return;
      }
      this.view.setAudioStatus(
        result.silent
          ? '音频轨存在，但当前静音；请播放有声音的片段。'
          : '音频可分析（RMS ' + result.rms.toFixed(3) + '）。',
        result.silent ? 'warn' : 'ok'
      );
    }

    async calibrateAudio() {
      if (!this.subtitleDoc) {
        this.view.setStatus('请先加载字幕，再做音频校准。', 'warn');
        return;
      }
      if (!this.selectedVideo) {
        this.view.setStatus('请先选择视频，再做音频校准。', 'warn');
        return;
      }
      if (this.selectedVideo.paused) {
        this.view.setStatus('请先播放视频，再做 8 秒音频校准。', 'warn');
        return;
      }
      if (this.audioCalibratorBusy) return;
      this.audioCalibratorBusy = true;
      if (!this.audioCalibrator || this.audioCalibrator.video !== this.selectedVideo) {
        this.audioCalibrator = new AudioCalibrator(this.selectedVideo);
      }
      this.view.setAudioStatus('正在采样 8 秒，请保持播放…', '');
      this.view.setStatus('正在做音频/字幕相关性校准…', 'busy');
      try {
        const result = await this.audioCalibrator.calibrate(
          this.subtitleDoc.cues
        );
        if (!result.ok) {
          this.view.setAudioStatus(
            '音频校准失败：' + (result.message || '未知错误'),
            'warn'
          );
          this.view.setStatus('音频校准失败，请手动校准。', 'warn');
          return;
        }
        this.autoSuggestion = result;
        this.view.setEstimate(result);
        this.view.setAudioStatus(
          '音频建议：' +
            OffsetModel.formatOffset(result.offsetMs) +
            ' · ' +
            (result.confidence === 'medium' ? '中' : '低') +
            '置信度',
          result.confidence === 'medium' ? 'ok' : 'warn'
        );
        this.view.setStatus(
          '音频/字幕相关性建议已生成；请确认后应用。',
          result.confidence === 'medium' ? 'ok' : 'warn'
        );
      } finally {
        this.audioCalibratorBusy = false;
      }
    }

    async calibrateTabAudio() {
      if (!this.subtitleDoc) {
        this.view.setStatus('请先加载字幕，再做标签页多窗口校准。', 'warn');
        return;
      }
      if (!this.selectedVideo) {
        this.view.setStatus('请先选择视频，再做标签页多窗口校准。', 'warn');
        return;
      }
      if (this.selectedVideo.paused) {
        this.view.setStatus('请先播放视频，再做约 40 秒多窗口校准。', 'warn');
        return;
      }
      const runtime = root.chrome && root.chrome.runtime;
      if (!runtime || !runtime.sendMessage) {
        this.view.setAudioStatus('当前不是扩展环境，无法捕获标签页音频。', 'warn');
        return;
      }
      if (this.audioCalibratorBusy) return;
      this.audioCalibratorBusy = true;
      const durationMs = 42000;
      const startMediaMs = this.selectedVideo.currentTime * 1000;
      const startRate = this.selectedVideo.playbackRate;
      this.view.clearAudioDiagnostics();
      this.view.setAudioStatus('正在采样 40 秒，请保持播放…', '');
      this.view.setStatus('正在做多窗口音频/字幕一致性校准…', 'busy');
      try {
        const response = await runtime.sendMessage({
          type: 'SMART_SUBTITLE_TAB_AUDIO_CALIBRATE',
          durationMs,
          startMediaMs
        });
        if (!response || response.ok !== true) {
          this.view.setAudioStatus(
            '标签页音频失败：' +
              (response && response.message ? response.message : '未知错误'),
            'warn'
          );
          this.view.setStatus('标签页音频校准失败，请改用手动校准。', 'warn');
          return;
        }
        const advanced = this.selectedVideo.currentTime * 1000 - startMediaMs;
        if (
          this.selectedVideo.paused ||
          this.selectedVideo.playbackRate !== startRate ||
          Math.abs(advanced - durationMs) > 4000
        ) {
          this.view.setAudioStatus(
            '采样期间发生暂停/拖动/倍速变化，窗口已丢弃，请重新校准。',
            'warn'
          );
          this.view.setStatus('音频采样时间映射无效，请重新校准。', 'warn');
          return;
        }
        const result = AudioSession.analyzeAudioSession(
          response.samples,
          this.subtitleDoc.cues,
          { windowMs: 8000, count: 5, maxOffsetMs: 15000 }
        );
        this.view.setAudioDiagnostics(result);
        if (!result.ok) {
          this.view.setAudioStatus(
            '多窗口校准失败：' + (result.message || '证据不足'),
            'warn'
          );
          this.view.setStatus('多窗口证据不足，请手动校准。', 'warn');
          return;
        }
        this.autoSuggestion = result;
        this.view.setEstimate(result);
        this.view.setAudioStatus(
          '多窗口建议：' +
            OffsetModel.formatOffset(result.offsetMs) +
            ' · ' +
            (result.confidence === 'high'
              ? '高'
              : result.confidence === 'medium'
                ? '中'
                : '低') +
            '置信度 · ' +
            result.validWindows +
            '/' +
            result.totalWindows +
            ' 窗口',
          result.confidence === 'low' ? 'warn' : 'ok'
        );
        this.view.setStatus(
          '多窗口音频建议已生成；请确认后应用。',
          result.confidence === 'low' ? 'warn' : 'ok'
        );
      } finally {
        this.audioCalibratorBusy = false;
      }
    }

    clearAutoSuggestion() {
      this.autoSuggestion = null;
      if (this.view) this.view.clearEstimate();
    }

    videoDurationMs() {
      const raw = this.selectedVideo ? this.selectedVideo.duration : NaN;
      if (Number.isFinite(raw) && raw > 0) return raw * 1000;
      if (
        this.movieMetadata &&
        Number.isFinite(this.movieMetadata.durationMs) &&
        this.movieMetadata.durationMs > 0
      ) {
        return this.movieMetadata.durationMs;
      }
      return null;
    }

    _firstCue() {
      return this.subtitleDoc && this.subtitleDoc.cues.length
        ? this.subtitleDoc.cues[0]
        : null;
    }

    _showFirstLineSuggestion(onset, firstCue, warnings, note) {
      const offset = FirstLine.offsetFromFirstLine(onset.onsetMs, firstCue.startMs);
      if (!offset.ok) {
        this.view.setFirstLineStatus(offset.message || '首句偏移无效。', 'warn');
        return;
      }
      this.autoSuggestion = {
        ok: true,
        offsetMs: offset.offsetMs,
        confidence: onset.confidence || 'low',
        warnings: warnings || [],
        reasons: [
          note +
            '：声音 ' +
            Timing.formatClock(onset.onsetMs) +
            '，首句 ' +
            Timing.formatClock(firstCue.startMs) +
            '。'
        ]
      };
      this.view.setEstimate(this.autoSuggestion);
      this.view.setFirstLineStatus(
        '首句建议 ' +
          OffsetModel.formatOffset(offset.offsetMs) +
          '；确认后点「应用建议」。' +
          (warnings && warnings.length ? ' ' + warnings[0] : ''),
        onset.confidence === 'medium' ? 'ok' : 'warn'
      );
    }

    async autoFirstLine() {
      const firstCue = this._firstCue();
      if (!firstCue) {
        this.view.setFirstLineStatus('请先加载字幕。', 'warn');
        return;
      }
      if (!this.selectedVideo) {
        this.view.setFirstLineStatus('请先选择视频。', 'warn');
        return;
      }
      if (this.selectedVideo.paused) {
        this.view.setFirstLineStatus('请从片头开始播放。', 'warn');
        return;
      }
      if (this.selectedVideo.currentTime > 2) {
        this.view.setFirstLineStatus('请先把视频回到开头，再检测首句。', 'warn');
        return;
      }
      if (firstCue.startMs > 30000) {
        this.view.setFirstLineStatus('首句在 30 秒之后，请改用手动首句。', 'warn');
        return;
      }
      const runtime = root.chrome && root.chrome.runtime;
      if (!runtime || !runtime.sendMessage) {
        this.view.setFirstLineStatus('当前不是扩展环境，无法捕获标签页音频。', 'warn');
        return;
      }
      if (this.audioCalibratorBusy) return;
      this.audioCalibratorBusy = true;
      const durationMs = 30000;
      const startMediaMs = this.selectedVideo.currentTime * 1000;
      const startRate = this.selectedVideo.playbackRate;
      this.view.setFirstLineStatus('正在捕获片头 30 秒音频，请保持播放…', '');
      try {
        const response = await runtime.sendMessage({
          type: 'SMART_SUBTITLE_TAB_AUDIO_CALIBRATE',
          durationMs,
          startMediaMs
        });
        if (!response || response.ok !== true) {
          this.view.setFirstLineStatus(
            '首句检测失败：' +
              (response && response.message ? response.message : '未知错误'),
            'warn'
          );
          return;
        }
        const advanced = this.selectedVideo.currentTime * 1000 - startMediaMs;
        if (
          this.selectedVideo.paused ||
          this.selectedVideo.playbackRate !== startRate ||
          Math.abs(advanced - durationMs) > 4000
        ) {
          this.view.setFirstLineStatus(
            '采样期间发生暂停/拖动/倍速变化，请重新检测。',
            'warn'
          );
          return;
        }
        const onset = FirstLine.detectFirstOnset(response.samples);
        if (!onset.ok) {
          this.view.setFirstLineStatus(onset.message || '没有检测到首句。', 'warn');
          return;
        }
        this._showFirstLineSuggestion(
          onset,
          firstCue,
          onset.warnings,
          '自动首句'
        );
      } finally {
        this.audioCalibratorBusy = false;
      }
    }

    manualFirstLine() {
      const firstCue = this._firstCue();
      if (!firstCue) {
        this.view.setFirstLineStatus('请先加载字幕。', 'warn');
        return;
      }
      if (!this.selectedVideo) {
        this.view.setFirstLineStatus('请先选择视频。', 'warn');
        return;
      }
      const onset = {
        onsetMs: this.selectedVideo.currentTime * 1000,
        confidence: 'low',
        warnings: ['手动标记会有约 0.2–0.5 秒反应延迟，可微调。']
      };
      this._showFirstLineSuggestion(onset, firstCue, onset.warnings, '手动首句');
      this.view.setFirstLineStatus(
        '已按当前时间计算首句偏移；请用毫秒按钮修正点击延迟。',
        'warn'
      );
    }

    searchAnchor(query) {
      if (!this.subtitleDoc) {
        this.view.setAnchorStatus('请先加载字幕，再使用台词锚点。', 'warn');
        return;
      }
      const results = AnchorSync.searchCues(this.subtitleDoc.cues, query);
      this.anchorResults = results;
      this.anchorSelected = null;
      if (!results.length) {
        this.view.setAnchorResults([], '没有匹配的台词，试试更短的片段。');
        return;
      }
      this.view.setAnchorResults(results);
      if (results.length === 1) {
        this.selectAnchor(results[0].cueIndex);
      }
    }

    selectAnchor(cueIndex) {
      const result = this.anchorResults.find(function (item) {
        return item.cueIndex === cueIndex;
      });
      if (!result) {
        this.view.setAnchorStatus('找不到这条台词，请重新查找。', 'warn');
        return;
      }
      if (!this.selectedVideo) {
        this.view.setAnchorStatus('请先选择视频，再对齐台词。', 'warn');
        return;
      }
      const videoTimeMs = this.selectedVideo.currentTime * 1000;
      const preview = AnchorSync.offsetForAnchor(videoTimeMs, result);
      this.anchorSelected = { result, preview };
      this.view.setAnchorSelected(result, preview, videoTimeMs);
    }

    applyAnchor() {
      if (!this.anchorSelected || !this.anchorSelected.result) {
        this.view.setAnchorStatus('先查找并选中一条台词。', 'warn');
        return;
      }
      if (!this.selectedVideo) {
        this.view.setAnchorStatus('请先选择视频。', 'warn');
        return;
      }
      const result = this.anchorSelected.result;
      const videoTimeMs = this.selectedVideo.currentTime * 1000;
      const preview = AnchorSync.offsetForAnchor(videoTimeMs, result);
      if (!preview.ok) {
        this.view.setAnchorStatus(preview.message || '锚点时间无效。', 'warn');
        return;
      }
      this.view.setAnchorStatus(
        '已按 ' +
          Timing.formatClock(videoTimeMs) +
          ' 对齐台词，偏移 ' +
          OffsetModel.formatOffset(preview.offsetMs) +
          '。',
        'ok'
      );
      this.applyOffset(preview.offsetMs, { recordHistory: true });
    }

    estimateOffset() {
      if (!this.subtitleDoc) {
        this.view.setStatus('请先加载字幕，再分析时间轴。', 'warn');
        return;
      }
      if (!this.selectedVideo) {
        this.view.setStatus('请先选择视频，再分析时间轴。', 'warn');
        return;
      }
      const durationMs = this.videoDurationMs();
      if (!durationMs) {
        this.view.setStatus(
          '无法获取视频时长，当前无法做自动分析；请手动调整偏移。',
          'warn'
        );
        this.view.clearEstimate();
        this.autoSuggestion = null;
        return;
      }
      const result = OffsetEstimator.estimateOffset(
        durationMs,
        this.subtitleDoc.cues,
        { currentOffset: this.offsetMs }
      );
      if (!result.ok) {
        this.view.setStatus(result.message || '自动分析失败。', 'warn');
        this.view.clearEstimate();
        this.autoSuggestion = null;
        return;
      }
      this.autoSuggestion = result;
      this.view.setEstimate(result);
      this.view.setStatus(
        '自动建议 ' +
          OffsetModel.formatOffset(result.offsetMs) +
          ' · ' +
          (result.confidence === 'medium' ? '中' : '低') +
          '置信度；确认后再应用。',
        result.confidence === 'medium' ? 'ok' : 'warn'
      );
    }

    applyAutoEstimate() {
      if (!this.autoSuggestion || !this.autoSuggestion.ok) {
        this.view.setStatus('没有可应用的自动建议。', 'warn');
        return;
      }
      const target = this.autoSuggestion.offsetMs;
      this.clearAutoSuggestion();
      if (target === this.offsetMs) {
        this.view.setStatus('当前偏移已经是自动建议值。', 'ok');
        return;
      }
      this.applyOffset(target, { recordHistory: true });
    }

    applyOffset(value, options) {
      this.clearAutoSuggestion();
      const recordHistory = !options || options.recordHistory !== false;
      let normalized;
      try {
        normalized = OffsetModel.normalizeOffset(value);
      } catch (error) {
        this.view.setOffset(this.offsetMs, this.offsetHistory.length > 0);
        this.showError(error, null);
        return;
      }

      if (!this.subtitleDoc) {
        this.view.setOffset(this.offsetMs, this.offsetHistory.length > 0);
        this.showError(
          new SubtitleError('NO_SUBTITLE', '请先选择本地 SRT、VTT 或 ASS 字幕，再调整偏移。'),
          null
        );
        return;
      }

      if (normalized === this.offsetMs) {
        this.view.setOffset(this.offsetMs, this.offsetHistory.length > 0);
        return;
      }

      this.clearError();
      if (recordHistory) {
        this.offsetHistory.push(this.offsetMs);
        if (this.offsetHistory.length > MAX_HISTORY) {
          this.offsetHistory.shift();
        }
      }

      this.offsetMs = normalized;
      this.view.setOffset(this.offsetMs, this.offsetHistory.length > 0);

      if (this.selectedVideo) {
        void this.renderSubtitle('正在应用时间偏移…');
      } else {
        this.view.setStatus(
          '偏移已设为 ' + OffsetModel.formatOffset(this.offsetMs) + '，等待视频。',
          'warn'
        );
      }
    }

    nudgeOffset(delta) {
      if (!this.subtitleDoc) {
        this.showError(
          new SubtitleError('NO_SUBTITLE', '请先选择本地 SRT、VTT 或 ASS 字幕，再调整偏移。'),
          null
        );
        return;
      }
      this.applyOffset(this.offsetMs + delta, { recordHistory: true });
    }

    undoOffset() {
      if (!this.offsetHistory.length || !this.subtitleDoc) return;
      this.offsetMs = this.offsetHistory.pop();
      this.view.setOffset(this.offsetMs, this.offsetHistory.length > 0);
      if (this.selectedVideo) {
        void this.renderSubtitle('正在撤销时间偏移…');
      } else {
        this.view.setStatus(
          '已恢复到 ' + OffsetModel.formatOffset(this.offsetMs) + '。',
          'warn'
        );
      }
    }

    resetOffset() {
      if (!this.subtitleDoc) {
        this.showError(
          new SubtitleError('NO_SUBTITLE', '请先选择本地 SRT、VTT 或 ASS 字幕。'),
          null
        );
        return;
      }
      if (this.offsetMs === 0) {
        this.view.setStatus('当前已经是原始时间轴。', 'ok');
        return;
      }

      this.offsetHistory.push(this.offsetMs);
      if (this.offsetHistory.length > MAX_HISTORY) {
        this.offsetHistory.shift();
      }
      this.offsetMs = 0;
      this.view.setOffset(0, this.offsetHistory.length > 0);
      if (this.selectedVideo) {
        void this.renderSubtitle('正在恢复原始时间轴…');
      } else {
        this.view.setStatus('已恢复原始时间轴，等待视频。', 'warn');
      }
    }

    reloadSubtitle() {
      if (!this.subtitleDoc) {
        this.showError(
          new SubtitleError('NO_SUBTITLE', '请先选择本地 SRT、VTT 或 ASS 字幕。'),
          null
        );
        return;
      }
      if (!this.selectedVideo) {
        this.showError(
          new SubtitleError('NO_VIDEO', '当前没有可用的视频。'),
          null
        );
        return;
      }
      void this.renderSubtitle('正在重新加载字幕轨道…');
    }

    removeSubtitle() {
      this.loadToken += 1;
      this.clearAutoSuggestion();
      this.detachTrackController();
      this.subtitleDoc = null;
      this.fileName = '';
      this.offsetMs = 0;
      this.offsetHistory = [];
      this.enabled = true;
      this.warnings = [];
      this.lastShift = null;
      this.selectedCandidateId = null;
      this.clearError();
      this.view.setBusy(false);
      this.view.setSubtitleInfo(null);
      if (this.candidateResults.length) {
        this.view.setCandidates(this.candidateResults, {
          selectedId: null,
          status: '字幕已移除，可重新选择候选。',
          tone: 'idle'
        });
      }
      this.view.setOffset(0, false);
      this.view.setEnabled(true);
      this.view.setStatus(
        this.selectedVideo
          ? '字幕已移除，可重新选择文件。'
          : '字幕已移除。',
        'idle'
      );
    }

    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      if (this.trackController) {
        this.trackController.setEnabled(this.enabled);
      }
      if (this.assOverlay) {
        this.assOverlay.setEnabled(this.enabled);
      }
      if (this.isAssDocument && this.isAssDocument()) {
        if (this.enabled) this.mutePageTracks();
        else this.restorePageTracks();
      }
      this.view.setEnabled(this.enabled);

      if (!this.subtitleDoc) {
        this.view.setStatus('请先选择 SRT、VTT 或 ASS 字幕。', 'idle');
        return;
      }
      if (this.isAssDocument()) {
        if (
          this.selectedVideo &&
          this.enabled &&
          (!this.assOverlay || !this.assOverlay.isActive)
        ) {
          void this.renderSubtitle('正在加载字幕…');
          return;
        }
        this.view.setStatus(
          this.enabled ? 'ASS 字幕显示已开启。' : 'ASS 字幕显示已关闭，文件仍保留。',
          this.enabled ? 'ok' : 'idle'
        );
        return;
      }
      if (
        this.selectedVideo &&
        (!this.trackController || !this.trackController.isActive)
      ) {
        void this.renderSubtitle('正在加载字幕…');
        return;
      }
      this.view.setStatus(
        this.enabled ? '字幕显示已开启。' : '字幕显示已关闭，文件仍保留。',
        this.enabled ? 'ok' : 'idle'
      );
    }

    createTrackController() {
      if (!this.selectedVideo) return;
      this.trackController = new SubtitleTrackController(this.selectedVideo, {
        label: '本地字幕',
        enabled: this.enabled
      });
    }

    mutePageTracks() {
      if (!this.selectedVideo || !this.selectedVideo.textTracks) return;
      if (this.assMutedTracks) return;
      this.assMutedTracks = new Map();
      for (const track of Array.from(this.selectedVideo.textTracks)) {
        this.assMutedTracks.set(track, track.mode);
        track.mode = 'disabled';
      }
    }

    restorePageTracks() {
      if (!this.assMutedTracks) return;
      for (const [track, mode] of this.assMutedTracks) {
        try {
          if (track && track.mode === 'disabled') track.mode = mode;
        } catch (error) {
          // The page may have removed the track.
        }
      }
      this.assMutedTracks = null;
      this.assTrackListener = null;
    }

    detachAssOverlay() {
      this.restorePageTracks();
      if (this.assOverlay) {
        this.assOverlay.destroy();
        this.assOverlay = null;
      }
    }

    detachTrackController() {
      this.renderToken += 1;
      this.cueStyle.detach();
      this.detachAssOverlay();
      if (this.trackController) {
        this.trackController.destroy();
        this.trackController = null;
      }
    }

    refreshSubtitleCard() {
      if (!this.subtitleDoc) {
        this.view.setSubtitleInfo(null);
        return;
      }
      let warningText = '';
      if (this.warnings.length > 0) {
        const first = this.warnings[0];
        warningText =
          '解析提示（' + this.warnings.length + '）：' +
          trimForUi(first.message, 120);
        if (this.warnings.length > 1) warningText += ' 等';
      }
      if (this.isAssDocument()) {
        const note = this.appearance.overrideAss
          ? 'ASS 外观覆盖已开启。'
          : 'ASS/SSA 使用文件内样式；如需调整，请在外观中勾选「应用到 ASS 字幕」。';
        warningText = warningText ? warningText + ' · ' + note : note;
      }
      this.view.setSubtitleInfo({
        fileName: this.fileName,
        format: this.subtitleDoc.format,
        cueCount: this.subtitleDoc.cueCount,
        durationMs: this.subtitleDoc.approximateDurationMs,
        warningText
      });
    }

    showError(error, retry) {
      this.retryAction = typeof retry === 'function' ? retry : null;
      const code = error && error.code ? String(error.code) : 'UNKNOWN';
      const line = error && Number.isInteger(error.line) ? error.line : null;
      const detail = '错误代码：' + code + (line ? ' · 第 ' + line + ' 行' : '') +
        (this.retryAction ? ' · 可点击重试' : '');
      this.view.setError({
        message: ErrorApi.getErrorMessage(error, '操作失败。'),
        detail,
        canRetry: Boolean(this.retryAction)
      });
    }

    clearError() {
      this.retryAction = null;
      this.view.setError(null);
    }

    retryLastAction() {
      const action = this.retryAction;
      this.clearError();
      if (!action) return;
      try {
        const result = action();
        if (result && typeof result.catch === 'function') {
          result.catch((error) => {
            if (!this.started) return;
            this.showError(error, action);
          });
        }
      } catch (error) {
        this.showError(error, action);
      }
    }

    showPanel() {
      if (this.view) this.view.show();
    }

    togglePanel() {
      if (this.view) this.view.toggle();
    }

    _onRuntimeMessage(message, sender, sendResponse) {
      if (!message || message.type !== 'SMART_SUBTITLE_TOGGLE') return false;
      this.togglePanel();
      sendResponse({
        ok: true,
        visible: this.view ? this.view.isVisible() : false
      });
      return false;
    }

    _onPageHide(event) {
      if (event && event.persisted) return;
      this.destroy();
    }

    destroy() {
      if (!this.started) return;
      this.started = false;
      this.destroyed = true;
      this.loadToken += 1;
      this.candidateToken += 1;
      this.detachTrackController();

      if (this.detector) {
        this.detector.destroy();
        this.detector = null;
      }
      if (
        root.chrome &&
        root.chrome.runtime &&
        root.chrome.runtime.onMessage
      ) {
        try {
          root.chrome.runtime.onMessage.removeListener(this._onRuntimeMessage);
        } catch (error) {
          // The extension may have been reloaded.
        }
      }
      root.removeEventListener('pagehide', this._onPageHide);
      if (this.settingsUnsubscribe) {
        this.settingsUnsubscribe();
        this.settingsUnsubscribe = null;
      }
      if (this.cueStyle) {
        this.cueStyle.destroy();
        this.cueStyle = null;
      }
      if (this.view) {
        this.view.destroy();
        this.view = null;
      }
      if (root.__SMART_SUBTITLE_APP__ === this) {
        root.__SMART_SUBTITLE_APP__ = null;
      }
    }
  }

  const app = new SmartSubtitleApp();
  root.__SMART_SUBTITLE_APP__ = app;
  try {
    app.start();
  } catch (error) {
    root.__SMART_SUBTITLE_APP__ = null;
    console.error('[本地字幕] 初始化失败：', error);
    throw error;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
