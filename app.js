const DB_NAME = "offline-audiobook-pwa";
const DB_VERSION = 1;
const BOOK_STORE = "books";
const FILE_STORE = "files";
const RATES = [1, 1.25, 1.5, 2, 2.5];

const state = {
  books: [],
  currentBook: null,
  currentObjectUrl: null,
  saveTimer: null,
  db: null
};

const elements = {
  libraryView: document.querySelector("#libraryView"),
  playerView: document.querySelector("#playerView"),
  installHint: document.querySelector("#installHint"),
  importButton: document.querySelector("#importButton"),
  emptyImportButton: document.querySelector("#emptyImportButton"),
  fileInput: document.querySelector("#fileInput"),
  emptyState: document.querySelector("#emptyState"),
  lastBookSection: document.querySelector("#lastBookSection"),
  bookList: document.querySelector("#bookList"),
  backButton: document.querySelector("#backButton"),
  playerTitle: document.querySelector("#playerTitle"),
  progressSlider: document.querySelector("#progressSlider"),
  currentTime: document.querySelector("#currentTime"),
  remainingTime: document.querySelector("#remainingTime"),
  skipBackButton: document.querySelector("#skipBackButton"),
  skipForwardButton: document.querySelector("#skipForwardButton"),
  playPauseButton: document.querySelector("#playPauseButton"),
  speedButtons: document.querySelector("#speedButtons"),
  addBookmarkButton: document.querySelector("#addBookmarkButton"),
  bookmarkList: document.querySelector("#bookmarkList"),
  audio: document.querySelector("#audio"),
  toast: document.querySelector("#toast")
};

window.addEventListener("DOMContentLoaded", init);
window.addEventListener("beforeunload", persistCurrentBook);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) persistCurrentBook();
});

async function init() {
  try {
    state.db = await openDatabase();
    state.books = await loadBooks();
    bindEvents();
    renderLibrary();
    configureMediaSession();
    registerServiceWorker();
    updateInstallHint();
    await maybeResumeLastBook();
  } catch (error) {
    showToast(error.message || "Не удалось запустить приложение.");
  }
}

function bindEvents() {
  elements.importButton.addEventListener("click", () => elements.fileInput.click());
  elements.emptyImportButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", handleFileSelection);
  elements.backButton.addEventListener("click", showLibrary);
  elements.addBookmarkButton.addEventListener("click", addBookmark);
  elements.playPauseButton.addEventListener("click", togglePlayPause);
  elements.skipBackButton.addEventListener("click", () => skipBy(-15));
  elements.skipForwardButton.addEventListener("click", () => skipBy(30));
  elements.progressSlider.addEventListener("input", () => {
    const value = Number(elements.progressSlider.value);
    elements.currentTime.textContent = formatTime(value);
    elements.remainingTime.textContent = formatRemaining(safeDuration() - value);
  });
  elements.progressSlider.addEventListener("change", () => {
    elements.audio.currentTime = clamp(Number(elements.progressSlider.value), 0, safeDuration());
    persistCurrentBook();
  });

  elements.audio.addEventListener("timeupdate", updatePlaybackUi);
  elements.audio.addEventListener("loadedmetadata", () => {
    // Если iOS выгрузил медиа во время звонка, после перезагрузки
    // возвращаемся на сохранённую позицию, а не в начало файла.
    restoreSavedPosition();
    updatePlaybackUi();
  });
  // iOS при входящем звонке/другом приложении может очистить буфер аудио.
  // Запоминаем место заранее, чтобы кнопка на наушниках вернула нас туда.
  elements.audio.addEventListener("emptied", () => {
    if (state.currentBook && (elements.audio.currentTime || 0) > 1) {
      state.currentBook.currentPosition = elements.audio.currentTime;
    }
  });
  elements.audio.addEventListener("stalled", persistCurrentBook);
  elements.audio.addEventListener("play", () => {
    elements.playPauseButton.textContent = "II";
    elements.playPauseButton.setAttribute("aria-label", "Пауза");
    startAutosave();
    updateMediaSessionPlaybackState();
  });
  elements.audio.addEventListener("pause", () => {
    elements.playPauseButton.textContent = "▶";
    elements.playPauseButton.setAttribute("aria-label", "Слушать");
    persistCurrentBook();
    stopAutosave();
    updateMediaSessionPlaybackState();
  });
  elements.audio.addEventListener("ended", () => {
    if (!state.currentBook) return;
    state.currentBook.currentPosition = safeDuration();
    state.currentBook.isFinished = true;
    persistCurrentBook();
    renderLibrary();
  });

  for (const rate of RATES) {
    const button = document.createElement("button");
    button.className = "speed-button";
    button.type = "button";
    button.textContent = `${rate}x`;
    button.addEventListener("click", () => setPlaybackRate(rate));
    elements.speedButtons.append(button);
  }
}

