'use strict';

const STORAGE_KEY = 'bookshelf.books.v1';
const DEFAULT_GENRES = ['소설', '시', '에세이', '인문', '역사', '과학', '경제/경영', '자기계발', '예술', '만화', '아동', '기타'];
const STATUS_LABELS = { unread: '안 읽음', reading: '읽는 중', read: '읽음' };

const $ = (sel) => document.querySelector(sel);

const state = {
  books: loadBooks(),
  status: 'all',
  genre: '',
  sort: 'recent',
  query: '',
  editingId: null,
};

// ---------- storage ----------

function loadBooks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.map(sanitizeBook).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveBooks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.books));
  } catch {
    alert('저장에 실패했어요. 브라우저 저장소 설정을 확인해 주세요.');
  }
}

function sanitizeBook(b) {
  if (!b || typeof b.title !== 'string' || !b.title.trim()) return null;
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    id: str(b.id) || newId(),
    title: b.title.trim(),
    author: str(b.author),
    publisher: str(b.publisher),
    genre: str(b.genre),
    status: STATUS_LABELS[b.status] ? b.status : 'unread',
    memo: str(b.memo),
    addedAt: Number(b.addedAt) || Date.now(),
  };
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- search helpers ----------

// 대소문자·공백을 무시하고 비교 ("해리 포터" == "해리포터")
function normalize(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '');
}

function matchesQuery(book, q) {
  if (!q) return true;
  return [book.title, book.author, book.publisher].some((f) => normalize(f).includes(q));
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 공백을 무시한 매칭 위치를 원문 위치로 되돌려 <mark>로 강조
function highlight(text, q) {
  if (!q || !text) return escapeHtml(text || '');
  const map = [];
  let compact = '';
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    map.push(i);
    compact += text[i].toLowerCase();
  }
  const idx = compact.indexOf(q);
  if (idx < 0) return escapeHtml(text);
  const start = map[idx];
  const end = map[idx + q.length - 1] + 1;
  return escapeHtml(text.slice(0, start)) + '<mark>' + escapeHtml(text.slice(start, end)) + '</mark>' + escapeHtml(text.slice(end));
}

// ---------- rendering ----------

function render() {
  const q = normalize(state.query);
  const matched = state.books.filter((b) => matchesQuery(b, q));

  renderOwnership(matched);
  renderStats();
  renderGenreOptions();

  const visible = matched
    .filter((b) => state.status === 'all' || b.status === state.status)
    .filter((b) => !state.genre || b.genre === state.genre)
    .sort(compareBooks);

  const list = $('#bookList');
  list.innerHTML = visible.map((b) => bookItemHtml(b, q)).join('');

  const empty = $('#emptyMsg');
  if (visible.length === 0) {
    empty.hidden = false;
    empty.textContent = state.books.length === 0
      ? '아직 등록된 책이 없어요. "+ 책 추가"로 첫 책을 등록해 보세요.'
      : '조건에 맞는 책이 없어요.';
  } else {
    empty.hidden = true;
  }
}

function compareBooks(a, b) {
  if (state.sort === 'title') return a.title.localeCompare(b.title, 'ko');
  if (state.sort === 'author') return (a.author || '￿').localeCompare(b.author || '￿', 'ko') || a.title.localeCompare(b.title, 'ko');
  return b.addedAt - a.addedAt;
}

function bookItemHtml(b, q) {
  const meta = [b.author && highlight(b.author, q), b.publisher && highlight(b.publisher, q)].filter(Boolean).join(' · ');
  const options = Object.entries(STATUS_LABELS)
    .map(([v, label]) => `<option value="${v}"${v === b.status ? ' selected' : ''}>${label}</option>`)
    .join('');
  return `
    <li class="book" data-id="${escapeHtml(b.id)}" data-status="${b.status}">
      <div class="book-info">
        <div class="book-title">${highlight(b.title, q)}${b.genre ? `<span class="genre-tag">${escapeHtml(b.genre)}</span>` : ''}</div>
        ${meta ? `<div class="book-meta">${meta}</div>` : ''}
        ${b.memo ? `<div class="book-memo">${escapeHtml(b.memo)}</div>` : ''}
      </div>
      <select class="status-select" aria-label="읽기 상태">${options}</select>
    </li>`;
}

