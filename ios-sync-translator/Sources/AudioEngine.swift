import AVFoundation

/// Захват микрофона и воспроизведение перевода.
///
/// Захват: тап на input-ноде в аппаратном формате → конвертация в PCM16 16 кГц
/// моно (то, что ждёт Gemini) → колбэк `onCapturedPCM16`.
/// Воспроизведение: входящий PCM16 24 кГц → AVAudioPCMBuffer → AVAudioPlayerNode.
///
/// ВНИМАНИЕ: требует реального устройства (микрофон/Bluetooth не работают в
/// симуляторе как надо). Код не компилировался в этой среде — проверьте в Xcode.
final class AudioEngine {

    /// Захвачен чанк микрофона (PCM16 16 кГц моно little-endian).
    var onCapturedPCM16: ((Data) -> Void)?

    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private var converter: AVAudioConverter?
    private var isRunning = false

    /// Формат, в котором играем перевод (24 кГц Int16 моно).
    private let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: AudioFormatSpec.outputSampleRate,
        channels: AudioFormatSpec.channels,
        interleaved: true
    )!

    /// Целевой формат захвата (16 кГц Int16 моно).
    private let captureFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: AudioFormatSpec.inputSampleRate,
        channels: AudioFormatSpec.channels,
        interleaved: true
    )!

    // MARK: - Аудиосессия

    /// Настройка маршрута звука под режим.
    /// - listening: выход в наушники (AirPods), вход — встроенный микрофон.
    /// - speaking: выход принудительно в динамик телефона.
    func configureSession(forSpeaking speaking: Bool) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .voiceChat,                       // включает аппаратное эхоподавление
            options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
        )
        try session.setActive(true)
        try session.overrideOutputAudioPort(speaking ? .speaker : .none)
    }

    // MARK: - Запуск / остановка

    func start() throws {
        guard !isRunning else { return }

        let input = engine.inputNode
        // Включаем голосовую обработку (эхоподавление + шумоподавление).
        try? input.setVoiceProcessingEnabled(true)

        let hwFormat = input.outputFormat(forBus: 0)
        converter = AVAudioConverter(from: hwFormat, to: captureFormat)

        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: outputFormat)

        input.installTap(onBus: 0, bufferSize: 2048, format: hwFormat) { [weak self] buffer, _ in
            self?.handleCapture(buffer)
        }

        engine.prepare()
        try engine.start()
        playerNode.play()
        isRunning = true
    }

    func stop() {
        guard isRunning else { return }
        engine.inputNode.removeTap(onBus: 0)
        playerNode.stop()
        engine.stop()
        engine.disconnectNodeOutput(playerNode)
        engine.detach(playerNode)
        converter = nil
        isRunning = false
    }

    // MARK: - Захват

    private func handleCapture(_ buffer: AVAudioPCMBuffer) {
        guard let converter else { return }

        let ratio = AudioFormatSpec.inputSampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 1)
        guard let out = AVAudioPCMBuffer(pcmFormat: captureFormat, frameCapacity: capacity) else { return }

        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        if error != nil { return }

        guard let channel = out.int16ChannelData else { return }
        let byteCount = Int(out.frameLength) * MemoryLayout<Int16>.size
        let data = Data(bytes: channel[0], count: byteCount)
        onCapturedPCM16?(data)
    }

    // MARK: - Воспроизведение

    /// Принимает сырой PCM16 24 кГц моно от Gemini и ставит в очередь на проигрывание.
    func enqueuePlayback(_ pcm16: Data) {
        let frameCount = AVAudioFrameCount(pcm16.count / MemoryLayout<Int16>.size)
        guard frameCount > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: frameCount),
              let dst = buffer.int16ChannelData else { return }

        buffer.frameLength = frameCount
        pcm16.withUnsafeBytes { raw in
            if let src = raw.bindMemory(to: Int16.self).baseAddress {
                dst[0].update(from: src, count: Int(frameCount))
            }
        }
        playerNode.scheduleBuffer(buffer, completionHandler: nil)
        if !playerNode.isPlaying { playerNode.play() }
    }

    /// Сбросить очередь воспроизведения (например, при смене режима).
    func flushPlayback() {
        playerNode.stop()
        playerNode.play()
    }
}