async function handleFileSelection(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    if (!file.name.toLowerCase().endsWith(".mp3")) {
      throw new Error("Поддерживаются только MP3-файлы.");
    }

    showToast("Импортируем книгу...");
    const duration = await readAudioDuration(file);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Файл повреждён или имеет нулевую длительность.");
    }

    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const book = {
      id,
      title: stripExtension(file.name),
      duration,
      currentPosition: 0,
      playbackRate: 1,
      lastOpenedAt: Date.now(),
      createdAt: Date.now(),
      isFinished: false,
      fileSize: file.size,
      bookmarks: []
    };

    await saveAudioFile(id, file);
    await saveBook(book);
    state.books.push(book);
    renderLibrary();
    hideToast();
    await openBook(book.id);
  } catch (error) {
    showToast(error.message || "Ошибка импорта.");
  }
}

async function openBook(id) {
  const book = state.books.find(item => item.id === id);
  if (!book) return;

  await persistCurrentBook();
  revokeCurrentObjectUrl();

  const file = await readAudioFile(book.id);
  if (!file) {
    showToast("Файл книги не найден. Возможно, браузер очистил данные сайта.");
    return;
  }

  state.currentBook = book;
  state.currentObjectUrl = URL.createObjectURL(file);
  elements.audio.src = state.currentObjectUrl;
  elements.audio.playbackRate = book.playbackRate || 1;
  elements.playerTitle.textContent = book.title;
  elements.progressSlider.max = String(Math.max(book.duration, 1));
  elements.progressSlider.value = String(clamp(book.currentPosition || 0, 0, book.duration));
  updateRateButtons();
  renderBookmarks();
  showPlayer();

  elements.audio.addEventListener("loadedmetadata", function onMetadata() {
    elements.audio.removeEventListener("loadedmetadata", onMetadata);
    elements.audio.currentTime = clamp(book.currentPosition || 0, 0, safeDuration());
    updatePlaybackUi();
    updateMediaSessionPlaybackState();
  });
}

// При запуске открываем последнюю книгу в процессе, чтобы кнопку на наушниках
// можно было нажать сразу — даже после полной выгрузки приложения из памяти.
async function maybeResumeLastBook() {
  const last = [...state.books]
    .filter(book => (book.currentPosition || 0) > 1 && !book.isFinished)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
  if (last) await openBook(last.id);
}

function showPlayer() {
  elements.libraryView.classList.add("hidden");
  elements.playerView.classList.remove("hidden");
}

async function showLibrary() {
  await persistCurrentBook();
  elements.playerView.classList.add("hidden");
  elements.libraryView.classList.remove("hidden");
  renderLibrary();
}

async function togglePlayPause() {
  if (!state.currentBook) return;
  if (elements.audio.paused) {
    await playCurrent();
  } else {
    elements.audio.pause();
  }
}

// Возобновление, устойчивое к прерываниям (звонок, другое приложение).
// Если iOS выгрузил источник, переустанавливаем его и продолжаем с места.
async function playCurrent() {
  if (!state.currentBook) return;
  if (state.currentObjectUrl && (elements.audio.readyState === 0 || elements.audio.error)) {
    elements.audio.src = state.currentObjectUrl;
    elements.audio.load();
  }
  try {
    await elements.audio.play();
    restoreSavedPosition();
  } catch {
    showToast("Не удалось возобновить воспроизведение.");
  }
}

