import Foundation
import AVFoundation

/// Связывает аудио и Gemini Live, управляет режимами «Слушаю»/«Говорю».
@MainActor
final class TranslatorViewModel: ObservableObject {

    @Published var mode: Mode = .idle
    @Published var speakTarget: SpeakTarget = .english
    @Published var status: String = "Готово к работе"
    @Published var isConnecting = false

    private let audio = AudioEngine()
    private var client: GeminiLiveClient?

    init() {
        audio.onCapturedPCM16 = { [weak self] data in
            self?.client?.sendAudio(data)
        }
    }

    // MARK: - Публичные действия из UI

    /// Тумблер режима «Слушаю окружающих» (EN/ZH → RU в наушник).
    func toggleListening() {
        if mode == .listening {
            stop()
        } else {
            start(mode: .listening)
        }
    }

    /// Нажал кнопку «Говорить» (зажатие): RU → EN/ZH в динамик.
    func startSpeaking() {
        guard mode != .speaking else { return }
        start(mode: .speaking)
    }

    /// Отпустил кнопку «Говорить».
    func stopSpeaking() {
        guard mode == .speaking else { return }
        stop()
    }

    func setSpeakTarget(_ target: SpeakTarget) {
        speakTarget = target
        // Если прямо сейчас говорим — переподключаемся с новой инструкцией.
        if mode == .speaking {
            stop()
            start(mode: .speaking)
        }
    }

    // MARK: - Запуск/остановка конвейера

    private func start(mode newMode: Mode) {
        requestMicPermission { [weak self] granted in
            guard let self else { return }
            guard granted else {
                self.status = "Нет доступа к микрофону — разрешите в Настройках"
                return
            }
            self.launch(mode: newMode)
        }
    }

    private func launch(mode newMode: Mode) {
        let instruction: String
        let speaking = (newMode == .speaking)
        switch newMode {
        case .listening:
            instruction = Prompts.listenToRussian
            status = "Слушаю… (EN/ZH → русский в наушник)"
        case .speaking:
            instruction = Prompts.russianTo(speakTarget)
            status = "Говорите по-русски → \(speakTarget.title) в динамик"
        case .idle:
            return
        }

        do {
            try audio.configureSession(forSpeaking: speaking)
        } catch {
            status = "Ошибка аудиосессии: \(error.localizedDescription)"
            return
        }

        let client = GeminiLiveClient()
        client.onAudio = { [weak self] data in
            Task { @MainActor in self?.audio.enqueuePlayback(data) }
        }
        client.onReady = { [weak self] in
            Task { @MainActor in
                self?.isConnecting = false
                do { try self?.audio.start() }
                catch { self?.status = "Не удалось запустить звук: \(error.localizedDescription)" }
            }
        }
        client.onError = { [weak self] message in
            Task { @MainActor in
                self?.status = message
                self?.stop()
            }
        }
        self.client = client

        isConnecting = true
        mode = newMode
        client.connect(systemInstruction: instruction)
    }

    func stop() {
        audio.stop()
        client?.close()
        client = nil
        mode = .idle
        isConnecting = false
        status = "Остановлено"
    }

    // MARK: - Разрешение на микрофон

    private func requestMicPermission(_ completion: @escaping (Bool) -> Void) {
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            completion(true)
        case .denied:
            completion(false)
        case .undetermined:
            session.requestRecordPermission { granted in
                DispatchQueue.main.async { completion(granted) }
            }
        @unknown default:
            completion(false)
        }
    }
}
