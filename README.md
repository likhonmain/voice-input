# Voice Input for DeepSeek Harness

A feature-rich, high-performance voice recording and transcription plugin for **DeepSeek Harness (DSH)**. It places a clean microphone icon directly beside the model selector in your composer bar, allowing you to record, pause, listen back to your audio, and transcribe it into your message draft using any OpenAI-compatible API or multimodal model (such as `gemini-3.8-flash-high`).

---

## ✨ Features

- **Toolbar Integration**: Docked right beside the model selector in the composer toolbar.
- **One-Click Recording**: Click the microphone icon to begin recording audio immediately.
- **Real-time Recording Timer**: Live elapsed time counter (`MM:SS`) with a visual recording indicator.
- **Pause & Resume**: Pause recording anytime, and resume right from where you stopped.
- **Audio Playback & Review**: Listen to what you recorded before sending. Includes Play, Pause Playback, and Stop Playback controls.
- **Discard / Cancel**: Discard the recording at any stage with a single click.
- **Direct Send**: Click **Send** while recording or during review. The audio is converted to standard 16kHz mono WAV in the browser and forwarded to your configured provider.
- **Auto Draft Insertion**: Transcribed text is automatically inserted directly into your conversation draft.
- **Custom Provider & Model Settings**:
  - Easily configure your **Provider API Base URL**, **API Key**, and **Model ID** directly from the UI via the ⚙ (gear) icon.
  - Includes a Show/Hide toggle for the API key.
  - Preferences persist across sessions in local storage.

---

## 📦 What Is Included vs. What Is Not

### Included:
- **Client Web UI Module (`client.js`)**: Pure JavaScript component that mounts into the `conversation.input.activity` slot, managing recording, timers, playback, and settings modal.
- **Host Backend Service (`index.js`)**: Fast Node.js service that hosts `/api/voice-input/transcribe` and `/api/voice-input/config`, forwarding audio to your OpenAI-compatible endpoint.
- **Multi-Modal & Whisper Fallback**: Supports both OpenAI Chat Completions with `input_audio` (e.g. Gemini 3.8 / GPT-4o multimodal models) and traditional `/v1/audio/transcriptions` (Whisper endpoints).
- **Desktop Microphone Enabler Utility (`enable-desktop-mic.cjs`)**: Automates patching the DeepSeek Harness Desktop Electron app on Windows to grant media/microphone access.

### NOT Included:
- **No API Keys or Private URLs**: By default, no API keys or backend URLs are bundled. You must supply your own provider endpoint and credentials in the Settings modal.
- **No Heavy Native Dependencies**: Uses native browser Web Audio API (`AudioContext`, `MediaRecorder`) and Node.js standard built-ins (`fetch`, `Buffer`, `Blob`).

---

## 🎙 Transcription System Instruction

When transcribing speech through multimodal LLMs (e.g. `gemini-3.8-flash-high`), the backend applies this transcription directive:

> *"You are an expert transcriber and translator. Translate or transcribe the exact meaning of the audio into clean English. Remove any spoken filler words, stutters, repetitions, and hesitation marks (like 'um', 'uh', 'you know'). Do NOT add any summaries, conversational responses, or formatting. Output ONLY the raw, clean translated text."*

---

## 🛠 DeepSeek Harness Desktop App: Microphone Permission Fix

If you are using the **DSH Desktop** (Windows Electron desktop app), you might encounter:
```
Microphone access denied or unavailable: Permission denied
```

### Why This Happens:
DeepSeek Harness Desktop is an Electron application. In its main process (`out/main/index.js`), it enforces a strict permission check:
```javascript
function canGrantWindowPermission(permission, requestingUrl, isMainFrame) {
  return (permission === "clipboard-sanitized-write" || permission === "notifications") && ...
}
```
Because the `media` (microphone) permission was omitted from this whitelist, Electron automatically denies all microphone requests before Windows even sees them. Consequently, DeepSeek Desktop never prompts for microphone access and does not show up in Windows Privacy Settings.

### How to Fix It (Automated):

This repository provides an automated patch script: `enable-desktop-mic.cjs`.

1. Close **DSH Desktop**.
2. Run the patch script from your terminal:
   ```bash
   node enable-desktop-mic.cjs
   ```
   *The script automatically creates a backup (`app.asar.bak`) and patches `app.asar` to include `media` in the permission check.*
3. Ensure Windows Desktop microphone access is enabled:
   - Open Windows **Settings** (`Win + I`) → **Privacy & security** → **Microphone**.
   - Make sure **Microphone access** is **ON**.
   - Make sure **Let apps access your microphone** is **ON**.
   - Scroll to the bottom and ensure **Let desktop apps access your microphone** is **ON**.
4. Relaunch **DSH Desktop**.

---

## 🌐 Web Browser Access

You can also use DeepSeek Harness directly through any web browser (Google Chrome, Microsoft Edge, Brave, Firefox):

1. Find your local Harness port (displayed when starting DSH, typically `http://127.0.0.1:43129` or similar).
2. Open that URL in your browser.
3. Click the microphone icon — your browser will display the standard permission prompt:
   > *"127.0.0.1 wants to use your microphone: [Allow] [Block]"*
4. Click **Allow**.

---

## 🚀 Installation into DeepSeek Harness

1. Clone or copy this repository into your workspace or plugins directory:
   ```bash
   git clone https://github.com/likhonmain/voice-input.git
   ```

2. Install the bundle using the Harness Plugin Manager or CLI:
   - From DSH chat: ask the agent to install bundle `dsh-voice-input` from this folder path.
   - Or install via profile manifest.

3. Open Settings by clicking the **⚙ (gear)** icon next to the microphone icon in the composer bar:
   - **Provider API Base URL**: (e.g., `http://your-proxy-host:8000/v1`)
   - **API Key**: (e.g., `your-api-key`)
   - **Model ID**: (e.g., `gemini-3.8-flash-high`)
4. Click **Save** and start speaking!

---

## 📄 License

MIT License. Feel free to use, modify, and distribute.
