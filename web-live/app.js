'use strict';

// Оркестрация: режимы «Слушаю» (EN/ZH→RU) и «Говорю» (RU→EN/ZH), связка
// микрофон ↔ Gemini Live ↔ воспроизведение.

const KEY_STORAGE = 'sync-translator:gemini-key';

const PROMPTS = {
  listen:
    'You are a real-time simultaneous interpreter at a business meeting. ' +
    'You will hear speech in English or Chinese. Automatically detect which ' +
    'language is spoken and translate it into natural, concise Russian. Speak ' +
    'ONLY the Russian translation. Never repeat the source, never explain, ' +
    'never add comments. Stay as close to real time as possible. If the speech ' +
    'is already Russian or is just noise, stay silent.',
  speak: (targetName) =>
    'You are a real-time simultaneous interpreter. You will hear speech in ' +
    'Russian. Translate it into natural, fluent ' + targetName + ' and speak ' +
    'ONLY the ' + targetName + ' translation. Never repeat the Russian, never ' +
    'explain, never add comments. Stay as close to real time as possible.',
};

const TARGETS = {
  EN: { name: 'English', label: 'Английский' },
  ZH: { name: 'Chinese (Mandarin)', label: '中文 (китайский)' },
};

const el = {
  status: document.getElementById('status'),
  listenBtn: document.getElementById('listenBtn'),
  speakBtn: document.getElementById('speakBtn'),
  segBtns: Array.from(document.querySelectorAll('.seg-btn')),
  targetName: document.getElementById('targetName'),
  subSource: document.getElementById('subSource'),
  subTarget: document.getElementById('subTarget'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsDialog: document.getElementById('settingsDialog'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  showKey: document.getElementById('showKey'),
  saveKey: document.getElementById('saveKey'),
  closeSettings: document.getElementById('closeSettings'),
};

let mode = 'idle';            // 'idle' | 'listening' | 'speaking'
let speakTarget = 'EN';
let live = null;
const audio = new AudioIO();

// --- Ключ ---

function getKey() { return localStorage.getItem(KEY_STORAGE) || ''; }

function setStatus(text) { el.status.textContent = text; }

// --- Запуск/остановка конвейера ---

function startPipeline(newMode) {
  const key = getKey();
  if (!key) { openSettings(); setStatus('Сначала введите ключ Gemini.'); return; }

  const instruction = newMode === 'listening'
    ? PROMPTS.listen
    : PROMPTS.speak(TARGETS[speakTarget].name);

  live = new GeminiLive(key);
  live.onReady = async () => {
    try {
      await audio.startCapture((pcm16) => live.sendAudio(pcm16));
      setStatus(newMode === 'listening'
        ? 'Слушаю… EN/ZH → русский в наушник'
        : 'Говорите по-русски → ' + TARGETS[speakTarget].label);
    } catch (err) {
      setStatus('Нет доступа к микрофону: ' + err.message);
      stopPipeline();
    }
  };
  live.onAudio = (buf) => audio.enqueue(buf);
  live.onInputText = (t) => { el.subSource.textContent = t; };
  live.onOutputText = (t) => { el.subTarget.textContent = t; };
  live.onError = (m) => { setStatus(m); stopPipeline(); };
  live.onClose = () => { if (mode !== 'idle') stopPipeline(); };

  mode = newMode;
  setStatus('Подключение к Gemini…');
  audio.ensurePlayback(); // разблокировать аудио по жесту пользователя
  live.connect(instruction);
}

function stopPipeline() {
  audio.stopCapture();
  audio.flushPlayback();
  if (live) { live.close(); live = null; }
  mode = 'idle';
  el.listenBtn.setAttribute('aria-pressed', 'false');
  el.listenBtn.classList.remove('is-active');
  el.speakBtn.classList.remove('is-active');
  setStatus('Остановлено.');
}

// --- Режим «Слушаю» (тумблер) ---

el.listenBtn.addEventListener('click', () => {
  if (mode === 'listening') { stopPipeline(); return; }
  if (mode === 'speaking') return;
  el.listenBtn.setAttribute('aria-pressed', 'true');
  el.listenBtn.classList.add('is-active');
  startPipeline('listening');
});

// --- Режим «Говорю» (push-to-talk) ---

function speakStart(e) {
  e.preventDefault();
  if (mode !== 'idle') return;
  el.speakBtn.classList.add('is-active');
  startPipeline('speaking');
}
function speakEnd(e) {
  e.preventDefault();
  if (mode === 'speaking') stopPipeline();
}
el.speakBtn.addEventListener('pointerdown', speakStart);
el.speakBtn.addEventListener('pointerup', speakEnd);
el.speakBtn.addEventListener('pointercancel', speakEnd);
el.speakBtn.addEventListener('pointerleave', (e) => { if (mode === 'speaking') speakEnd(e); });

// --- Выбор языка собеседника ---

el.segBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    speakTarget = btn.dataset.target;
    el.segBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
    el.targetName.textContent = TARGETS[speakTarget].label;
  });
});

// --- Настройки (ключ) ---

function openSettings() {
  el.apiKeyInput.value = getKey();
  el.settingsDialog.showModal();
}
el.settingsBtn.addEventListener('click', openSettings);
el.closeSettings.addEventListener('click', () => el.settingsDialog.close());
el.showKey.addEventListener('change', () => {
  el.apiKeyInput.type = el.showKey.checked ? 'text' : 'password';
});
el.saveKey.addEventListener('click', () => {
  const key = el.apiKeyInput.value.trim();
  if (key) localStorage.setItem(KEY_STORAGE, key);
  el.settingsDialog.close();
  setStatus(key ? 'Ключ сохранён. Можно начинать.' : 'Ключ не задан.');
});

// --- Старт ---

if (!getKey()) setStatus('Нажмите «⚙︎ Ключ» и введите ключ Gemini API.');
else setStatus('Готово. Нажмите «Слушать окружающих».');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
}
