window.__ModuleLoader__.load({
  id: 'dsh-voice-input',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useEffect, useRef, useCallback } = React;

    const DEFAULT_CONFIG = {
      activeProviderId: 'default',
      providers: [
        {
          id: 'default',
          name: 'Default Engine',
          url: '',
          apiKey: '',
          model: 'gemini-3.8-flash-high'
        }
      ]
    };

    const STORAGE_KEY = 'dsh_voice_input_config_v2';

    function normalizeClientConfig(raw) {
      if (!raw || typeof raw !== 'object') {
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      }
      let providers = Array.isArray(raw.providers) ? raw.providers.filter(p => p && typeof p === 'object') : [];
      if (providers.length === 0) {
        providers = [
          {
            id: 'default',
            name: raw.name || 'Default Engine',
            url: raw.url || '',
            apiKey: raw.apiKey || '',
            model: raw.model || 'gemini-3.8-flash-high'
          }
        ];
      }
      let activeId = raw.activeProviderId || providers[0]?.id || 'default';
      if (!providers.some(p => p.id === activeId)) {
        activeId = providers[0]?.id || 'default';
      }
      return { activeProviderId: activeId, providers };
    }

    function loadSavedConfig() {
      try {
        const item = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem('dsh_voice_input_config');
        if (item) {
          const parsed = JSON.parse(item);
          return normalizeClientConfig(parsed);
        }
      } catch (e) {}
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }

    function saveConfig(cfg) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      } catch (e) {}
    }

    function getActiveProvider(cfg) {
      const norm = normalizeClientConfig(cfg);
      return norm.providers.find(p => p.id === norm.activeProviderId) || norm.providers[0];
    }

    function formatTime(seconds) {
      const s = Math.max(0, Math.floor(seconds));
      const mins = Math.floor(s / 60);
      const secs = s % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    async function convertToWavBlob(blob) {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return blob;
        const tempCtx = new AudioCtx();
        const decoded = await tempCtx.decodeAudioData(arrayBuffer);
        await tempCtx.close().catch(() => {});

        const targetRate = 16000;
        const duration = decoded.duration;
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offlineCtx = new OfflineCtx(1, Math.max(1, Math.ceil(duration * targetRate)), targetRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = decoded;
        source.connect(offlineCtx.destination);
        source.start(0);
        const resampled = await offlineCtx.startRendering();

        const channelData = resampled.getChannelData(0);
        const wavBuffer = new ArrayBuffer(44 + channelData.length * 2);
        const view = new DataView(wavBuffer);

        function writeStr(offset, str) {
          for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        }

        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + channelData.length * 2, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, targetRate, true);
        view.setUint32(28, targetRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true); // 16-bit
        writeStr(36, 'data');
        view.setUint32(40, channelData.length * 2, true);

        let offset = 44;
        for (let i = 0; i < channelData.length; i++, offset += 2) {
          const sample = Math.max(-1, Math.min(1, channelData[i]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        }
        return new Blob([wavBuffer], { type: 'audio/wav' });
      } catch (e) {
        console.warn('[voice-input] WAV conversion fallback', e);
        return blob;
      }
    }

    function blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = reader.result;
          if (typeof res === 'string') {
            resolve(res.split(',')[1] || '');
          } else {
            resolve('');
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    // SVG icons
    function IconMic() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 16, height: 16,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('path', { d: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z' }),
        h('path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }),
        h('line', { x1: 12, y1: 19, x2: 12, y2: 23 }),
        h('line', { x1: 8, y1: 23, x2: 16, y2: 23 })
      );
    }

    function IconPause() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13, fill: 'currentColor'
      },
        h('rect', { x: 5, y: 4, width: 4, height: 16, rx: 1 }),
        h('rect', { x: 15, y: 4, width: 4, height: 16, rx: 1 })
      );
    }

    function IconPlay() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13, fill: 'currentColor'
      },
        h('polygon', { points: '6 3 20 12 6 21 6 3' })
      );
    }

    function IconStop() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13, fill: 'currentColor'
      },
        h('rect', { x: 5, y: 5, width: 14, height: 14, rx: 2 })
      );
    }

    function IconSend() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('line', { x1: 22, y1: 2, x2: 11, y2: 13 }),
        h('polygon', { points: '22 2 15 22 11 13 2 9 22 2' })
      );
    }

    function IconClose() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 14, height: 14,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
        h('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
      );
    }

    function IconGear() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('circle', { cx: 12, cy: 12, r: 3 }),
        h('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' })
      );
    }

    function IconDownload() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
        h('polyline', { points: '7 10 12 15 17 10' }),
        h('line', { x1: 12, y1: 15, x2: 12, y2: 3 })
      );
    }

    const STYLES = `
      .dsh-vr-container {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        font-family: inherit;
        user-select: none;
      }
      .dsh-vr-idle-wrap {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .dsh-vr-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 28px;
        min-width: 28px;
        padding: 0 6px;
        border-radius: 6px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--dsw-alias-label-secondary, #888);
        cursor: pointer;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
        box-sizing: border-box;
      }
      .dsh-vr-btn:hover {
        background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.15));
        color: var(--dsw-alias-label-primary, #eee);
      }
      .dsh-vr-btn:active {
        opacity: 0.8;
      }
      .dsh-vr-engine-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 26px;
        padding: 0 8px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
        background: var(--dsw-alias-bg-layer-1, #252528);
        color: var(--dsw-alias-label-secondary, #aaa);
        font-size: 11px;
        cursor: pointer;
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-vr-engine-chip:hover {
        background: var(--dsw-alias-bg-layer-2, #333);
        color: var(--dsw-alias-label-primary, #eee);
      }
      .dsh-vr-btn-send {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 28px !important;
        padding: 0 12px !important;
        background-color: #2563eb !important;
        background: #2563eb !important;
        color: #ffffff !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        border: 1px solid #1d4ed8 !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        gap: 5px !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25) !important;
      }
      .dsh-vr-btn-send:hover {
        background-color: #1d4ed8 !important;
        background: #1d4ed8 !important;
        border-color: #60a5fa !important;
      }
      .dsh-vr-btn-send svg {
        stroke: #ffffff !important;
        color: #ffffff !important;
        fill: none !important;
      }
      .dsh-vr-btn-send span {
        color: #ffffff !important;
        font-weight: 600 !important;
      }
      .dsh-vr-btn-resume {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 28px !important;
        padding: 0 10px !important;
        background-color: #2563eb !important;
        background: #2563eb !important;
        color: #ffffff !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        border: 1px solid #1d4ed8 !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        gap: 4px !important;
      }
      .dsh-vr-btn-resume:hover {
        background-color: #1d4ed8 !important;
        background: #1d4ed8 !important;
      }
      .dsh-vr-btn-resume svg {
        fill: #ffffff !important;
        color: #ffffff !important;
      }
      .dsh-vr-btn-resume span {
        color: #ffffff !important;
      }
      .dsh-vr-btn-primary {
        background: #2563eb !important;
        color: #fff !important;
        font-weight: 500;
        gap: 4px;
        padding: 0 10px;
        border-radius: 6px;
      }
      .dsh-vr-btn-primary:hover {
        background: #1d4ed8 !important;
      }
      .dsh-vr-btn-danger {
        color: var(--dsw-alias-state-error-primary, #f56c6c);
      }
      .dsh-vr-btn-danger:hover {
        background: rgba(245, 108, 108, 0.15);
      }
      .dsh-vr-btn-warning {
        color: var(--dsw-alias-state-warn-primary, #e6a23c);
      }
      .dsh-vr-btn-warning:hover {
        background: rgba(230, 162, 60, 0.15);
      }
      .dsh-vr-active-bar {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--dsw-alias-bg-layer-1, #252528);
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
        padding: 3px 8px;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      }
      .dsh-vr-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--dsw-alias-state-error-primary, #f56c6c);
        animation: dsh-vr-pulse 1.2s infinite ease-in-out;
        flex-shrink: 0;
      }
      .dsh-vr-indicator-paused {
        background: var(--dsw-alias-state-warn-primary, #e6a23c);
        animation: none;
      }
      .dsh-vr-indicator-playback {
        background: var(--dsw-alias-brand-primary, #2080f0);
        animation: none;
      }
      @keyframes dsh-vr-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.3; transform: scale(0.85); }
      }
      .dsh-vr-timer {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 13px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary, #eee);
        min-width: 44px;
        text-align: center;
      }
      .dsh-vr-status-text {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary, #aaa);
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-vr-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.2));
        border-top-color: var(--dsw-alias-brand-primary, #2080f0);
        border-radius: 50%;
        animation: dsh-vr-spin 0.8s linear infinite;
        flex-shrink: 0;
      }
      @keyframes dsh-vr-spin {
        to { transform: rotate(360deg); }
      }

      /* Modal Dialog Backdrop & Card */
      .dsh-vr-modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(2px);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .dsh-vr-modal-card {
        width: 480px;
        max-width: 92vw;
        background: var(--dsw-alias-bg-overlay, #1e1e20);
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.15));
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
        padding: 22px;
        color: var(--dsw-alias-label-primary, #eee);
        box-sizing: border-box;
      }
      .dsh-vr-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
      }
      .dsh-vr-modal-title {
        font-size: 15px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--dsw-alias-label-primary, #eee);
      }
      .dsh-vr-modal-close-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--dsw-alias-label-secondary, #888);
        cursor: pointer;
      }
      .dsh-vr-modal-close-btn:hover {
        background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.1));
        color: var(--dsw-alias-label-primary, #fff);
      }
      .dsh-vr-select {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        font-size: 13px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.15));
        background: var(--dsw-alias-bg-layer-2, #2a2a2e);
        color: var(--dsw-alias-label-primary, #eee);
        outline: none;
        cursor: pointer;
      }
      .dsh-vr-select:focus {
        border-color: var(--dsw-alias-brand-primary, #2080f0);
      }
      .dsh-vr-engine-manager {
        background: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.04));
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 16px;
      }
      .dsh-vr-engine-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .dsh-vr-badge-active {
        display: inline-flex;
        align-items: center;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 4px;
        background: rgba(37, 99, 235, 0.2);
        color: #60a5fa;
        border: 1px solid rgba(59, 130, 246, 0.3);
      }
      .dsh-vr-form-group {
        margin-bottom: 14px;
      }
      .dsh-vr-label {
        display: block;
        font-size: 12px;
        font-weight: 500;
        color: var(--dsw-alias-label-secondary, #aaa);
        margin-bottom: 6px;
      }
      .dsh-vr-input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        font-size: 13px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.15));
        background: var(--dsw-alias-bg-layer-2, #2a2a2e);
        color: var(--dsw-alias-label-primary, #eee);
        outline: none;
      }
      .dsh-vr-input:focus {
        border-color: var(--dsw-alias-brand-primary, #2080f0);
      }
      .dsh-vr-modal-footer {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        margin-top: 20px;
        padding-top: 14px;
        border-top: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
      }
      .dsh-vr-modal-btn {
        padding: 6px 14px;
        font-size: 13px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.15));
        background: var(--dsw-alias-bg-layer-2, #333);
        color: var(--dsw-alias-label-primary, #eee);
        cursor: pointer;
        transition: background 0.15s;
      }
      .dsh-vr-modal-btn:hover {
        filter: brightness(1.15);
      }
      .dsh-vr-modal-btn-save {
        background: #2563eb;
        border-color: #1d4ed8;
        color: #fff;
        font-weight: 500;
      }

      /* Floating Error Toast */
      .dsh-vr-error-toast {
        position: fixed;
        bottom: 85px;
        right: 24px;
        width: 380px;
        max-width: 90vw;
        background: var(--dsw-alias-bg-overlay, #1e1e20);
        border: 1px solid var(--dsw-alias-state-error-primary, #f56c6c);
        color: var(--dsw-alias-label-primary, #eee);
        padding: 14px 16px;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
        z-index: 10000;
        box-sizing: border-box;
      }
      .dsh-vr-error-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .dsh-vr-error-title {
        font-weight: 600;
        font-size: 13px;
        color: var(--dsw-alias-state-error-primary, #f56c6c);
      }
      .dsh-vr-error-body {
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-secondary, #ccc);
      }
      .dsh-vr-error-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 10px;
      }
    `;

    function VoiceRecorder({ onActiveChange, inputActions, sessionId }) {
      const [config, setConfig] = useState(() => normalizeClientConfig(loadSavedConfig()));
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [showApiKey, setShowApiKey] = useState(false);
      const [tempConfig, setTempConfig] = useState(config);
      const [selectedEditId, setSelectedEditId] = useState(() => config.activeProviderId);

      // Status: 'idle' | 'recording' | 'recording_paused' | 'review' | 'sending' | 'success'
      const [mode, setMode] = useState('idle');
      const [recordSeconds, setRecordSeconds] = useState(0);

      // Playback
      const [playbackState, setPlaybackState] = useState('stopped'); // 'stopped' | 'playing' | 'paused'
      const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0);
      const [audioBlob, setAudioBlob] = useState(null);
      const [audioUrl, setAudioUrl] = useState(null);

      const [statusMsg, setStatusMsg] = useState('');
      const [errorMsg, setErrorMsg] = useState('');
      const [isPermissionError, setIsPermissionError] = useState(false);

      const mediaRecorderRef = useRef(null);
      const mediaStreamRef = useRef(null);
      const recordedChunksRef = useRef([]);
      const timerRef = useRef(null);
      const audioPlayerRef = useRef(null);

      const activeProvider = getActiveProvider(config);
      const editingProvider = tempConfig.providers.find(p => p.id === selectedEditId) || tempConfig.providers[0] || {
        id: 'default', name: 'Default Engine', url: '', apiKey: '', model: 'gemini-3.8-flash-high'
      };

      // Keep onActiveChange(false) so the toolbar doesn't push the controls left or hide the model selector!
      useEffect(() => {
        if (typeof onActiveChange === 'function') {
          onActiveChange(false);
        }
      }, [onActiveChange]);

      // On startup: fetch saved config from host backend and synchronize with local state
      useEffect(() => {
        fetch('/api/voice-input/config')
          .then(res => res.json())
          .then(data => {
            if (data && data.ok && data.config) {
              const normalized = normalizeClientConfig(data.config);
              setConfig(normalized);
              saveConfig(normalized);
            }
          })
          .catch(() => {});
      }, []);

      // Reset when session changes
      useEffect(() => {
        cleanupAll();
      }, [sessionId]);

      // Listen for Escape key to close modal or cancel
      useEffect(() => {
        const handleKeyDown = (e) => {
          if (e.key === 'Escape') {
            if (settingsOpen) {
              setSettingsOpen(false);
            }
          }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
      }, [settingsOpen]);

      const cleanupAudioPlayer = useCallback(() => {
        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
          audioPlayerRef.current.src = '';
          audioPlayerRef.current = null;
        }
        setPlaybackState('stopped');
        setPlaybackCurrentTime(0);
      }, []);

      const cleanupRecorder = useCallback(() => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          try {
            mediaRecorderRef.current.stop();
          } catch (e) {}
        }
        mediaRecorderRef.current = null;
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(t => t.stop());
          mediaStreamRef.current = null;
        }
        recordedChunksRef.current = [];
      }, []);

      const cleanupAll = useCallback(() => {
        cleanupRecorder();
        cleanupAudioPlayer();
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
          setAudioUrl(null);
        }
        setAudioBlob(null);
        setMode('idle');
        setRecordSeconds(0);
        setStatusMsg('');
        setErrorMsg('');
        setIsPermissionError(false);
      }, [cleanupRecorder, cleanupAudioPlayer, audioUrl]);

      // Start Recording directly
      const startRecording = async () => {
        setErrorMsg('');
        setIsPermissionError(false);
        cleanupAudioPlayer();
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
          setAudioUrl(null);
        }
        setAudioBlob(null);
        setRecordSeconds(0);

        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('navigator.mediaDevices.getUserMedia is not supported in this environment');
          }

          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true
            }
          });
          mediaStreamRef.current = stream;

          let mimeType = 'audio/webm';
          if (!MediaRecorder.isTypeSupported('audio/webm')) {
            if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
            else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
            else mimeType = '';
          }

          const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          mediaRecorderRef.current = recorder;
          recordedChunksRef.current = [];

          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              recordedChunksRef.current.push(e.data);
            }
          };

          recorder.start(250);
          setMode('recording');

          timerRef.current = setInterval(() => {
            setRecordSeconds(sec => sec + 1);
          }, 1000);
        } catch (err) {
          console.error('[voice-input] Failed to start microphone', err);
          const isPerm = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || String(err).includes('Permission denied');
          setIsPermissionError(isPerm);
          setErrorMsg(err.message || String(err));
          setMode('idle');
        }
      };

      // Pause Recording
      const pauseRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.pause();
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setMode('recording_paused');
        }
      };

      // Resume Recording
      const resumeRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
          mediaRecorderRef.current.resume();
          timerRef.current = setInterval(() => {
            setRecordSeconds(sec => sec + 1);
          }, 1000);
          setMode('recording');
        }
      };

      // Stop Recording and switch to Review mode
      const stopRecordingToReview = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const recorder = mediaRecorderRef.current;
        if (!recorder) return;

        recorder.onstop = () => {
          const rawMime = recorder.mimeType || 'audio/webm';
          const blob = new Blob(recordedChunksRef.current, { type: rawMime });
          setAudioBlob(blob);
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop());
            mediaStreamRef.current = null;
          }
          setMode('review');
        };

        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      };

      // Playback audio
      const playAudio = () => {
        if (!audioUrl) return;

        if (playbackState === 'paused' && audioPlayerRef.current) {
          audioPlayerRef.current.play();
          setPlaybackState('playing');
          return;
        }

        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
          audioPlayerRef.current = null;
        }

        const player = new Audio(audioUrl);
        audioPlayerRef.current = player;

        player.ontimeupdate = () => {
          setPlaybackCurrentTime(player.currentTime);
        };

        player.onended = () => {
          setPlaybackState('stopped');
          setPlaybackCurrentTime(0);
        };

        player.onerror = (e) => {
          console.warn('[voice-input] Playback error', e);
          setPlaybackState('stopped');
        };

        player.play().then(() => {
          setPlaybackState('playing');
        }).catch(err => {
          console.warn('[voice-input] Playback prevented', err);
          setPlaybackState('stopped');
        });
      };

      const pauseAudio = () => {
        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
          setPlaybackState('paused');
        }
      };

      const stopAudio = () => {
        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
          audioPlayerRef.current.currentTime = 0;
          setPlaybackState('stopped');
          setPlaybackCurrentTime(0);
        }
      };

      const downloadAudio = () => {
        const b = audioBlob;
        if (!b && !audioUrl) return;
        const url = audioUrl || URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = `voice_recording_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };

      // Send recording to backend proxy
      const sendRecording = async () => {
        cleanupAudioPlayer();
        setErrorMsg('');
        setIsPermissionError(false);
        setMode('sending');
        setStatusMsg('Preparing audio...');

        let blobToSend = audioBlob;

        // If user clicked Send directly while still recording
        if ((mode === 'recording' || mode === 'recording_paused') && mediaRecorderRef.current) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }

          blobToSend = await new Promise((resolve) => {
            const recorder = mediaRecorderRef.current;
            recorder.onstop = () => {
              const rawMime = recorder.mimeType || 'audio/webm';
              const b = new Blob(recordedChunksRef.current, { type: rawMime });
              if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach(t => t.stop());
                mediaStreamRef.current = null;
              }
              resolve(b);
            };
            if (recorder.state !== 'inactive') {
              recorder.stop();
            } else {
              resolve(audioBlob);
            }
          });
          setAudioBlob(blobToSend);
        }

        if (!blobToSend || blobToSend.size === 0) {
          setErrorMsg('No audio was recorded to send');
          setMode('idle');
          return;
        }

        const currentActive = getActiveProvider(config);
        if (!currentActive.url || !currentActive.apiKey) {
          setErrorMsg(`Please configure Provider URL & API Key for "${currentActive.name}" in Settings (⚙).`);
          openSettings();
          setMode('review');
          return;
        }

        try {
          setStatusMsg('Converting audio to WAV...');
          const wavBlob = await convertToWavBlob(blobToSend);
          const base64 = await blobToBase64(wavBlob);

          setStatusMsg(`Transcribing with ${currentActive.name || currentActive.model}...`);

          const res = await fetch('/api/voice-input/transcribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              audioBase64: base64,
              format: 'wav',
              url: currentActive.url,
              apiKey: currentActive.apiKey,
              model: currentActive.model
            })
          });

          const data = await res.json();

          if (!res.ok || !data.ok) {
            let errMsg = data.error || `HTTP ${res.status}`;
            if (data.crashedFile) {
              errMsg += `\n[Audio saved in: Crashed Recording/${data.crashedFile}]`;
            }
            throw new Error(errMsg);
          }

          const transcribedText = (data.text || '').trim();
          if (!transcribedText) {
            throw new Error('Transcribed text was empty');
          }

          // Insert text into composer draft
          let inserted = false;
          if (inputActions && typeof inputActions.captureInsertion === 'function' && typeof inputActions.insertText === 'function') {
            try {
              const span = inputActions.captureInsertion();
              inserted = inputActions.insertText(transcribedText, span);
            } catch (e) {
              inserted = false;
            }
          }
          if (!inserted && inputActions && typeof inputActions.setDraft === 'function') {
            try {
              inputActions.setDraft(transcribedText);
              inserted = true;
            } catch (e) {
              inserted = false;
            }
          }

          setStatusMsg(`✓ Transcribed: "${transcribedText.slice(0, 30)}${transcribedText.length > 30 ? '...' : ''}"`);
          setMode('success');

          setTimeout(() => {
            cleanupAll();
          }, 2000);
        } catch (err) {
          console.error('[voice-input] Send failed', err);
          setErrorMsg('Transcription failed: ' + (err.message || String(err)));
          setMode('review');
        }
      };

      // Settings modal
      const openSettings = () => {
        fetch('/api/voice-input/config')
          .then(res => res.json())
          .then(data => {
            if (data && data.ok && data.config) {
              const normalized = normalizeClientConfig(data.config);
              setConfig(normalized);
              setTempConfig(JSON.parse(JSON.stringify(normalized)));
              setSelectedEditId(normalized.activeProviderId);
              saveConfig(normalized);
            } else {
              setTempConfig(JSON.parse(JSON.stringify(config)));
              setSelectedEditId(config.activeProviderId);
            }
          })
          .catch(() => {
            setTempConfig(JSON.parse(JSON.stringify(config)));
            setSelectedEditId(config.activeProviderId);
          })
          .finally(() => {
            setSettingsOpen(true);
          });
      };

      const handleSaveSettings = () => {
        const normalized = normalizeClientConfig(tempConfig);
        setConfig(normalized);
        saveConfig(normalized);
        setSettingsOpen(false);

        // Notify backend to write to permanent disk storage
        fetch('/api/voice-input/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalized)
        }).then(res => res.json()).then(data => {
          if (data && data.ok && data.config) {
            const serverNorm = normalizeClientConfig(data.config);
            setConfig(serverNorm);
            saveConfig(serverNorm);
          }
        }).catch(err => console.warn('[voice-input] Failed to sync config with host', err));
      };

      const handleAddNewEngine = () => {
        const newId = 'engine_' + Date.now().toString(36);
        const newEngine = {
          id: newId,
          name: 'AI Engine ' + (tempConfig.providers.length + 1),
          url: '',
          apiKey: '',
          model: 'gemini-3.8-flash-high'
        };
        const updated = {
          ...tempConfig,
          providers: [...tempConfig.providers, newEngine]
        };
        setTempConfig(updated);
        setSelectedEditId(newId);
      };

      const handleDeleteCurrentEngine = () => {
        if (tempConfig.providers.length <= 1) return;
        const remaining = tempConfig.providers.filter(p => p.id !== selectedEditId);
        const nextActive = tempConfig.activeProviderId === selectedEditId ? remaining[0].id : tempConfig.activeProviderId;
        const updated = {
          activeProviderId: nextActive,
          providers: remaining
        };
        setTempConfig(updated);
        setSelectedEditId(remaining[0].id);
      };

      const updateCurrentEngineField = (field, val) => {
        const updatedProviders = tempConfig.providers.map(p => {
          if (p.id === selectedEditId) {
            return { ...p, [field]: val };
          }
          return p;
        });
        setTempConfig({
          ...tempConfig,
          providers: updatedProviders
        });
      };

      const handleQuickSwitchEngine = (newId) => {
        const updated = {
          ...config,
          activeProviderId: newId
        };
        setConfig(updated);
        saveConfig(updated);
        fetch('/api/voice-input/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated)
        }).catch(() => {});
      };

      return h('div', { className: 'dsh-vr-container' },
        h('style', null, STYLES),

        // Centered Modal Dialog for Settings
        settingsOpen && h('div', {
          className: 'dsh-vr-modal-backdrop',
          onClick: (e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }
        },
          h('div', { className: 'dsh-vr-modal-card' },
            h('div', { className: 'dsh-vr-modal-header' },
              h('div', { className: 'dsh-vr-modal-title' },
                h(IconGear),
                h('span', null, 'AI Engines & Providers')
              ),
              h('button', {
                className: 'dsh-vr-modal-close-btn',
                title: 'Close (Esc)',
                'aria-label': 'Close settings',
                onClick: () => setSettingsOpen(false)
              }, h(IconClose))
            ),

            // Engine Selection & Management Bar
            h('div', { className: 'dsh-vr-engine-manager' },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
                h('label', { className: 'dsh-vr-label', style: { marginBottom: 0 } }, 'Saved Engines / Models'),
                h('div', { style: { display: 'flex', gap: 6 } },
                  h('button', {
                    type: 'button',
                    className: 'dsh-vr-btn',
                    style: { height: 24, fontSize: 11, padding: '0 8px', background: 'rgba(255,255,255,0.08)' },
                    title: 'Add new engine',
                    onClick: handleAddNewEngine
                  }, '+ Add Engine'),
                  tempConfig.providers.length > 1 && h('button', {
                    type: 'button',
                    className: 'dsh-vr-btn dsh-vr-btn-danger',
                    style: { height: 24, fontSize: 11, padding: '0 8px' },
                    title: 'Delete this engine',
                    onClick: handleDeleteCurrentEngine
                  }, 'Delete')
                )
              ),
              h('div', { className: 'dsh-vr-engine-row' },
                h('select', {
                  className: 'dsh-vr-select',
                  value: selectedEditId,
                  onChange: (e) => setSelectedEditId(e.target.value)
                },
                  tempConfig.providers.map(p =>
                    h('option', { key: p.id, value: p.id },
                      (p.name || 'Unnamed Engine') + (p.id === tempConfig.activeProviderId ? ' ★ (Active)' : '') + (p.model ? ` — ${p.model}` : '')
                    )
                  )
                )
              ),
              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 } },
                selectedEditId === tempConfig.activeProviderId ? h('span', { className: 'dsh-vr-badge-active' }, '★ Currently Active Engine') : h('button', {
                  type: 'button',
                  className: 'dsh-vr-modal-btn',
                  style: { padding: '3px 10px', fontSize: 11, background: '#2563eb', color: '#fff', border: 'none' },
                  onClick: () => setTempConfig({ ...tempConfig, activeProviderId: selectedEditId })
                }, 'Set as Active Engine')
              )
            ),

            // Provider Form Fields
            h('div', { className: 'dsh-vr-form-group' },
              h('label', { className: 'dsh-vr-label' }, 'Engine Display Name'),
              h('input', {
                className: 'dsh-vr-input',
                type: 'text',
                value: editingProvider.name || '',
                placeholder: 'e.g. Gemini 3.8 Flash Proxy',
                onChange: (e) => updateCurrentEngineField('name', e.target.value)
              })
            ),
            h('div', { className: 'dsh-vr-form-group' },
              h('label', { className: 'dsh-vr-label' }, 'Provider API Base URL'),
              h('input', {
                className: 'dsh-vr-input',
                type: 'text',
                value: editingProvider.url || '',
                placeholder: 'http://your-provider-host:8000/v1',
                onChange: (e) => updateCurrentEngineField('url', e.target.value)
              })
            ),
            h('div', { className: 'dsh-vr-form-group' },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
                h('label', { className: 'dsh-vr-label', style: { marginBottom: 0 } }, 'API Key'),
                h('button', {
                  type: 'button',
                  style: { background: 'none', border: 'none', color: 'var(--dsw-alias-brand-primary, #2080f0)', cursor: 'pointer', fontSize: 11 },
                  onClick: () => setShowApiKey(!showApiKey)
                }, showApiKey ? 'Hide' : 'Show')
              ),
              h('input', {
                className: 'dsh-vr-input',
                type: showApiKey ? 'text' : 'password',
                value: editingProvider.apiKey || '',
                placeholder: 'your-api-key',
                onChange: (e) => updateCurrentEngineField('apiKey', e.target.value)
              })
            ),
            h('div', { className: 'dsh-vr-form-group' },
              h('label', { className: 'dsh-vr-label' }, 'Model ID'),
              h('input', {
                className: 'dsh-vr-input',
                type: 'text',
                value: editingProvider.model || '',
                placeholder: 'gemini-3.8-flash-high',
                onChange: (e) => updateCurrentEngineField('model', e.target.value)
              })
            ),
            h('div', { className: 'dsh-vr-modal-footer' },
              h('button', {
                className: 'dsh-vr-modal-btn',
                onClick: () => setSettingsOpen(false)
              }, 'Cancel'),
              h('button', {
                className: 'dsh-vr-modal-btn dsh-vr-modal-btn-save',
                onClick: handleSaveSettings
              }, 'Save All Engines')
            )
          )
        ),

        // Floating Error / Permission Notice Toast
        errorMsg && h('div', { className: 'dsh-vr-error-toast' },
          h('div', { className: 'dsh-vr-error-header' },
            h('span', { className: 'dsh-vr-error-title' },
              isPermissionError ? 'Microphone Permission Notice' : 'Voice Input Notice'
            ),
            h('button', {
              className: 'dsh-vr-modal-close-btn',
              style: { width: 22, height: 22 },
              onClick: () => setErrorMsg('')
            }, h(IconClose))
          ),
          h('div', { className: 'dsh-vr-error-body' },
            isPermissionError ? h('div', null,
              h('p', { style: { margin: '0 0 6px 0' } }, 'Microphone access was denied or is blocked by the desktop app.'),
              h('p', { style: { margin: '0 0 6px 0', fontSize: 11, opacity: 0.9 } },
                'Tip: You can also use the Harness Web GUI directly in your browser at ',
                h('strong', null, 'http://127.0.0.1:43129'),
                ', where Chrome/Edge allows microphone access immediately.'
              )
            ) : h('div', null, errorMsg)
          ),
          h('div', { className: 'dsh-vr-error-actions' },
            h('button', {
              className: 'dsh-vr-modal-btn',
              style: { padding: '3px 10px', fontSize: 12 },
              onClick: () => setErrorMsg('')
            }, 'Dismiss')
          )
        ),

        // Mode: IDLE
        mode === 'idle' && h('div', { className: 'dsh-vr-idle-wrap' },
          h('button', {
            className: 'dsh-vr-btn',
            title: `Record voice [${activeProvider.name}: ${activeProvider.model}]`,
            'aria-label': 'Record voice',
            onClick: startRecording
          }, h(IconMic)),

          // Quick Engine Switcher if multiple providers exist
          config.providers.length > 1 && h('select', {
            className: 'dsh-vr-engine-chip',
            value: config.activeProviderId,
            title: `Active Engine: ${activeProvider.name} (${activeProvider.model})`,
            onChange: (e) => handleQuickSwitchEngine(e.target.value)
          },
            config.providers.map(p =>
              h('option', { key: p.id, value: p.id }, p.name || p.model)
            )
          ),

          h('button', {
            className: 'dsh-vr-btn',
            style: { width: 22, minWidth: 22, height: 22, opacity: 0.65 },
            title: `Engine Settings [${activeProvider.name}]`,
            'aria-label': 'Voice settings',
            onClick: openSettings
          }, h(IconGear))
        ),

        // Mode: RECORDING
        mode === 'recording' && h('div', { className: 'dsh-vr-active-bar' },
          h('div', { className: 'dsh-vr-indicator' }),
          h('span', { className: 'dsh-vr-timer' }, formatTime(recordSeconds)),
          h('button', {
            className: 'dsh-vr-btn dsh-vr-btn-warning',
            title: 'Pause recording',
            'aria-label': 'Pause recording',
            onClick: pauseRecording
          }, h(IconPause)),
          h('button', {
            className: 'dsh-vr-btn',
            title: 'Stop & review audio',
            'aria-label': 'Stop recording',
            onClick: stopRecordingToReview
          }, h(IconStop)),
          h('button', {
            className: 'dsh-vr-btn dsh-vr-btn-danger',
            title: 'Discard recording',
            'aria-label': 'Discard recording',
            onClick: cleanupAll
          }, h(IconClose)),
          h('button', {
            className: 'dsh-vr-btn-send',
            title: `Send voice to ${activeProvider.name}`,
            'aria-label': 'Send voice',
            onClick: sendRecording
          }, h(IconSend), h('span', { style: { marginLeft: 4 } }, 'Send'))
        ),

        // Mode: RECORDING_PAUSED
        mode === 'recording_paused' && h('div', { className: 'dsh-vr-active-bar' },
          h('div', { className: 'dsh-vr-indicator dsh-vr-indicator-paused' }),
          h('span', { className: 'dsh-vr-timer' }, formatTime(recordSeconds)),
          h('button', {
            className: 'dsh-vr-btn-resume',
            style: { padding: '0 8px' },
            title: 'Resume recording',
            'aria-label': 'Resume recording',
            onClick: resumeRecording
          }, h(IconPlay), h('span', { style: { marginLeft: 2, fontSize: 12 } }, 'Resume')),
          h('button', {
            className: 'dsh-vr-btn',
            title: 'Finish & review audio',
            'aria-label': 'Stop recording',
            onClick: stopRecordingToReview
          }, h(IconStop)),
          h('button', {
            className: 'dsh-vr-btn dsh-vr-btn-danger',
            title: 'Discard recording',
            'aria-label': 'Discard recording',
            onClick: cleanupAll
          }, h(IconClose)),
          h('button', {
            className: 'dsh-vr-btn-send',
            title: `Send voice to ${activeProvider.name}`,
            'aria-label': 'Send voice',
            onClick: sendRecording
          }, h(IconSend), h('span', { style: { marginLeft: 4 } }, 'Send'))
        ),

        // Mode: REVIEW (Playback & Send options)
        mode === 'review' && h('div', { className: 'dsh-vr-active-bar' },
          h('div', { className: 'dsh-vr-indicator dsh-vr-indicator-playback' }),
          h('span', { className: 'dsh-vr-timer' },
            playbackState === 'playing' ? formatTime(playbackCurrentTime) : formatTime(recordSeconds)
          ),
          playbackState === 'playing' ? h('button', {
            className: 'dsh-vr-btn dsh-vr-btn-warning',
            title: 'Pause playback',
            'aria-label': 'Pause playback',
            onClick: pauseAudio
          }, h(IconPause)) : h('button', {
            className: 'dsh-vr-btn',
            title: playbackState === 'paused' ? 'Resume playback' : 'Play recorded voice',
            'aria-label': 'Play voice',
            onClick: playAudio
          }, h(IconPlay)),
          playbackState !== 'stopped' && h('button', {
            className: 'dsh-vr-btn',
            title: 'Stop playback',
            'aria-label': 'Stop playback',
            onClick: stopAudio
          }, h(IconStop)),
          h('button', {
            className: 'dsh-vr-btn',
            title: 'Download audio file to computer',
            'aria-label': 'Download audio',
            onClick: downloadAudio
          }, h(IconDownload)),
          h('button', {
            className: 'dsh-vr-btn',
            style: { width: 22, minWidth: 22, height: 22, opacity: 0.75 },
            title: `Engine settings [${activeProvider.name}]`,
            'aria-label': 'Settings',
            onClick: openSettings
          }, h(IconGear)),
          h('button', {
            className: 'dsh-vr-btn dsh-vr-btn-danger',
            title: 'Discard audio',
            'aria-label': 'Discard audio',
            onClick: cleanupAll
          }, h(IconClose)),
          h('button', {
            className: 'dsh-vr-btn-send',
            title: `Send voice to ${activeProvider.name}`,
            'aria-label': 'Send voice',
            onClick: sendRecording
          }, h(IconSend), h('span', { style: { marginLeft: 4 } }, 'Send'))
        ),

        // Mode: SENDING
        mode === 'sending' && h('div', { className: 'dsh-vr-active-bar' },
          h('div', { className: 'dsh-vr-spinner' }),
          h('span', { className: 'dsh-vr-status-text' }, statusMsg || 'Transcribing...'),
          h('button', {
            className: 'dsh-vr-btn dsh-vr-btn-danger',
            title: 'Cancel',
            'aria-label': 'Cancel',
            onClick: cleanupAll
          }, h(IconClose))
        ),

        // Mode: SUCCESS
        mode === 'success' && h('div', { className: 'dsh-vr-active-bar' },
          h('span', {
            className: 'dsh-vr-status-text',
            style: { color: 'var(--dsw-alias-state-success-primary, #67c23a)', fontWeight: 500 }
          }, statusMsg)
        )
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
          name: 'conversation.input.activity',
          id: 'voice-input',
          order: 1
        }, VoiceRecorder));
      }
    };
  }
});
