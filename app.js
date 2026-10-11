'use strict';

const STORAGE_KEY = 'bookshelf.books.v1';
// 데이터 형식을 바꾸기 전의 원본을 한 번 보관해 두는 곳
const BACKUP_KEY = 'bookshelf.books.v1.backup';
const STATUS_LABELS = { unread: '안 읽음', reading: '읽는 중', read: '읽음' };
const OWNERSHIP_LABELS = { owned: '소장', borrowed: '대여' };

const $ = (sel) => document.querySelector(sel);

// 저장된 데이터를 읽지 못했으면 빈 목록으로 덮어쓰지 않도록 저장을 막음
let loadFailed = false;

const state = {
  books: loadBooks(),
  ownership: 'all',
  status: 'all',
  kdc: '',
  sort: 'recent',
  query: '',
  editingId: null,
};

// ---------- storage ----------

function loadBooks() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, raw);
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('형식 오류');
    return data.map(sanitizeBook).filter(Boolean);
  } catch (err) {
    console.error('책 목록을 읽지 못했어요', err);
    loadFailed = raw !== null;
    return [];
  }
}

function saveBooks() {
  if (loadFailed) {
    alert('저장된 책 목록을 읽지 못해서, 기존 기록을 지키기 위해 저장하지 않았어요. 페이지를 새로고침해 주세요.');
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.books));
  } catch {
    alert('저장에 실패했어요. 브라우저 저장소 설정을 확인해 주세요.');
  }
}

