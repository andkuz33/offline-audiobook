const DB_NAME = "offline-audiobook-pwa";
const DB_VERSION = 1;
const BOOK_STORE = "books";
const FILE_STORE = "files";
const RATES = [1, 1.25, 1.5, 2, 2.5];
const SESSION_GAP_MS = 60000; // перерыв дольше минуты считается новым сеансом
const MAX_SESSIONS = 500;

const state = {
  books: [],
  currentBook: null,
  currentObjectUrl: null,
  saveTimer: null,
  session: null,
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
  bookmarkDialog: document.querySelector("#bookmarkDialog"),
  bookmarkDialogTitle: document.querySelector("#bookmarkDialogTitle"),
  bookmarkDialogTime: document.querySelector("#bookmarkDialogTime"),
  bookmarkNoteInput: document.querySelector("#bookmarkNoteInput"),
  bookmarkSave: document.querySelector("#bookmarkSave"),
  bookmarkCancel: document.querySelector("#bookmarkCancel"),
  reportButton: document.querySelector("#reportButton"),
  reportDialog: document.querySelector("#reportDialog"),
  reportBody: document.querySelector("#reportBody"),
  reportSave: document.querySelector("#reportSave"),
  reportExport: document.querySelector("#reportExport"),
  reportClose: document.querySelector("#reportClose"),
  aboutButton: document.querySelector("#aboutButton"),
  aboutDialog: document.querySelector("#aboutDialog"),
  aboutClose: document.querySelector("#aboutClose"),
  renameButton: document.querySelector("#renameButton"),
  renameDialog: document.querySelector("#renameDialog"),
  renameInput: document.querySelector("#renameInput"),
  renameSave: document.querySelector("#renameSave"),
  renameCancel: document.querySelector("#renameCancel"),
  audio: document.querySelector("#audio"),
  toast: document.querySelector("#toast")
};

window.addEventListener("DOMContentLoaded", init);
window.addEventListener("beforeunload", checkpoint);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) checkpoint();
});

// Фиксируем прогресс и текущий сеанс (на случай выгрузки приложения из памяти).
function checkpoint() {
  if (!elements.audio.paused) markListening();
  persistCurrentBook();
}