// Возврат на сохранённую позицию, если плеер сбросился к началу.
function restoreSavedPosition() {
  if (!state.currentBook) return;
  const target = clamp(state.currentBook.currentPosition || 0, 0, safeDuration());
  if (target > 1 && Math.abs((elements.audio.currentTime || 0) - target) > 1.5) {
    elements.audio.currentTime = target;
  }
}

function skipBy(seconds) {
  elements.audio.currentTime = clamp(elements.audio.currentTime + seconds, 0, safeDuration());
  updatePlaybackUi();
  persistCurrentBook();
}

function setPlaybackRate(rate) {
  elements.audio.playbackRate = rate;
  if (state.currentBook) {
    state.currentBook.playbackRate = rate;
    persistCurrentBook();
  }
  updateRateButtons();
  updateMediaSessionPosition();
}

function updatePlaybackUi() {
  const current = Number.isFinite(elements.audio.currentTime) ? elements.audio.currentTime : 0;
  const duration = safeDuration();
  elements.progressSlider.max = String(Math.max(duration, 1));
  elements.progressSlider.value = String(clamp(current, 0, duration || 1));
  elements.currentTime.textContent = formatTime(current);
  elements.remainingTime.textContent = formatRemaining(duration - current);
  updateMediaSessionPosition();
}

function updateRateButtons() {
  const activeRate = elements.audio.playbackRate || state.currentBook?.playbackRate || 1;
  for (const button of elements.speedButtons.children) {
    button.classList.toggle("active", button.textContent === `${activeRate}x`);
  }
}

function addBookmark() {
  if (!state.currentBook) return;
  const position = clamp(elements.audio.currentTime || state.currentBook.currentPosition || 0, 0, safeDuration());
  const note = (prompt("Комментарий к закладке (необязательно):", "") || "").trim();
  const bookmark = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    position,
    note,
    createdAt: Date.now()
  };
  if (!Array.isArray(state.currentBook.bookmarks)) state.currentBook.bookmarks = [];
  state.currentBook.bookmarks.push(bookmark);
  persistCurrentBook();
  renderBookmarks();
  showToast(`Закладка на ${formatTime(position)} добавлена.`);
  window.setTimeout(hideToast, 1500);
}

function editBookmark(id) {
  const bookmark = state.currentBook?.bookmarks?.find(item => item.id === id);
  if (!bookmark) return;
  const note = prompt("Комментарий к закладке:", bookmark.note || "");
  if (note === null) return;
  bookmark.note = note.trim();
  persistCurrentBook();
  renderBookmarks();
}

function deleteBookmark(id) {
  if (!state.currentBook) return;
  state.currentBook.bookmarks = (state.currentBook.bookmarks || []).filter(item => item.id !== id);
  persistCurrentBook();
  renderBookmarks();
}

function jumpToBookmark(id) {
  const bookmark = state.currentBook?.bookmarks?.find(item => item.id === id);
  if (!bookmark) return;
  elements.audio.currentTime = clamp(bookmark.position, 0, safeDuration());
  updatePlaybackUi();
  persistCurrentBook();
}

function renderBookmarks() {
  if (!elements.bookmarkList) return;
  const bookmarks = [...(state.currentBook?.bookmarks || [])].sort((a, b) => a.position - b.position);
  elements.bookmarkList.innerHTML = "";

  if (bookmarks.length === 0) {
    elements.bookmarkList.innerHTML = `<p class="bookmark-empty">Пока нет закладок.</p>`;
    return;
  }

  for (const bookmark of bookmarks) {
    const item = document.createElement("div");
    item.className = "bookmark-item";
    item.innerHTML = `
      <button type="button" class="bookmark-jump">
        <span class="bookmark-time">${formatTime(bookmark.position)}</span>
        <span class="bookmark-note">${bookmark.note ? escapeHtml(bookmark.note) : "Без комментария"}</span>
      </button>
      <button type="button" class="bookmark-action" aria-label="Изменить комментарий">✎</button>
      <button type="button" class="bookmark-action" aria-label="Удалить закладку">✕</button>
    `;
    const actions = item.querySelectorAll(".bookmark-action");
    item.querySelector(".bookmark-jump").addEventListener("click", () => jumpToBookmark(bookmark.id));
    actions[0].addEventListener("click", () => editBookmark(bookmark.id));
    actions[1].addEventListener("click", () => deleteBookmark(bookmark.id));
    elements.bookmarkList.append(item);
  }
}

