import SwiftUI

struct ContentView: View {
    @StateObject private var vm = TranslatorViewModel()

    var body: some View {
        VStack(spacing: 28) {
            header

            statusCard

            Spacer()

            listenButton

            speakSection

            Spacer()

            footer
        }
        .padding(24)
        .background(Color(red: 0.06, green: 0.09, blue: 0.16).ignoresSafeArea())
        .foregroundStyle(.white)
    }

    private var header: some View {
        VStack(spacing: 4) {
            Text("Синхронный переводчик")
                .font(.title2.bold())
            Text("EN / ZH ⇄ RU · Gemini Live")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 12)
    }

    private var statusCard: some View {
        Text(vm.isConnecting ? "Подключение…" : vm.status)
            .font(.callout)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 54)
            .padding(.horizontal, 16)
            .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
    }

    // Режим «Слушаю»: непрерывный тумблер.
    private var listenButton: some View {
        Button {
            vm.toggleListening()
        } label: {
            VStack(spacing: 8) {
                Image(systemName: vm.mode == .listening ? "ear.fill" : "ear")
                    .font(.system(size: 34))
                Text(vm.mode == .listening ? "Слушаю окружающих" : "Слушать окружающих")
                    .font(.headline)
                Text("перевод в наушник (AirPods)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 22)
            .background(
                (vm.mode == .listening ? Color.green : Color.blue).opacity(0.22),
                in: RoundedRectangle(cornerRadius: 20)
            )
        }
        .disabled(vm.mode == .speaking)
    }

    // Режим «Говорю»: push-to-talk + выбор языка.
    private var speakSection: some View {
        VStack(spacing: 14) {
            Picker("Язык", selection: Binding(
                get: { vm.speakTarget },
                set: { vm.setSpeakTarget($0) }
            )) {
                ForEach(SpeakTarget.allCases) { target in
                    Text(target.rawValue).tag(target)
                }
            }
            .pickerStyle(.segmented)
            .disabled(vm.mode == .listening)

            Text("Моя речь (RU) → \(vm.speakTarget.title) в динамик")
                .font(.caption)
                .foregroundStyle(.secondary)

            Image(systemName: vm.mode == .speaking ? "mic.fill" : "mic")
                .font(.system(size: 30))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 22)
                .background(
                    (vm.mode == .speaking ? Color.orange : Color.gray).opacity(0.25),
                    in: RoundedRectangle(cornerRadius: 20)
                )
                .overlay(Text(vm.mode == .speaking ? "Говорите…" : "Зажмите, чтобы говорить")
                    .font(.subheadline).padding(.top, 70))
                // Push-to-talk: держим — говорим, отпустили — стоп.
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { _ in if vm.mode != .speaking { vm.startSpeaking() } }
                        .onEnded { _ in vm.stopSpeaking() }
                )
                .disabled(vm.mode == .listening)
        }
    }

    private var footer: some View {
        Text("Прототип. Микрофон телефона слушает комнату, перевод идёт через Gemini Live API.")
            .font(.caption2)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
    }
}

#Preview {
    ContentView()
}