function sanitizeBook(b) {
  if (!b || typeof b.title !== 'string' || !b.title.trim()) return null;
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const digit = (v, min) => (/^\d$/.test(v) && Number(v) >= min ? v : '');

  let memo = str(b.memo);
  let kdcMain = digit(b.kdcMain, 0);
  let kdcDiv = kdcMain ? digit(b.kdcDiv, 1) : '';
  if (kdcDiv && !KDC[kdcMain].divs[kdcDiv]) kdcDiv = '';
  let litForm = kdcMain === LITERATURE ? digit(b.litForm, 1) : '';
  if (litForm === '9') litForm = '';

  // 이전 버전의 "종류"(genre)를 KDC로 옮기고, 옮길 수 없으면 메모에 남김
  const genre = str(b.genre);
  if (genre && !kdcMain) {
    const mapped = LEGACY_GENRE_MAP[genre];
    if (mapped) {
      kdcMain = mapped.main;
      kdcDiv = mapped.div || '';
      litForm = mapped.form || '';
    } else {
      memo = memo ? `${memo} (이전 종류: ${genre})` : `이전 종류: ${genre}`;
    }
  }

  const ownership = b.ownership === 'borrowed' ? 'borrowed' : 'owned';
  return {
    id: str(b.id) || newId(),
    title: b.title.trim(),
    author: str(b.author),
    publisher: str(b.publisher),
    kdcMain,
    kdcDiv,
    litForm,
    ownership,
    library: ownership === 'borrowed' ? str(b.library) : '',
    status: STATUS_LABELS[b.status] ? b.status : 'unread',
    memo,
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

// 분류 필터 값: "m:8" 주류, "d:81" 강목, "f:3" 문학 형식, "none" 미분류
function matchesKdc(book, filter) {
  if (!filter) return true;
  if (filter === 'none') return !book.kdcMain;
  const [type, v] = filter.split(':');
  if (type === 'm') return book.kdcMain === v;
  if (type === 'd') return book.kdcMain === v[0] && book.kdcDiv === v[1];
  if (type === 'f') return book.kdcMain === LITERATURE && book.litForm === v;
  return true;
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
  const inOwnership = (b) => state.ownership === 'all' || b.ownership === state.ownership;

  renderOwnership(matched);
  renderStats(state.books.filter(inOwnership));
  renderKdcFilter(state.books.filter(inOwnership));

  const visible = matched
    .filter(inOwnership)
    .filter((b) => state.status === 'all' || b.status === state.status)
    .filter((b) => matchesKdc(b, state.kdc))
    .sort(compareBooks);

  $('#bookList').innerHTML = visible.map((b) => bookItemHtml(b, q)).join('');

  const empty = $('#emptyMsg');
  if (visible.length === 0) {
    empty.hidden = false;
    empty.textContent = loadFailed
      ? '저장된 책 목록을 읽지 못했어요. 기록은 지워지지 않았으니 페이지를 새로고침해 주세요.'
      : state.books.length === 0
      ? '아직 등록된 책이 없어요. "+ 책 추가"로 첫 책을 등록해 보세요.'
      : '조건에 맞는 책이 없어요.';
  } else {
    empty.hidden = true;
  }
}

function compareBooks(a, b) {
  const byTitle = a.title.localeCompare(b.title, 'ko');
  if (state.sort === 'title') return byTitle;
  if (state.sort === 'author') return (a.author || '￿').localeCompare(b.author || '￿', 'ko') || byTitle;
  if (state.sort === 'kdc') {
    // 미분류는 맨 뒤, 같은 번호면 문학 형식까지 비교
    const key = (x) => (x.kdcMain ? kdcCode(x) + (x.litForm || '0') : '￿');
    return key(a).localeCompare(key(b)) || byTitle;
  }
  return b.addedAt - a.addedAt;
}

function bookItemHtml(b, q) {
  const meta = [b.author && highlight(b.author, q), b.publisher && highlight(b.publisher, q)].filter(Boolean).join(' · ');
  const options = Object.entries(STATUS_LABELS)
    .map(([v, label]) => `<option value="${v}"${v === b.status ? ' selected' : ''}>${label}</option>`)
    .join('');
  const kdcTag = b.kdcMain
    ? `<span class="tag kdc-tag" title="KDC ${kdcCode(b)}"><b>${kdcCode(b)}</b> ${escapeHtml(kdcName(b))}</span>`
    : '';
  const ownTag = b.ownership === 'borrowed'
    ? `<span class="tag borrowed-tag">🏛️ 대여${b.library ? ` · ${escapeHtml(b.library)}` : ''}</span>`
    : '';
  return `
    <li class="book" data-id="${escapeHtml(b.id)}" data-status="${b.status}" data-ownership="${b.ownership}">
      <div class="book-info">
        <div class="book-title">${highlight(b.title, q)}</div>
        ${meta ? `<div class="book-meta">${meta}</div>` : ''}
        ${kdcTag || ownTag ? `<div class="book-tags">${ownTag}${kdcTag}</div>` : ''}
        ${b.memo ? `<div class="book-memo">${escapeHtml(b.memo)}</div>` : ''}
      </div>
      <select class="status-select" aria-label="읽기 상태">${options}</select>
    </li>`;
}

function statusSummary(books) {
  return Object.keys(STATUS_LABELS)
    .map((s) => [s, books.filter((b) => b.status === s).length])
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${STATUS_LABELS[s]} ${n}`)
    .join(', ');
}

// 검색어가 있을 때 "집에 있는지"를 알려줌. 대여 기록은 소장으로 치지 않음.
function renderOwnership(matched) {
  const box = $('#ownership');
  const raw = state.query.trim();
  if (!raw) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const owned = matched.filter((b) => b.ownership === 'owned');
  const borrowed = matched.filter((b) => b.ownership === 'borrowed');
  const libraries = [...new Set(borrowed.map((b) => b.library).filter(Boolean))];
  const where = libraries.length ? ` (${escapeHtml(libraries.join(', '))})` : '';
  const q = `<b>"${escapeHtml(raw)}"</b>`;

  if (owned.length > 0) {
    box.className = 'ownership owned';
    box.innerHTML = `<span>✅ ${q} — 집에 있는 책이 <b>${owned.length}권</b> 있어요 (${statusSummary(owned)})` +
      `${borrowed.length ? `<br><small>도서관에서 빌려 본 기록도 ${borrowed.length}권 있어요${where}</small>` : ''}</span>`;
  } else if (borrowed.length > 0) {
    box.className = 'ownership borrowed';
    box.innerHTML = `<span>🏛️ ${q} — 집에는 없지만 도서관에서 빌려 본 책이에요${where}</span>
      <button type="button" class="primary" id="quickAddBtn">소장 도서로 추가</button>`;
  } else {
    box.className = 'ownership not-owned';
    box.innerHTML = `<span>❌ ${q} — 갖고 있지 않은 책이에요</span>
      <button type="button" class="primary" id="quickAddBtn">이 제목으로 추가</button>`;
  }
}

function renderStats(books) {
  const count = (s) => books.filter((b) => b.status === s).length;
  const items = [
    [state.ownership === 'all' ? '전체' : OWNERSHIP_LABELS[state.ownership], books.length],
    ['안 읽음', count('unread')],
    ['읽는 중', count('reading')],
    ['읽음', count('read')],
  ];
  $('#stats').innerHTML = items.map(([label, n]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join('');
}

// 지금 책장에 있는 분류만 필터에 보여줌 (주류 → 강목, 문학은 형식별로도)
function renderKdcFilter(books) {
  const opts = [];
  const add = (value, label, n) => opts.push({ value, label: `${label} (${n})` });
  const count = (filter) => books.filter((b) => matchesKdc(b, filter)).length;

  KDC.forEach((main, m) => {
    const mainKey = String(m);
    const n = count(`m:${mainKey}`);
    if (!n) return;
    add(`m:${mainKey}`, `${mainKey}00 ${main.name}`, n);
    main.divs.forEach((name, d) => {
      if (!d || !name) return;
      const dn = count(`d:${mainKey}${d}`);
      if (dn) add(`d:${mainKey}${d}`, `  └ ${mainKey}${d}0 ${name}`, dn);
    });
    if (mainKey === LITERATURE) {
      LIT_FORMS.forEach((form, f) => {
        if (!form) return;
        const fn = count(`f:${f}`);
        if (fn) add(`f:${f}`, `  └ 문학 · ${form}`, fn);
      });
    }
  });
  const none = count('none');
  if (none) add('none', '미분류', none);

  if (state.kdc && !opts.some((o) => o.value === state.kdc)) state.kdc = '';
  $('#kdcFilter').innerHTML = '<option value="">모든 분류</option>' +
    opts.map((o) => `<option value="${o.value}"${o.value === state.kdc ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
}

function uniqueValues(field) {
  return [...new Set(state.books.map((b) => b[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}

function fillDatalists() {
  const fill = (id, values) => {
    $(id).innerHTML = values.map((v) => `<option value="${escapeHtml(v)}"></option>`).join('');
  };
  fill('#authorList', uniqueValues('author'));
  fill('#publisherList', uniqueValues('publisher'));
  fill('#libraryList', uniqueValues('library'));
}

// ---------- dialog ----------

const dialog = $('#bookDialog');
const form = $('#bookForm');
const els = form.elements;

els.kdcMain.innerHTML = '<option value="">미분류</option>' +
  KDC.map((m, i) => `<option value="${i}">${i}00 ${m.name}</option>`).join('');
els.litForm.innerHTML = '<option value="">형식 선택 안 함</option>' +
  LIT_FORMS.map((f, i) => (f ? `<option value="${i}">${f}</option>` : '')).join('');

function fillDivOptions() {
  const main = els.kdcMain.value;
  els.kdcDiv.disabled = !main;
  els.kdcDiv.innerHTML = main
    ? `<option value="">${main}00 ${KDC[main].name} 전체</option>` +
      KDC[main].divs.map((name, d) => (d && name ? `<option value="${d}">${main}${d}0 ${name}</option>` : '')).join('')
    : '<option value="">강목</option>';
}

function updateKdcFields() {
  const isLit = els.kdcMain.value === LITERATURE;
  els.litForm.hidden = !isLit;
  if (!isLit) els.litForm.value = '';
  const sel = { kdcMain: els.kdcMain.value, kdcDiv: els.kdcDiv.value, litForm: els.litForm.value };
  $('#kdcPreview').textContent = sel.kdcMain ? `— ${kdcCode(sel)} ${kdcName(sel)}` : '';
}

function updateLibraryField() {
  $('#libraryField').hidden = els.ownership.value !== 'borrowed';
}

function openDialog(book, prefillTitle = '') {
  state.editingId = book ? book.id : null;
  form.reset();
  $('#dialogTitle').textContent = book ? '책 수정' : '책 추가';
  $('#deleteBtn').hidden = !book;
  $('#dupWarning').hidden = true;
  const b = book || {
    title: prefillTitle, author: '', publisher: '', kdcMain: '', kdcDiv: '', litForm: '',
    // 대여 탭을 보고 있을 때 추가하면 대여로 시작 (검색 후 "소장 도서로 추가"는 항상 소장)
    ownership: !prefillTitle && state.ownership === 'borrowed' ? 'borrowed' : 'owned',
    library: '', status: 'unread', memo: '',
  };
  for (const f of ['title', 'author', 'publisher', 'library', 'memo']) els[f].value = b[f];
  els.ownership.value = b.ownership;
  els.status.value = b.status;
  els.kdcMain.value = b.kdcMain;
  fillDivOptions();
  els.kdcDiv.value = b.kdcDiv;
  els.litForm.value = b.litForm;
  updateKdcFields();
  updateLibraryField();
  fillDatalists();
  dialog.showModal();
  els.title.focus();
}

function findDuplicate(title, author, ownership) {
  const t = normalize(title);
  const a = normalize(author);
  return state.books.find((b) => b.id !== state.editingId && b.ownership === ownership &&
    normalize(b.title) === t && (!a || !b.author || normalize(b.author) === a));
}

function updateDupWarning() {
  const dup = findDuplicate(els.title.value, els.author.value, els.ownership.value);
  const warn = $('#dupWarning');
  warn.hidden = !dup;
  if (dup) {
    warn.textContent = `⚠️ 이미 ${OWNERSHIP_LABELS[dup.ownership]} 목록에 같은 책이 있어요: ` +
      `${dup.title}${dup.author ? ` (${dup.author})` : ''} — ${STATUS_LABELS[dup.status]}`;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = sanitizeBook({
    id: state.editingId || newId(),
    title: els.title.value,
    author: els.author.value,
    publisher: els.publisher.value,
    kdcMain: els.kdcMain.value,
    kdcDiv: els.kdcDiv.value,
    litForm: els.litForm.value,
    ownership: els.ownership.value,
    library: els.library.value,
    status: els.status.value,
    memo: els.memo.value,
  });
  if (!data) return;

  if (!state.editingId && findDuplicate(data.title, data.author, data.ownership) &&
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

els.title.addEventListener('input', updateDupWarning);
els.author.addEventListener('input', updateDupWarning);
els.kdcMain.addEventListener('change', () => { fillDivOptions(); updateKdcFields(); });
els.kdcDiv.addEventListener('change', updateKdcFields);
els.litForm.addEventListener('change', updateKdcFields);
form.querySelectorAll('[name=ownership]').forEach((r) => r.addEventListener('change', () => {
  updateLibraryField();
  updateDupWarning();
}));
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

function bindTabs(containerSel, attr, key) {
  $(containerSel).addEventListener('click', (e) => {
    const btn = e.target.closest(`button[data-${attr}]`);
    if (!btn) return;
    state[key] = btn.dataset[attr];
    document.querySelectorAll(`${containerSel} button`).forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });
}
bindTabs('#ownTabs', 'own', 'ownership');
bindTabs('#statusTabs', 'status', 'status');

$('#kdcFilter').addEventListener('change', (e) => { state.kdc = e.target.value; render(); });
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

// 이전 버전 데이터(종류 → KDC)를 옮긴 결과를 바로 저장
if (state.books.length) saveBooks();
render();
