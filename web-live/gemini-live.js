'use strict';

// Клиент Gemini Live API (двунаправленный стрим аудио) для браузера.
// Поток: connect(systemInstruction) → setup → sendAudio(pcm16) → onAudio(pcm16).

const GEMINI_MODEL = 'models/gemini-2.0-flash-live-001';
const GEMINI_VOICE = 'Aoede';

class GeminiLive {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.ready = false;

    this.onAudio = null;        // (ArrayBuffer PCM16 24кГц) => void
    this.onInputText = null;    // распознанный исходный текст (субтитры)
    this.onOutputText = null;   // текст перевода (субтитры)
    this.onReady = null;
    this.onError = null;
    this.onClose = null;
  }

  connect(systemInstruction) {
    const url =
      'wss://generativelanguage.googleapis.com/ws/' +
      'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' +
      encodeURIComponent(this.apiKey);

    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => this._sendSetup(systemInstruction);
    this.ws.onmessage = (e) => this._handle(e.data);
    this.ws.onerror = () => this.onError && this.onError('Ошибка WebSocket-соединения');
    this.ws.onclose = (e) => {
      this.ready = false;
      this.onClose && this.onClose(e);
    };
  }

  close() {
    this.ready = false;
    if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
  }

  _sendSetup(systemInstruction) {
    const setup = {
      setup: {
        model: GEMINI_MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } },
          },
        },
        systemInstruction: { parts: [{ text: systemInstruction }] },
        // Субтитры: попросить транскрипцию входа и выхода (если модель поддерживает).
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    };
    this.ws.send(JSON.stringify(setup));
  }

  // pcm16 — ArrayBuffer PCM16 16 кГц моно.
  sendAudio(pcm16) {
    if (!this.ready || !this.ws) return;
    const b64 = bytesToBase64(new Uint8Array(pcm16));
    this.ws.send(JSON.stringify({
      realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: b64 }] },
    }));
  }

  async _handle(data) {
    // Сервер может прислать Blob/ArrayBuffer/строку — приводим к тексту JSON.
    let text;
    if (typeof data === 'string') text = data;
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else if (data instanceof Blob) text = await data.text();
    else return;

    let msg;
    try { msg = JSON.parse(text); } catch (_) { return; }

    if (msg.setupComplete) {
      this.ready = true;
      this.onReady && this.onReady();
      return;
    }

    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.inputTranscription && sc.inputTranscription.text) {
      this.onInputText && this.onInputText(sc.inputTranscription.text);
    }
    if (sc.outputTranscription && sc.outputTranscription.text) {
      this.onOutputText && this.onOutputText(sc.outputTranscription.text);
    }
    if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
      for (const part of sc.modelTurn.parts) {
        const inline = part.inlineData;
        if (inline && inline.data) {
          this.onAudio && this.onAudio(base64ToBytes(inline.data).buffer);
        }
      }
    }
  }
}

// --- base64 helpers ---

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

window.GeminiLive = GeminiLive;