function renderOwnership(matched) {
  const box = $('#ownership');
  const raw = state.query.trim();
  if (!raw) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (matched.length > 0) {
    box.className = 'ownership owned';
    const counts = Object.keys(STATUS_LABELS)
      .map((s) => [s, matched.filter((b) => b.status === s).length])
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${STATUS_LABELS[s]} ${n}`)
      .join(', ');
    box.innerHTML = `<span>✅ <b>"${escapeHtml(raw)}"</b> — 갖고 있는 책이 <b>${matched.length}권</b> 있어요 (${counts})</span>`;
  } else {
    box.className = 'ownership not-owned';
    box.innerHTML = `<span>❌ <b>"${escapeHtml(raw)}"</b> — 갖고 있지 않은 책이에요</span>
      <button type="button" class="primary" id="quickAddBtn">이 제목으로 추가</button>`;
  }
}

function renderStats() {
  const count = (s) => state.books.filter((b) => b.status === s).length;
  const items = [
    ['전체', state.books.length],
    ['안 읽음', count('unread')],
    ['읽는 중', count('reading')],
    ['읽음', count('read')],
  ];
  $('#stats').innerHTML = items.map(([label, n]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join('');
}

function uniqueValues(field) {
  return [...new Set(state.books.map((b) => b[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}

function renderGenreOptions() {
  const genres = uniqueValues('genre');
  if (state.genre && !genres.includes(state.genre)) state.genre = '';
  $('#genreFilter').innerHTML = '<option value="">모든 종류</option>' +
    genres.map((g) => `<option value="${escapeHtml(g)}"${g === state.genre ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('');
}

function fillDatalists() {
  const fill = (id, values) => {
    $(id).innerHTML = values.map((v) => `<option value="${escapeHtml(v)}"></option>`).join('');
  };
  fill('#genreList', [...new Set([...DEFAULT_GENRES, ...uniqueValues('genre')])]);
  fill('#authorList', uniqueValues('author'));
  fill('#publisherList', uniqueValues('publisher'));
}

// ---------- dialog ----------

const dialog = $('#bookDialog');
const form = $('#bookForm');

function openDialog(book, prefillTitle = '') {
  state.editingId = book ? book.id : null;
  form.reset();
  $('#dialogTitle').textContent = book ? '책 수정' : '책 추가';
  $('#deleteBtn').hidden = !book;
  $('#dupWarning').hidden = true;
  const b = book || { title: prefillTitle, author: '', publisher: '', genre: '', status: 'unread', memo: '' };
  for (const f of ['title', 'author', 'publisher', 'genre', 'memo']) form.elements[f].value = b[f];
  form.elements.status.value = b.status;
  fillDatalists();
  dialog.showModal();
  form.elements.title.focus();
}

function findDuplicate(title, author) {
  const t = normalize(title);
  const a = normalize(author);
  return state.books.find((b) => b.id !== state.editingId && normalize(b.title) === t && (!a || !b.author || normalize(b.author) === a));
}

function updateDupWarning() {
  const dup = findDuplicate(form.elements.title.value, form.elements.author.value);
  const warn = $('#dupWarning');
  warn.hidden = !dup;
  if (dup) warn.textContent = `⚠️ 이미 같은 책이 있어요: ${dup.title}${dup.author ? ` (${dup.author})` : ''} — ${STATUS_LABELS[dup.status]}`;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = sanitizeBook({
    id: state.editingId || newId(),
    title: form.elements.title.value,
    author: form.elements.author.value,
    publisher: form.elements.publisher.value,
    genre: form.elements.genre.value,
    status: form.elements.status.value,
    memo: form.elements.memo.value,
  });
  if (!data) return;

  if (!state.editingId && findDuplicate(data.title, data.author) &&
      !confirm('이미 같은 책이 등록되어 있어요. 그래도 추가할까요?')) {
    return;
  }

  if (state.editingId) {
    const idx = state.books.findIndex((b) => b.id === state.editingId);
    data.addedAt = state.books[idx].addedAt;
    state.books[idx] = data;
  } else {
    state.books.push(data);
  }
  saveBooks();
  dialog.close();
  render();
});

form.elements.title.addEventListener('input', updateDupWarning);
form.elements.author.addEventListener('input', updateDupWarning);
$('#cancelBtn').addEventListener('click', () => dialog.close());

$('#deleteBtn').addEventListener('click', () => {
  const book = state.books.find((b) => b.id === state.editingId);
  if (!book || !confirm(`"${book.title}"을(를) 삭제할까요?`)) return;
  state.books = state.books.filter((b) => b.id !== state.editingId);
  saveBooks();
  dialog.close();
  render();
});

// ---------- events ----------

$('#searchInput').addEventListener('input', (e) => {
  state.query = e.target.value;
  render();
});

$('#ownership').addEventListener('click', (e) => {
  if (e.target.id === 'quickAddBtn') openDialog(null, state.query.trim());
});

$('#statusTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-status]');
  if (!btn) return;
  state.status = btn.dataset.status;
  document.querySelectorAll('#statusTabs button').forEach((b) => b.classList.toggle('active', b === btn));
  render();
});

$('#genreFilter').addEventListener('change', (e) => { state.genre = e.target.value; render(); });
$('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
$('#addBtn').addEventListener('click', () => openDialog(null));

$('#bookList').addEventListener('change', (e) => {
  if (!e.target.classList.contains('status-select')) return;
  const id = e.target.closest('.book').dataset.id;
  const book = state.books.find((b) => b.id === id);
  if (!book) return;
  book.status = e.target.value;
  saveBooks();
  render();
});

$('#bookList').addEventListener('click', (e) => {
  if (e.target.closest('.status-select')) return;
  const li = e.target.closest('.book');
  if (!li) return;
  const book = state.books.find((b) => b.id === li.dataset.id);
  if (book) openDialog(book);
});

// ---------- import / export ----------

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.books, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bookshelf-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error('형식 오류');
    const incoming = data.map(sanitizeBook).filter(Boolean);
    const existingIds = new Set(state.books.map((b) => b.id));
    const added = incoming.filter((b) => !existingIds.has(b.id));
    state.books.push(...added);
    saveBooks();
    render();
    alert(`${added.length}권을 가져왔어요.${incoming.length > added.length ? ` (이미 있는 ${incoming.length - added.length}권은 건너뜀)` : ''}`);
  } catch {
    alert('파일을 읽을 수 없어요. 이 앱에서 내보낸 JSON 파일인지 확인해 주세요.');
  }
});

render();