async function persistCurrentBook() {
  if (!state.currentBook) return;
  const duration = state.currentBook.duration || safeDuration();
  state.currentBook.currentPosition = clamp(elements.audio.currentTime || 0, 0, duration);
  state.currentBook.playbackRate = elements.audio.playbackRate || 1;
  state.currentBook.lastOpenedAt = Date.now();
  state.currentBook.isFinished = duration > 0 && state.currentBook.currentPosition / duration >= 0.95;
  await saveBook(state.currentBook);
  const index = state.books.findIndex(book => book.id === state.currentBook.id);
  if (index >= 0) state.books[index] = { ...state.currentBook };
}

function startAutosave() {
  stopAutosave();
  state.saveTimer = window.setInterval(persistCurrentBook, 5000);
}

function stopAutosave() {
  if (state.saveTimer) {
    window.clearInterval(state.saveTimer);
    state.saveTimer = null;
  }
}

function renderLibrary() {
  const books = [...state.books].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  elements.emptyState.classList.toggle("hidden", books.length > 0);
  elements.bookList.innerHTML = "";

  const lastBook = books.find(book => (book.currentPosition || 0) > 1);
  renderLastBook(lastBook);

  for (const book of books) {
    elements.bookList.append(renderBookCard(book));
  }
}

function renderLastBook(book) {
  if (!book) {
    elements.lastBookSection.classList.add("hidden");
    elements.lastBookSection.innerHTML = "";
    return;
  }

  elements.lastBookSection.classList.remove("hidden");
  elements.lastBookSection.innerHTML = `
    <p class="section-label">Последняя книга</p>
    <button type="button">
      <div class="book-title">${escapeHtml(book.title)}</div>
      <div class="progress-track"><div class="progress-fill" style="width: ${progressPercent(book)}%"></div></div>
      <div class="book-bottom"><span>Продолжить</span><span>${progressPercent(book)}%</span></div>
    </button>
  `;
  elements.lastBookSection.querySelector("button").addEventListener("click", () => openBook(book.id));
}

function renderBookCard(book) {
  const card = document.createElement("article");
  card.className = "book-card";
  card.innerHTML = `
    <button type="button" class="book-card-main">
      <div class="book-title">${escapeHtml(book.title)}</div>
      <div class="book-meta">
        <span>${statusText(book)}</span>
        <span>${formatTime(book.duration)}</span>
        <span>${formatFileSize(book.fileSize)}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width: ${progressPercent(book)}%"></div></div>
      <div class="book-bottom">
        <span>${progressPercent(book)}%</span>
        <span>Последнее прослушивание: ${formatRelativeDate(book.lastOpenedAt)}</span>
      </div>
    </button>
    <button type="button" class="danger-button">Удалить</button>
  `;

  card.querySelector(".book-card-main").addEventListener("click", () => openBook(book.id));
  card.querySelector(".danger-button").addEventListener("click", () => deleteBook(book.id));
  return card;
}

async function deleteBook(id) {
  const book = state.books.find(item => item.id === id);
  if (!book) return;
  if (!confirm(`Удалить «${book.title}» из приложения?`)) return;

  if (state.currentBook?.id === id) {
    elements.audio.pause();
    revokeCurrentObjectUrl();
    state.currentBook = null;
  }

  await deleteAudioFile(id);
  await deleteBookRecord(id);
  state.books = state.books.filter(item => item.id !== id);
  renderLibrary();
}

