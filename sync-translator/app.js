'use strict';

/* Синхронный переводчик
 * Поток: распознавание речи (Web Speech API) → перевод (MyMemory) → озвучивание (SpeechSynthesis).
 */

// Список языков: code — короткий код для перевода (ISO-639-1),
// bcp — тег для распознавания/синтеза речи, name — подпись в интерфейсе.
const LANGUAGES = [
  { code: 'ru', bcp: 'ru-RU', name: 'Русский' },
  { code: 'en', bcp: 'en-US', name: 'Английский' },
  { code: 'uk', bcp: 'uk-UA', name: 'Украинский' },
  { code: 'de', bcp: 'de-DE', name: 'Немецкий' },
  { code: 'fr', bcp: 'fr-FR', name: 'Французский' },
  { code: 'es', bcp: 'es-ES', name: 'Испанский' },
  { code: 'it', bcp: 'it-IT', name: 'Итальянский' },
  { code: 'pt', bcp: 'pt-PT', name: 'Португальский' },
  { code: 'pl', bcp: 'pl-PL', name: 'Польский' },
  { code: 'tr', bcp: 'tr-TR', name: 'Турецкий' },
  { code: 'ar', bcp: 'ar-SA', name: 'Арабский' },
  { code: 'zh', bcp: 'zh-CN', name: 'Китайский' },
  { code: 'ja', bcp: 'ja-JP', name: 'Японский' },
  { code: 'ko', bcp: 'ko-KR', name: 'Корейский' },
];

const STORAGE_KEY = 'sync-translator:prefs';

const el = {
  source: document.getElementById('sourceLang'),
  target: document.getElementById('targetLang'),
  swap: document.getElementById('swapBtn'),
  mic: document.getElementById('micBtn'),
  micLabel: document.querySelector('.mic-label'),
  continuous: document.getElementById('continuousToggle'),
  speak: document.getElementById('speakToggle'),
  status: document.getElementById('status'),
  liveOriginal: document.getElementById('liveOriginal'),
  liveTranslation: document.getElementById('liveTranslation'),
  historyList: document.getElementById('historyList'),
  emptyHint: document.getElementById('emptyHint'),
  clear: document.getElementById('clearBtn'),
  about: document.getElementById('aboutBtn'),
  aboutDialog: document.getElementById('aboutDialog'),
  closeAbout: document.getElementById('closeAbout'),
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let listening = false;
let restartWanted = false;

// --- Инициализация интерфейса ---

function fillLanguageSelect(select, defaultCode) {
  const frag = document.createDocumentFragment();
  for (const lang of LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = lang.name;
    if (lang.code === defaultCode) opt.selected = true;
    frag.appendChild(opt);
  }
  select.appendChild(frag);
}

function langByCode(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function savePrefs() {
  const prefs = {
    source: el.source.value,
    target: el.target.value,
    continuous: el.continuous.checked,
    speak: el.speak.checked,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = 'status' + (kind ? ' ' + kind : '');
}

// --- Перевод через MyMemory (бесплатный, без ключа) ---

async function translate(text, fromCode, toCode) {
  if (fromCode === toCode) return text;
  const url =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text) +
    '&langpair=' +
    encodeURIComponent(fromCode + '|' + toCode);

  const res = await fetch(url);
  if (!res.ok) throw new Error('Сеть недоступна (' + res.status + ')');
  const data = await res.json();
  const translated = data && data.responseData && data.responseData.translatedText;
  if (!translated) throw new Error('Пустой ответ переводчика');
  // MyMemory иногда возвращает служебные сообщения заглавными буквами.
  if (/MYMEMORY WARNING|INVALID/i.test(translated)) {
    throw new Error('Сервис перевода ограничил запросы, попробуйте позже');
  }
  return translated;
}

// --- Озвучивание ---

function speak(text, bcp) {
  if (!('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = bcp;
  const voice = speechSynthesis.getVoices().find((v) => v.lang === bcp)
    || speechSynthesis.getVoices().find((v) => v.lang.startsWith(bcp.split('-')[0]));
  if (voice) utter.voice = voice;
  speechSynthesis.speak(utter);
}

// --- История ---

function addHistoryItem(original, translation, targetBcp) {
  el.emptyHint.hidden = true;
  const li = document.createElement('li');
  li.className = 'history-item';

  const src = document.createElement('div');
  src.className = 'src';
  src.textContent = original;

  const dst = document.createElement('div');
  dst.className = 'dst';

  const dstText = document.createElement('span');
  dstText.textContent = translation;

  const replay = document.createElement('button');
  replay.className = 'replay';
  replay.type = 'button';
  replay.title = 'Озвучить перевод';
  replay.textContent = '🔊';
  replay.addEventListener('click', () => speak(translation, targetBcp));

  dst.appendChild(dstText);
  dst.appendChild(replay);
  li.appendChild(src);
  li.appendChild(dst);
  el.historyList.prepend(li);
}

// --- Обработка распознанной фразы ---

async function handlePhrase(text) {
  const phrase = text.trim();
  if (!phrase) return;

  const from = langByCode(el.source.value);
  const to = langByCode(el.target.value);

  el.liveOriginal.textContent = phrase;
  el.liveTranslation.textContent = '…';
  el.liveTranslation.lang = to.code;

  try {
    const translated = await translate(phrase, from.code, to.code);
    el.liveTranslation.textContent = translated;
    addHistoryItem(phrase, translated, to.bcp);
    if (el.speak.checked) speak(translated, to.bcp);
    if (listening) setStatus('Слушаю…', 'active');
  } catch (err) {
    el.liveTranslation.textContent = '';
    setStatus('Ошибка перевода: ' + err.message, 'error');
  }
}

// --- Распознавание речи ---

function buildRecognition() {
  const rec = new SpeechRecognition();
  rec.lang = langByCode(el.source.value).bcp;
  rec.interimResults = true;
  rec.continuous = el.continuous.checked;
  rec.maxAlternatives = 1;

  rec.addEventListener('result', (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) {
        handlePhrase(transcript);
      } else {
        interim += transcript;
      }
    }
    if (interim) {
      el.liveOriginal.textContent = interim;
      el.liveOriginal.lang = langByCode(el.source.value).code;
    }
  });

  rec.addEventListener('error', (event) => {
    if (event.error === 'no-speech') return; // обычная пауза — не показываем как ошибку
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      restartWanted = false;
      setStatus('Нет доступа к микрофону. Разрешите доступ в настройках браузера.', 'error');
    } else if (event.error === 'network') {
      setStatus('Распознаванию речи нужен интернет.', 'error');
    } else {
      setStatus('Ошибка распознавания: ' + event.error, 'error');
    }
  });

  rec.addEventListener('end', () => {
    // В непрерывном режиме браузер периодически завершает сессию — перезапускаем.
    if (restartWanted) {
      try {
        rec.start();
      } catch {
        /* уже запущено */
      }
    } else {
      stopUI();
    }
  });

  return rec;
}

function startListening() {
  if (!SpeechRecognition) {
    setStatus('Этот браузер не поддерживает распознавание речи. Откройте в Chrome или Edge.', 'error');
    return;
  }
  recognition = buildRecognition();
  restartWanted = true;
  try {
    recognition.start();
    listening = true;
    el.mic.setAttribute('aria-pressed', 'true');
    el.micLabel.textContent = 'Остановить';
    setStatus('Слушаю…', 'active');
  } catch (err) {
    setStatus('Не удалось запустить микрофон: ' + err.message, 'error');
  }
}

function stopListening() {
  restartWanted = false;
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      /* ignore */
    }
  }
  stopUI();
}

