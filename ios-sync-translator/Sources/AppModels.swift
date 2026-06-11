import Foundation

// MARK: - Языки и режимы

/// Целевой язык для исходящего перевода (когда говорю я по-русски).
enum SpeakTarget: String, CaseIterable, Identifiable {
    case english = "EN"
    case chinese = "ZH"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .english: return "Английский"
        case .chinese: return "中文 (китайский)"
        }
    }

    /// Название языка для system-инструкции модели.
    var promptName: String {
        switch self {
        case .english: return "English"
        case .chinese: return "Chinese (Mandarin)"
        }
    }
}

/// Текущий режим работы переводчика.
enum Mode: Equatable {
    case idle           // ничего не делаем
    case listening      // слушаю окружающих (EN/ZH → RU) в наушник
    case speaking       // говорю я (RU → EN/ZH) в динамик
}

// MARK: - Параметры аудио

/// Gemini Live API ожидает на вход PCM 16-бит, 16 кГц, моно, little-endian,
/// а на выход отдаёт PCM 16-бит, 24 кГц, моно.
enum AudioFormatSpec {
    static let inputSampleRate: Double = 16_000
    static let outputSampleRate: Double = 24_000
    static let channels: UInt32 = 1
}

// MARK: - System-инструкции для синхронного перевода

enum Prompts {
    /// Входящий поток: слышу EN или ZH — озвучиваю по-русски.
    static let listenToRussian = """
    You are a real-time simultaneous interpreter at a business meeting.
    You will hear speech in English or Chinese. Automatically detect which \
    language is being spoken and translate it into natural, concise Russian.
    Speak ONLY the Russian translation out loud. Never repeat the source \
    language, never explain, never add comments. Keep up with the speaker and \
    stay as close to real time as possible. If the incoming speech is already \
    Russian or is just background noise, stay silent.
    """

    /// Исходящий поток: слышу русский — озвучиваю на целевом языке.
    static func russianTo(_ target: SpeakTarget) -> String {
        """
        You are a real-time simultaneous interpreter. You will hear speech in \
        Russian. Translate it into natural, fluent \(target.promptName) and \
        speak ONLY the \(target.promptName) translation out loud. Never repeat \
        the Russian, never explain, never add comments. Stay as close to real \
        time as possible.
        """
    }
}
