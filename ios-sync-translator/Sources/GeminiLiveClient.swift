import Foundation

/// Клиент двунаправленного стрима Gemini Live API поверх WebSocket.
///
/// Поток:
///   1. `connect(systemInstruction:)` — открываем сокет и шлём setup-сообщение.
///   2. `sendAudio(_:)` — гоним чанки микрофона (PCM16 16 кГц моно).
///   3. Колбэк `onAudio` отдаёт пришедшие чанки перевода (PCM16 24 кГц моно).
final class GeminiLiveClient: NSObject {

    /// Пришёл чанк синтезированной речи перевода (PCM16 24 кГц моно).
    var onAudio: ((Data) -> Void)?
    /// Модель закончила реплику — можно, например, дать поиграть остатку буфера.
    var onTurnComplete: (() -> Void)?
    /// Setup подтверждён сервером — можно начинать слать аудио.
    var onReady: (() -> Void)?
    /// Ошибка соединения/протокола.
    var onError: ((String) -> Void)?

    private var task: URLSessionWebSocketTask?
    private lazy var session = URLSession(configuration: .default)
    private var isReady = false

    // MARK: - Соединение

    func connect(systemInstruction: String) {
        let task = session.webSocketTask(with: Config.webSocketURL)
        self.task = task
        task.resume()
        receiveLoop()
        sendSetup(systemInstruction: systemInstruction)
    }

    func close() {
        isReady = false
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func sendSetup(systemInstruction: String) {
        let setup: [String: Any] = [
            "setup": [
                "model": Config.model,
                "generationConfig": [
                    "responseModalities": ["AUDIO"],
                    "speechConfig": [
                        "voiceConfig": [
                            "prebuiltVoiceConfig": ["voiceName": Config.voiceName]
                        ]
                    ]
                ],
                "systemInstruction": [
                    "parts": [["text": systemInstruction]]
                ]
            ]
        ]
        sendJSON(setup)
    }

    // MARK: - Отправка аудио

    /// data — сырой PCM16 16 кГц моно little-endian.
    func sendAudio(_ data: Data) {
        guard isReady else { return }
        let message: [String: Any] = [
            "realtimeInput": [
                "mediaChunks": [[
                    "mimeType": "audio/pcm;rate=16000",
                    "data": data.base64EncodedString()
                ]]
            ]
        ]
        sendJSON(message)
    }

    // MARK: - Низкий уровень

    private func sendJSON(_ object: [String: Any]) {
        guard let task else { return }
        guard let payload = try? JSONSerialization.data(withJSONObject: object) else { return }
        task.send(.data(payload)) { [weak self] error in
            if let error { self?.onError?("Ошибка отправки: \(error.localizedDescription)") }
        }
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                self.onError?("Соединение прервано: \(error.localizedDescription)")
            case .success(let message):
                switch message {
                case .data(let data): self.handle(data)
                case .string(let text): self.handle(Data(text.utf8))
                @unknown default: break
                }
                self.receiveLoop()   // продолжаем слушать
            }
        }
    }

    private func handle(_ data: Data) {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        if root["setupComplete"] != nil {
            isReady = true
            onReady?()
            return
        }

        if let server = root["serverContent"] as? [String: Any] {
            if let modelTurn = server["modelTurn"] as? [String: Any],
               let parts = modelTurn["parts"] as? [[String: Any]] {
                for part in parts {
                    if let inline = part["inlineData"] as? [String: Any],
                       let b64 = inline["data"] as? String,
                       let audio = Data(base64Encoded: b64) {
                        onAudio?(audio)
                    }
                }
            }
            if server["turnComplete"] as? Bool == true {
                onTurnComplete?()
            }
        }
    }
}