function stopUI() {
  listening = false;
  el.mic.setAttribute('aria-pressed', 'false');
  el.micLabel.textContent = 'Говорите';
  if (!el.status.classList.contains('error')) setStatus('Остановлено.');
}

// --- События интерфейса ---

el.mic.addEventListener('click', () => {
  if (listening) stopListening();
  else startListening();
});

el.swap.addEventListener('click', () => {
  const s = el.source.value;
  el.source.value = el.target.value;
  el.target.value = s;
  if (recognition) recognition.lang = langByCode(el.source.value).bcp;
  savePrefs();
});

[el.source, el.target, el.continuous, el.speak].forEach((node) =>
  node.addEventListener('change', () => {
    if (node === el.source && recognition) recognition.lang = langByCode(el.source.value).bcp;
    savePrefs();
  })
);

el.clear.addEventListener('click', () => {
  el.historyList.innerHTML = '';
  el.emptyHint.hidden = false;
  el.liveOriginal.textContent = '';
  el.liveTranslation.textContent = '';
});

el.about.addEventListener('click', () => el.aboutDialog.showModal());
el.closeAbout.addEventListener('click', () => el.aboutDialog.close());

// Прогрев списка голосов (в некоторых браузерах он подгружается асинхронно).
if ('speechSynthesis' in window) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices());
}

// --- Старт ---

function init() {
  const prefs = loadPrefs();
  fillLanguageSelect(el.source, prefs.source || 'en');
  fillLanguageSelect(el.target, prefs.target || 'ru');
  if (typeof prefs.continuous === 'boolean') el.continuous.checked = prefs.continuous;
  if (typeof prefs.speak === 'boolean') el.speak.checked = prefs.speak;

  if (!SpeechRecognition) {
    el.mic.disabled = true;
    setStatus('Браузер не поддерживает распознавание речи. Откройте сайт в Chrome или Edge.', 'error');
  }
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
