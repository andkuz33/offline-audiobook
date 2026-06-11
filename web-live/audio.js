'use strict';

// Захват микрофона и воспроизведение перевода в браузере.
// Вход в Gemini Live: PCM16 16 кГц моно. Выход из Gemini: PCM16 24 кГц моно.

const IN_RATE = 16000;
const OUT_RATE = 24000;

class AudioIO {
  constructor() {
    this.captureCtx = null;
    this.stream = null;
    this.workletNode = null;
    this.onPCM16 = null; // колбэк: (ArrayBuffer PCM16 16кГц) => void

    this.playCtx = null;
    this.nextTime = 0;
  }

  // --- Захват ---

  async startCapture(onPCM16) {
    this.onPCM16 = onPCM16;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    this.captureCtx = new (window.AudioContext || window.webkitAudioContext)();
    await this.captureCtx.audioWorklet.addModule('pcm-worklet.js');
    const source = this.captureCtx.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.captureCtx, 'capture-processor');

    const inputRate = this.captureCtx.sampleRate;
    this.workletNode.port.onmessage = (e) => {
      const float = e.data; // Float32Array на частоте inputRate
      const down = downsample(float, inputRate, IN_RATE);
      const pcm16 = floatToPCM16(down);
      this.onPCM16 && this.onPCM16(pcm16.buffer);
    };

    source.connect(this.workletNode);
    // Воркноду нужен выход, иначе в части браузеров process() не вызывается.
    this.workletNode.connect(this.captureCtx.destination);
    // Но звук микрофона в колонки нам не нужен — глушим через нулевой гейн.
    // (connect к destination оставлен только чтобы граф был активен.)
  }

  stopCapture() {
    if (this.workletNode) { this.workletNode.disconnect(); this.workletNode = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.captureCtx) { this.captureCtx.close(); this.captureCtx = null; }
  }

  // --- Воспроизведение ---

  ensurePlayback() {
    if (!this.playCtx) {
      this.playCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.nextTime = 0;
    }
    if (this.playCtx.state === 'suspended') this.playCtx.resume();
  }

  // pcm16Buffer — ArrayBuffer с PCM16 24 кГц моно от Gemini.
  enqueue(pcm16Buffer) {
    this.ensurePlayback();
    const int16 = new Int16Array(pcm16Buffer);
    if (int16.length === 0) return;

    const buffer = this.playCtx.createBuffer(1, int16.length, OUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768;

    const src = this.playCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.playCtx.destination);

    const now = this.playCtx.currentTime;
    if (this.nextTime < now) this.nextTime = now + 0.03; // небольшой запас при недогрузке
    src.start(this.nextTime);
    this.nextTime += buffer.duration;
  }

  flushPlayback() {
    if (this.playCtx) {
      this.playCtx.close();
      this.playCtx = null;
    }
  }
}

// --- Вспомогательное ---

function downsample(input, inRate, outRate) {
  if (outRate >= inRate) return input;
  const ratio = inRate / outRate;
  const newLen = Math.round(input.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = idx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function floatToPCM16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

window.AudioIO = AudioIO;