async function init() {
  try {
    state.db = await openDatabase();
    state.books = await loadBooks();
    await migrateTitles();
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
  elements.reportButton.addEventListener("click", openReport);
  elements.addBookmarkButton.addEventListener("click", addBookmark);
  elements.aboutButton.addEventListener("click", openAbout);
  elements.renameButton.addEventListener("click", () => {
    if (state.currentBook) renameBook(state.currentBook.id);
  });
  elements.aboutClose.addEventListener("click", () => {
    if (elements.aboutDialog.open) elements.aboutDialog.close();
  });
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
    markListening();
    startAutosave();
    updateMediaSessionPlaybackState();
  });
  elements.audio.addEventListener("pause", () => {
    elements.playPauseButton.textContent = "▶";
    elements.playPauseButton.setAttribute("aria-label", "Слушать");
    markListening();
    persistCurrentBook();
    stopAutosave();
    updateMediaSessionPlaybackState();
  });
  elements.audio.addEventListener("ended", () => {
    if (!state.currentBook) return;
    markListening();
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
      title: prettifyTitle(file.name),
      duration,
      currentPosition: 0,
      playbackRate: 1,
      lastOpenedAt: Date.now(),
      createdAt: Date.now(),
      isFinished: false,
      fileSize: file.size,
      bookmarks: [],
      sessions: [],
      firstStartedAt: null,
      lastFinishedAt: null
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
  state.session = null;
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

async function addBookmark() {
  if (!state.currentBook) return;
  const position = clamp(elements.audio.currentTime || state.currentBook.currentPosition || 0, 0, safeDuration());
  const note = await openBookmarkDialog({
    title: "Новая закладка",
    time: `Позиция: ${formatTime(position)}`,
    value: ""
  });
  if (note === null) return;
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

async function editBookmark(id) {
  const bookmark = state.currentBook?.bookmarks?.find(item => item.id === id);
  if (!bookmark) return;
  const note = await openBookmarkDialog({
    title: "Изменить комментарий",
    time: `Позиция: ${formatTime(bookmark.position)}`,
    value: bookmark.note || ""
  });
  if (note === null) return;
  bookmark.note = note;
  persistCurrentBook();
  renderBookmarks();
}

// Промис-обёртка над модальным окном с многострочным полем.
// Возвращает текст (с обрезкой пробелов) или null, если пользователь отменил.
function openBookmarkDialog({ title, time, value }) {
  return new Promise(resolve => {
    const dialog = elements.bookmarkDialog;
    if (!dialog || typeof dialog.showModal !== "function") {
      const fallback = prompt(title, value || "");
      resolve(fallback === null ? null : fallback.trim());
      return;
    }

    elements.bookmarkDialogTitle.textContent = title;
    elements.bookmarkDialogTime.textContent = time || "";
    elements.bookmarkDialogTime.classList.toggle("hidden", !time);
    elements.bookmarkNoteInput.value = value || "";

    const finish = result => {
      elements.bookmarkSave.removeEventListener("click", onSave);
      elements.bookmarkCancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      resolve(result);
    };
    const onSave = () => finish(elements.bookmarkNoteInput.value.trim());
    const onCancel = event => {
      event?.preventDefault?.();
      finish(null);
    };

    elements.bookmarkSave.addEventListener("click", onSave);
    elements.bookmarkCancel.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);

    dialog.showModal();
    elements.bookmarkNoteInput.focus();
  });
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

// Учёт сеансов прослушивания. Каждый вызов во время воспроизведения продлевает
// текущий сеанс; перерыв дольше SESSION_GAP_MS начинает новый сеанс. Данные
// хранятся прямо в записи книги, поэтому переживают перезапуск приложения.
function markListening() {
  if (!state.currentBook) return;
  const now = Date.now();
  const position = clamp(elements.audio.currentTime || 0, 0, safeDuration() || state.currentBook.duration || 0);
  let session = state.session;

  if (!session || now - session.endedAt > SESSION_GAP_MS) {
    session = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(now),
      startedAt: now,
      endedAt: now,
      listenedSeconds: 0,
      fromPosition: position,
      toPosition: position
    };
    if (!Array.isArray(state.currentBook.sessions)) state.currentBook.sessions = [];
    state.currentBook.sessions.push(session);
    state.session = session;
    if (!state.currentBook.firstStartedAt) state.currentBook.firstStartedAt = now;
    if (state.currentBook.sessions.length > MAX_SESSIONS) {
      state.currentBook.sessions.splice(0, state.currentBook.sessions.length - MAX_SESSIONS);
    }
  } else {
    session.listenedSeconds += Math.max(0, Math.round((now - session.endedAt) / 1000));
    session.endedAt = now;
    session.toPosition = position;
  }
  state.currentBook.lastFinishedAt = session.endedAt;
}

function buildReport(book) {
  const sessions = [...(book.sessions || [])].sort((a, b) => a.startedAt - b.startedAt);
  const totalListened = sessions.reduce((sum, item) => sum + (item.listenedSeconds || 0), 0);
  return {
    title: book.title,
    firstStartedAt: book.firstStartedAt || sessions[0]?.startedAt || null,
    lastFinishedAt: book.lastFinishedAt || sessions[sessions.length - 1]?.endedAt || null,
    progress: progressPercent(book),
    position: book.currentPosition || 0,
    duration: book.duration || 0,
    totalListened,
    sessionCount: sessions.length,
    days: groupSessionsByDay(sessions),
    sessions
  };
}

function openAbout() {
  const dialog = elements.aboutDialog;
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function openReport() {
  if (!state.currentBook) return;
  if (!elements.audio.paused) markListening();
  const report = buildReport(state.currentBook);
  elements.reportBody.innerHTML = renderReportHtml(report);
  const dialog = elements.reportDialog;
  elements.reportSave.onclick = () => saveReportImage(state.currentBook);
  elements.reportExport.onclick = () => exportReportText(state.currentBook);
  elements.reportClose.onclick = () => { if (dialog.open) dialog.close(); };
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function renderReportHtml(report) {
  const shown = report.days.slice(0, 40);
  const maxSeconds = Math.max(1, ...shown.map(day => day.listenedSeconds));
  const rows = shown.map(day => {
    const pct = Math.max(4, Math.round((day.listenedSeconds / maxSeconds) * 100));
    return `
    <li class="report-day">
      <div class="report-day-head">
        <span class="report-day-date">${escapeHtml(formatDateOnly(day.startedAt))}</span>
        <span class="report-day-dur">${escapeHtml(formatDurationHuman(day.listenedSeconds))}</span>
      </div>
      <div class="report-day-bar"><span style="width:${pct}%"></span></div>
    </li>`;
  }).join("");

  return `
    <div class="report-title">${escapeHtml(report.title)}</div>
    <dl class="report-stats">
      <div><dt>Начато</dt><dd>${report.firstStartedAt ? escapeHtml(formatDateTimeFull(report.firstStartedAt)) : "—"}</dd></div>
      <div><dt>Последнее прослушивание</dt><dd>${report.lastFinishedAt ? escapeHtml(formatDateTimeFull(report.lastFinishedAt)) : "—"}</dd></div>
      <div><dt>Всего прослушано</dt><dd>${escapeHtml(formatDurationHuman(report.totalListened))}</dd></div>
      <div><dt>Прогресс</dt><dd>${report.progress}% · ${formatTime(report.position)} / ${formatTime(report.duration)}</dd></div>
      <div><dt>Дней прослушивания</dt><dd>${report.days.length}</dd></div>
    </dl>
    <p class="report-sub">По дням</p>
    <ul class="report-list">${rows || '<li class="report-empty">Пока нечего показать.</li>'}</ul>
  `;
}

async function saveReportImage(book) {
  try {
    const canvas = drawReportCanvas(buildReport(book));
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("no blob");
    await shareOrDownload(new File([blob], `Отчёт — ${book.title}.png`, { type: "image/png" }));
  } catch {
    showToast("Не удалось сохранить картинку отчёта.");
  }
}

async function exportReportText(book) {
  try {
    const text = buildReportText(buildReport(book));
    const file = new File([text], `Отчёт — ${book.title}.txt`, { type: "text/plain" });
    await shareOrDownload(file);
  } catch {
    showToast("Не удалось экспортировать отчёт.");
  }
}

function buildReportText(report) {
  const lines = [
    "Отчёт о прослушивании",
    "",
    `Книга: ${report.title}`,
    `Начато: ${report.firstStartedAt ? formatDateTimeFull(report.firstStartedAt) : "—"}`,
    `Последнее прослушивание: ${report.lastFinishedAt ? formatDateTimeFull(report.lastFinishedAt) : "—"}`,
    `Всего прослушано: ${formatDurationHuman(report.totalListened)}`,
    `Прогресс: ${report.progress}% (${formatTime(report.position)} / ${formatTime(report.duration)})`,
    `Дней прослушивания: ${report.days.length}`,
    "",
    "По дням:"
  ];
  if (report.days.length === 0) {
    lines.push("  Пока нечего показать.");
  } else {
    report.days.forEach(day => {
      lines.push(`  ${formatDateOnly(day.startedAt)} · ${formatDurationHuman(day.listenedSeconds)}`);
    });
  }
  return lines.join("\n");
}

// Поделиться файлом (iPhone) или скачать (десктоп/запасной вариант).
async function shareOrDownload(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Отчёт о прослушивании" });
      return;
    } catch {
      // пользователь отменил share — переходим к скачиванию
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawReportCanvas(report) {
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const W = 760;
  const pad = 48;
  const maxText = W - pad * 2;
  const font = name => `${name}px system-ui, -apple-system, "Segoe UI", sans-serif`;

  const measure = document.createElement("canvas").getContext("2d");
  measure.font = `700 ${font(40)}`;
  const titleLines = wrapText(measure, report.title, maxText);
  const shown = report.days.slice(0, 14);

  const statRows = [
    ["Начато", report.firstStartedAt ? formatDateTimeFull(report.firstStartedAt) : "—"],
    ["Последнее прослушивание", report.lastFinishedAt ? formatDateTimeFull(report.lastFinishedAt) : "—"],
    ["Всего прослушано", formatDurationHuman(report.totalListened)],
    ["Прогресс", `${report.progress}% · ${formatTime(report.position)} / ${formatTime(report.duration)}`],
    ["Дней прослушивания", String(report.days.length)]
  ];

  const maxDaySeconds = Math.max(1, ...shown.map(day => day.listenedSeconds));
  let H = pad + 30 + titleLines.length * 50 + 16 + statRows.length * 40 + 16 + 36 + Math.max(shown.length, 1) * 50 + pad;

  const canvas = document.createElement("canvas");
  canvas.width = W * ratio;
  canvas.height = H * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.textBaseline = "top";

  ctx.fillStyle = "#0f1413";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#7fd6c7";
  ctx.fillRect(0, 0, W, 8);

  let y = pad;
  ctx.fillStyle = "#7fd6c7";
  ctx.font = `700 ${font(16)}`;
  ctx.fillText("ОТЧЁТ О ПРОСЛУШИВАНИИ", pad, y);
  y += 30;

  ctx.fillStyle = "#f4f1ea";
  ctx.font = `700 ${font(40)}`;
  for (const line of titleLines) {
    ctx.fillText(line, pad, y);
    y += 50;
  }
  y += 16;

  ctx.font = `400 ${font(20)}`;
  for (const [label, value] of statRows) {
    ctx.fillStyle = "#a9a398";
    ctx.textAlign = "left";
    ctx.fillText(label, pad, y);
    ctx.fillStyle = "#f4f1ea";
    ctx.textAlign = "right";
    ctx.fillText(value, W - pad, y);
    y += 40;
  }
  ctx.textAlign = "left";
  y += 16;

  ctx.fillStyle = "#7fd6c7";
  ctx.font = `700 ${font(22)}`;
  ctx.fillText("По дням", pad, y);
  y += 36;

  if (shown.length === 0) {
    ctx.fillStyle = "#a9a398";
    ctx.font = `400 ${font(18)}`;
    ctx.fillText("Пока нечего показать.", pad, y);
  } else {
    const barW = W - pad * 2;
    for (const day of shown) {
      ctx.fillStyle = "#f4f1ea";
      ctx.font = `400 ${font(18)}`;
      ctx.textAlign = "left";
      ctx.fillText(formatDateOnly(day.startedAt), pad, y);
      ctx.fillStyle = "#7fd6c7";
      ctx.textAlign = "right";
      ctx.fillText(formatDurationHuman(day.listenedSeconds), W - pad, y);
      y += 28;
      const pct = Math.max(0.03, day.listenedSeconds / maxDaySeconds);
      ctx.fillStyle = "#23302d";
      roundRect(ctx, pad, y, barW, 8, 4);
      ctx.fill();
      ctx.fillStyle = "#7fd6c7";
      roundRect(ctx, pad, y, Math.max(8, barW * pct), 8, 4);
      ctx.fill();
      y += 22;
    }
  }

  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return (lines.length ? lines : [String(text)]).slice(0, 3);
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
  state.saveTimer = window.setInterval(() => {
    markListening();
    persistCurrentBook();
  }, 5000);
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
        ${bookmarkCount(book) > 0 ? `<span class="book-bookmarks">🔖 ${bookmarkCount(book)}</span>` : ""}
      </div>
      <div class="progress-track"><div class="progress-fill" style="width: ${progressPercent(book)}%"></div></div>
      <div class="book-bottom">
        <span>${progressPercent(book)}%</span>
        <span>Последнее прослушивание: ${formatRelativeDate(book.lastOpenedAt)}</span>
      </div>
    </button>
    <div class="book-card-actions">
      <button type="button" class="icon-button" aria-label="Переименовать книгу" title="Переименовать">✎</button>
      <button type="button" class="danger-button">Удалить</button>
    </div>
  `;

  card.querySelector(".book-card-main").addEventListener("click", () => openBook(book.id));
  card.querySelector(".icon-button").addEventListener("click", () => renameBook(book.id));
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

async function renameBook(id) {
  const book = state.books.find(item => item.id === id) || (state.currentBook?.id === id ? state.currentBook : null);
  if (!book) return;
  const next = await openRenameDialog(book.title || "");
  if (next === null) return;
  const title = next.trim();
  if (!title || title === book.title) return;

  book.title = title;
  await saveBook(book);
  const index = state.books.findIndex(item => item.id === id);
  if (index >= 0) state.books[index] = { ...state.books[index], title };
  if (state.currentBook?.id === id) {
    state.currentBook.title = title;
    elements.playerTitle.textContent = title;
    if ("mediaSession" in navigator && navigator.mediaSession.metadata) {
      navigator.mediaSession.metadata.title = title;
    }
  }
  renderLibrary();
  showToast("Название обновлено.");
  window.setTimeout(hideToast, 1500);
}

// Промис-обёртка над модалкой переименования. Возвращает строку или null при отмене.
function openRenameDialog(value) {
  return new Promise(resolve => {
    const dialog = elements.renameDialog;
    if (!dialog || typeof dialog.showModal !== "function") {
      const fallback = prompt("Новое название книги", value || "");
      resolve(fallback === null ? null : fallback);
      return;
    }

    elements.renameInput.value = value || "";

    const finish = result => {
      elements.renameSave.removeEventListener("click", onSave);
      elements.renameCancel.removeEventListener("click", onCancel);
      elements.renameInput.removeEventListener("keydown", onKey);
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      resolve(result);
    };
    const onSave = () => finish(elements.renameInput.value);
    const onCancel = event => {
      event?.preventDefault?.();
      finish(null);
    };
    const onKey = event => {
      if (event.key === "Enter") {
        event.preventDefault();
        onSave();
      }
    };

    elements.renameSave.addEventListener("click", onSave);
    elements.renameCancel.addEventListener("click", onCancel);
    elements.renameInput.addEventListener("keydown", onKey);
    dialog.addEventListener("cancel", onCancel);

    dialog.showModal();
    elements.renameInput.focus();
    elements.renameInput.select();
  });
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

// Чистит заголовки ранее загруженных книг с подчёркиваниями в имени.
async function migrateTitles() {
  for (const book of state.books) {
    if (typeof book.title === "string" && book.title.includes("_")) {
      book.title = prettifyTitle(book.title);
      await saveBook(book);
    }
  }
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

function bookmarkCount(book) {
  return Array.isArray(book.bookmarks) ? book.bookmarks.length : 0;
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

function formatDateTimeFull(timestamp) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatClock(timestamp) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatDateOnly(timestamp) {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(timestamp));
}

// Группирует сеансы по календарным дням: сколько всего прослушано за день.
function groupSessionsByDay(sessions) {
  const byDay = new Map();
  for (const item of sessions) {
    const date = new Date(item.startedAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    let day = byDay.get(key);
    if (!day) {
      day = { key, startedAt: item.startedAt, listenedSeconds: 0 };
      byDay.set(key, day);
    }
    day.listenedSeconds += item.listenedSeconds || 0;
    if (item.startedAt < day.startedAt) day.startedAt = item.startedAt;
  }
  return [...byDay.values()].sort((a, b) => b.startedAt - a.startedAt);
}

function formatDurationHuman(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин`;
  return `${rest} сек`;
}

function stripExtension(name) {
  return name.replace(/\.[^/.]+$/, "");
}

// Делает из имени файла читаемый заголовок: убирает расширение,
// меняет подчёркивания/точки на пробелы, схлопывает пробелы и
// делает первую букву заглавной.
function prettifyTitle(name) {
  const cleaned = stripExtension(String(name))
    .replace(/[_]+/g, " ")
    .replace(/\s*\.\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return stripExtension(String(name));
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
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