function configureMediaSession() {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.setActionHandler("play", () => playCurrent());
  navigator.mediaSession.setActionHandler("pause", () => elements.audio.pause());
  navigator.mediaSession.setActionHandler("seekbackward", event => skipBy(-(event.seekOffset || 15)));
  navigator.mediaSession.setActionHandler("seekforward", event => skipBy(event.seekOffset || 30));
  navigator.mediaSession.setActionHandler("seekto", event => {
    if (typeof event.seekTime === "number") {
      elements.audio.currentTime = clamp(event.seekTime, 0, safeDuration());
    }
  });
}

function updateMediaSessionPlaybackState() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = elements.audio.paused ? "paused" : "playing";
  if (state.currentBook) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.currentBook.title,
      artist: "Offline AudioBook",
      album: "Аудиокнига"
    });
  }
}

function updateMediaSessionPosition() {
  if (!("mediaSession" in navigator) || typeof navigator.mediaSession.setPositionState !== "function") return;
  const duration = safeDuration();
  if (!duration) return;
  navigator.mediaSession.setPositionState({
    duration,
    playbackRate: elements.audio.playbackRate || 1,
    position: clamp(elements.audio.currentTime || 0, 0, duration)
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOK_STORE)) {
        db.createObjectStore(BOOK_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function loadBooks() {
  return requestFromStore(BOOK_STORE, "readonly", store => store.getAll()).then(result => result || []);
}

function saveBook(book) {
  return requestFromStore(BOOK_STORE, "readwrite", store => store.put({ ...book }));
}

function deleteBookRecord(id) {
  return requestFromStore(BOOK_STORE, "readwrite", store => store.delete(id));
}

function saveAudioFile(id, file) {
  return requestFromStore(FILE_STORE, "readwrite", store => store.put({
    id,
    blob: file,
    type: file.type || "audio/mpeg",
    name: file.name,
    size: file.size
  }));
}

async function readAudioFile(id) {
  const record = await requestFromStore(FILE_STORE, "readonly", store => store.get(id));
  if (!record?.blob) return null;
  return new File([record.blob], record.name || `${id}.mp3`, { type: record.type || "audio/mpeg" });
}

function deleteAudioFile(id) {
  return requestFromStore(FILE_STORE, "readwrite", store => store.delete(id));
}

function requestFromStore(storeName, mode, makeRequest) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, mode);
    const request = makeRequest(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Файл повреждён."));
    };
    audio.src = url;
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./service-worker.js").catch(() => {
    showToast("Офлайн-режим сайта недоступен в этом браузере.");
  });
}

function updateInstallHint() {
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (elements.installHint && isIOS && !isStandalone) {
    elements.installHint.classList.remove("hidden");
  }
}

function revokeCurrentObjectUrl() {
  if (state.currentObjectUrl) {
    URL.revokeObjectURL(state.currentObjectUrl);
    state.currentObjectUrl = null;
  }
}

function safeDuration() {
  return Number.isFinite(elements.audio.duration) ? elements.audio.duration : (state.currentBook?.duration || 0);
}

function progressPercent(book) {
  if (!book.duration) return 0;
  return Math.min(100, Math.max(0, Math.round((book.currentPosition / book.duration) * 100)));
}

function statusText(book) {
  const progress = book.duration ? book.currentPosition / book.duration : 0;
  if (book.isFinished || progress >= 0.95) return "Прослушано";
  if (book.currentPosition > 1) return "В процессе";
  return "Не начато";
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatRemaining(seconds) {
  return `-${formatTime(Math.max(seconds || 0, 0))}`;
}

function formatFileSize(bytes) {
  return new Intl.NumberFormat("ru-RU", {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: 1
  }).format((bytes || 0) / 1024 / 1024);
}

function formatRelativeDate(timestamp) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function stripExtension(name) {
  return name.replace(/\.[^/.]+$/, "");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
}

function hideToast() {
  elements.toast.classList.add("hidden");
}
