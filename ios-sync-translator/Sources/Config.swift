import Foundation

/// Конфигурация подключения к Gemini Live API.
///
/// Ключ НЕ хранится в коде. Положите его в Info.plist под ключом `GEMINI_API_KEY`
/// (можно через xcconfig / Build Settings, чтобы не коммитить). Получить ключ:
/// https://aistudio.google.com/apikey
enum Config {

    /// Модель Gemini с поддержкой Live API (потоковое аудио в обе стороны).
    /// Стабильный GA-вариант — `gemini-2.0-flash-live-001`.
    /// Для более новой 2.5 с «нативным аудио» можно поставить
    /// `gemini-live-2.5-flash-preview` (доступность зависит от региона/аккаунта).
    static let model = "models/gemini-2.0-flash-live-001"

    /// Голос синтеза речи (Gemini Live предлагает несколько преднастроенных).
    static let voiceName = "Aoede"

    static var apiKey: String {
        guard let key = Bundle.main.object(forInfoDictionaryKey: "GEMINI_API_KEY") as? String,
              !key.isEmpty, key != "YOUR_API_KEY_HERE" else {
            assertionFailure("Не задан GEMINI_API_KEY в Info.plist")
            return ""
        }
        return key
    }

    static var webSocketURL: URL {
        // Эндпоинт двунаправленного стрима Live API.
        let base = "wss://generativelanguage.googleapis.com/ws/" +
            "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
        return URL(string: "\(base)?key=\(apiKey)")!
    }
}
