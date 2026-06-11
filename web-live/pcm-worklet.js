// AudioWorklet: накапливает кадры микрофона и отдаёт их в основной поток
// блоками (Float32, частота = частоте AudioContext). Ресемплинг до 16 кГц
// и кодирование делаются в основном потоке (audio.js).
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._target = 4096; // примерный размер блока в сэмплах
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0];
      for (let i = 0; i < channel.length; i++) this._buf.push(channel[i]);
      if (this._buf.length >= this._target) {
        this.port.postMessage(Float32Array.from(this._buf));
        this._buf = [];
      }
    }
    return true; // держим процессор живым
  }
}

registerProcessor('capture-processor', CaptureProcessor);
