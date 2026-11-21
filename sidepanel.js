const $ = (id) => document.getElementById(id);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

const svgUrl = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const GLOBE = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="#8e8e99" stroke-width="1.2"/><path d="M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13" fill="none" stroke="#8e8e99" stroke-width="1.2"/></svg>');
const FOLDER = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1.5 4.2c0-.7.5-1.2 1.2-1.2h3.4l1.4 1.5h5.8c.7 0 1.2.5 1.2 1.2v6.6c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z" fill="#8e8e99"/></svg>');
const GITHUB = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#8e8e99" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>');
const PR_OPEN = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#1a7f37" d="M1.5 3.25a2.25 2.25 0 113 2.12v5.26a2.25 2.25 0 11-1.5 0V5.37A2.25 2.25 0 011.5 3.25zm5.68-.78L9.46.19A.25.25 0 019.88.36V1.5h1.37A2.75 2.75 0 0114 4.25v6.38a2.25 2.25 0 11-1.5 0V4.25c0-.69-.56-1.25-1.25-1.25H9.88v1.14a.25.25 0 01-.42.18L7.18 2.04a.25.25 0 010-.35z"/></svg>');
const PR_DRAFT = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#8e8e99" d="M3.25 1A2.25 2.25 0 014 5.37v5.26a2.25 2.25 0 11-1.5 0V5.37A2.25 2.25 0 013.25 1zm9.5 14a2.25 2.25 0 110-4.5 2.25 2.25 0 010 4.5zm0-6a.75.75 0 110-1.5.75.75 0 010 1.5zm0-3.5a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>');

const EMOJIS = ['⭐️','🔥','🚀','💡','✅','📌','📎','📝','📚','📅','📈','💬','📧','🎯','🧠','🛠️','🐛','🔒','🔑','⚙️','🧪','💻','🖥️','📦','🌐','🏠','💼','💰','🛒','🎵','🎨','📷','✈️','🍕','☕️','❤️','💜','💙','💚','🟣'];

const state = {
  windowId: null,
  rootId: null,
  favoritesId: null,
  root: null,
  tabs: [],
  tabOverrides: {},
  tabLinks: {},
  meta: {},
  prData: null,
  prLoading: false,
  hasToken: false,
  settings: {},
  ui: { open: {}, prOpen: true, prGroups: { review: true, mine: true, assigned: true } },
  editing: false,
  pendingRenameId: null,
  selected: new Set(), // tab ids selected in Today (shift/⌘-click)
  anchor: null,        // where a shift-click range starts
};

// ---------- messaging ----------
async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || `${type} failed`);
  return res.result;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 1800);
}

const attempt = (fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { toast(e.message || String(e)); }
};

// ---------- icons ----------
function faviconFor(url) {
  if (!url) return GLOBE;
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
}

function tabIcon(tab) {
  const ov = state.tabOverrides[tab.id];
  if (ov?.icon) return ov.icon;
  if (tab.favIconUrl && /^(https?:|data:)/.test(tab.favIconUrl)) return tab.favIconUrl;
  return faviconFor(tab.url || tab.pendingUrl);
}

function bookmarkIcon(node) {
  const custom = state.meta[node.id]?.icon;
  if (custom) return custom;
  if (!node.url) return FOLDER;
  const tab = linkedTab(node.id);
  if (tab?.favIconUrl && /^(https?:|data:)/.test(tab.favIconUrl)) return tab.favIconUrl;
  return faviconFor(node.url);
}

function img(src, cls = 'ico') {
  return h('img', { class: cls, src, alt: '', draggable: 'false', onError: (e) => { if (e.target.src !== GLOBE) e.target.src = GLOBE; } });
}

function emojiToPng(emoji) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '52px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 32, 36);
  return c.toDataURL('image/png');
}

async function fileToPng(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const scale = Math.min(64 / bmp.width, 64 / bmp.height);
  const w = bmp.width * scale;
  const ht = bmp.height * scale;
  c.getContext('2d').drawImage(bmp, (64 - w) / 2, (64 - ht) / 2, w, ht);
  return c.toDataURL('image/png');
}

// ---------- lookups ----------
function linkedTab(bookmarkId) {
  for (const [tid, bid] of Object.entries(state.tabLinks)) {
    if (bid !== bookmarkId) continue;
    const tab = state.tabs.find((t) => t.id === Number(tid));
    if (tab) return tab;
  }
  return null;
}

function tabTitle(tab) {
  return state.tabOverrides[tab.id]?.title || tab.title || tab.url || 'New Tab';
}

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

function allFolders() {
  const out = [];
  (function walk(n, depth) {
    for (const c of n?.children || []) {
      if (c.url || c.id === state.favoritesId) continue;
      out.push({ node: c, depth });
      walk(c, depth + 1);
    }
  })(state.root, 0);
  return out;
}

const windowTabs = () => state.tabs.filter((t) => t.windowId === state.windowId).sort((a, b) => a.index - b.index);

// ---------- loading ----------
async function loadTabs() { state.tabs = await chrome.tabs.query({}); }
async function loadSession() {
  const s = await chrome.storage.session.get(['tabOverrides', 'tabLinks']);
  state.tabOverrides = s.tabOverrides || {};
  state.tabLinks = s.tabLinks || {};
}
async function loadTree() {
  try {
    [state.root] = await chrome.bookmarks.getSubTree(state.rootId);
  } catch {
    ({ rootId: state.rootId, favoritesId: state.favoritesId } = await send('getRoots'));
    [state.root] = await chrome.bookmarks.getSubTree(state.rootId);
  }
}
async function loadLocal() {
  const l = await chrome.storage.local.get(['bookmarkMeta', 'prData', 'prLoading', 'githubToken', 'settings', 'uiState']);
  state.meta = l.bookmarkMeta || {};
  state.prData = l.prData || null;
  state.prLoading = !!l.prLoading;
  state.hasToken = !!l.githubToken;
  state.settings = l.settings || {};
  if (l.uiState) state.ui = { ...state.ui, ...l.uiState, prGroups: { ...state.ui.prGroups, ...(l.uiState.prGroups || {}) } };
}

function saveUi() { chrome.storage.local.set({ uiState: state.ui }); }

// ---------- render ----------
let renderQueued = false;
let renderDeferred = false;
// Rebuilding rows between the two clicks of a double-click would detach the
// element under the pointer, so hold re-renders briefly after each press.
let holdUntil = 0;
document.addEventListener('pointerdown', () => { holdUntil = performance.now() + 450; }, true);
function render() {
  if (state.editing) { renderDeferred = true; return; }
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(function run() {
    const wait = holdUntil - performance.now();
    if (wait > 0) { setTimeout(run, wait); return; }
    renderQueued = false;
    if (state.editing) { renderDeferred = true; return; }
    const scroll = $('scroll').scrollTop;
    renderFavorites();
    renderFolders();
    renderPRs();
    renderTabs();
    $('scroll').scrollTop = scroll;
    if (state.pendingRenameId) {
      const id = state.pendingRenameId;
      state.pendingRenameId = null;
      const row = document.querySelector(`[data-bookmark-id="${id}"]`);
      if (row) beginBookmarkRename(row, findNode(state.root, id));
    }
  }, 16);
}

function activeTabId() {
  return state.tabs.find((t) => t.active && t.windowId === state.windowId)?.id;
}

// ---------- drag & drop ----------
const DT_TAB = 'application/x-arc-tab';
const DT_BM = 'application/x-arc-bookmark';

function dragKind(e) {
  const types = e.dataTransfer?.types || [];
  if (types.includes(DT_TAB)) return 'tab';
  if (types.includes(DT_BM)) return 'bookmark';
  return null;
}

function clearDropMarks() {
  document.querySelectorAll('.drop-target,.drop-before,.dragging').forEach((el) => el.classList.remove('drop-target', 'drop-before', 'dragging'));
}

function makeDraggable(el, type, id, url) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    // Dragging one of several selected tabs drags all of them.
    const ids = type === DT_TAB && state.selected.has(id) && state.selected.size > 1 ? selectedTabIds() : [id];
    e.dataTransfer.setData(type, ids.join(','));
    if (ids.length > 1) {
      const ghost = h('div', { class: 'drag-ghost', text: `${ids.length} tabs` });
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 10);
      setTimeout(() => ghost.remove());
    }
    if (url) e.dataTransfer.setData('text/uri-list', url);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  el.addEventListener('dragend', clearDropMarks);
}

function makeDropTarget(el, { accepts, onDrop, cls = 'drop-target' }) {
  el.addEventListener('dragover', (e) => {
    const kind = dragKind(e);
    if (!kind || !accepts.includes(kind)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll(`.${cls}`).forEach((n) => n !== el && n.classList.remove(cls));
    el.classList.add(cls);
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove(cls);
  });
  el.addEventListener('drop', (e) => {
    const kind = dragKind(e);
    if (!kind || !accepts.includes(kind)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    const raw = e.dataTransfer.getData(kind === 'tab' ? DT_TAB : DT_BM);
    const ids = kind === 'tab' ? raw.split(',').map(Number) : [raw];
    attempt(onDrop)(kind, ids.length > 1 ? ids : ids[0]);
  });
}

async function dropIntoFolder(kind, id, parentId, index) {
  if (kind === 'tab') return addTabsToFolder(Array.isArray(id) ? id : [id], parentId, index);
  if (id === parentId) return;
  await chrome.bookmarks.move(id, index == null ? { parentId } : { parentId, index });
}

// Dragging a bookmark into Today "unpins" it: the tab stays, the bookmark goes.
async function dropIntoToday(kind, id, index) {
  if (kind === 'tab') return chrome.tabs.move(id, { index: index ?? -1 }); // id may be a list
  const [node] = await chrome.bookmarks.get(id);
  if (!node.url) return toast('Drag individual tabs into Today, not folders');
  let tab = linkedTab(id);
  if (!tab) tab = await chrome.tabs.create({ url: node.url, windowId: state.windowId });
  await send('unlinkTab', { tabId: tab.id });
  await chrome.bookmarks.remove(id);
  if (index != null) await chrome.tabs.move(tab.id, { index });
}

// ---------- inline rename ----------
function inlineRename(titleEl, initial, commit) {
  state.editing = true;
  const input = h('input', { class: 'rename', type: 'text', spellcheck: 'false' });
  input.value = initial;
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    try { if (save && value !== initial) await commit(value); } catch (e) { toast(e.message); }
    state.editing = false;
    renderDeferred = false;
    input.replaceWith(titleEl);
    render();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  ['click', 'dblclick', 'mousedown'].forEach((ev) => input.addEventListener(ev, (e) => e.stopPropagation()));
  titleEl.replaceWith(input);
  input.focus();
  input.select();
}

function beginTabRename(row, tab) {
  inlineRename(row.querySelector('.title'), tabTitle(tab), (title) => send('renameTab', { tabId: tab.id, title }));
}

function beginBookmarkRename(row, node) {
  if (!node) return;
  inlineRename(row.querySelector('.title'), node.title, (title) => title && send('renameBookmark', { bookmarkId: node.id, title }));
}

// ---------- menus ----------
function closeMenu() { $('menu').hidden = true; }
function closePicker() { $('picker').hidden = true; }

function place(el, x, y) {
  el.hidden = false;
  el.style.left = '0px';
  el.style.top = '0px';
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(6, Math.min(x, innerWidth - r.width - 6))}px`;
  el.style.top = `${Math.max(6, Math.min(y, innerHeight - r.height - 6))}px`;
}

function showMenu(x, y, items, title) {
  closePicker();
  const m = $('menu');
  const kids = [];
  if (title) kids.push(h('div', { class: 'menu-title', text: title }));
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { kids.push(h('div', { class: 'sep' })); continue; }
    const btn = h('button', { class: it.danger ? 'danger' : '', disabled: it.disabled },
      h('span', { text: it.label }), it.hint ? h('span', { class: 'hint', text: it.hint }) : null);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (it.submenu) return showMenu(x, y, it.submenu(), it.label);
      if (it.confirm && !btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.firstChild.textContent = it.confirm;
        return;
      }
      closeMenu();
      attempt(it.onClick)();
    });
    kids.push(btn);
  }
  m.replaceChildren(...kids);
  place(m, x, y);
}

function folderSubmenu(onPick, { includeFavorites = true } = {}) {
  const items = [];
  if (includeFavorites) items.push({ label: '★ Favorites', onClick: () => onPick(state.favoritesId) });
  items.push({ label: 'Top level', onClick: () => onPick(state.rootId) });
  const folders = allFolders();
  if (folders.length) items.push('sep');
  for (const { node, depth } of folders) {
    items.push({ label: `${' '.repeat(depth)}${node.title || 'Untitled'}`, onClick: () => onPick(node.id) });
  }
  items.push('sep', {
    label: 'New folder…',
    onClick: async () => {
      const folder = await chrome.bookmarks.create({ parentId: state.rootId, title: 'New Folder' });
      state.ui.open[folder.id] = true;
      saveUi();
      await onPick(folder.id);
      state.pendingRenameId = folder.id;
    },
  });
  return items;
}

// ---------- icon picker ----------
function showPicker(x, y, title, onPick) {
  closeMenu();
  const p = $('picker');
  const apply = attempt(async (icon) => { closePicker(); await onPick(icon); });
  const custom = h('input', { type: 'text', placeholder: 'Type or paste an emoji', maxlength: '16' });
  const useCustom = () => {
    const v = custom.value.trim();
    if (!v) return;
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const first = [...seg.segment(v)][0]?.segment || v;
    apply(emojiToPng(first));
  };
  custom.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') useCustom(); });
  const file = $('file-input');
  file.value = '';
  file.onchange = attempt(async () => { if (file.files[0]) apply(await fileToPng(file.files[0])); });
  p.replaceChildren(
    h('h4', { text: title }),
    h('div', { class: 'emoji-grid' }, EMOJIS.map((em) => h('button', { text: em, title: em, onClick: () => apply(emojiToPng(em)) }))),
    h('div', { class: 'picker-row' }, custom, h('button', { class: 'btn primary', text: 'Use', onClick: useCustom })),
    h('div', { class: 'picker-row' },
      h('button', { class: 'btn', text: 'Upload image…', onClick: () => file.click() }),
      h('button', { class: 'btn', text: 'Reset to default', onClick: () => apply(null) })),
  );
  place(p, x, y);
  custom.focus();
}

const pickTabIcon = (x, y, tab) => showPicker(x, y, 'Change tab icon', (icon) => send('setTabIcon', { tabId: tab.id, icon }));
const pickBookmarkIcon = (x, y, node) => showPicker(x, y, node.url ? 'Change icon' : 'Change folder icon', (icon) => send('setBookmarkIcon', { bookmarkId: node.id, icon }));

// ---------- favorites ----------
function renderFavorites() {
  const box = $('favorites');
  const fav = findNode(state.root, state.favoritesId);
  const activeId = activeTabId();
  const tiles = (fav?.children || []).filter((c) => c.url).map((node) => {
    const tab = linkedTab(node.id);
    const el = h('button', {
      class: `fav${tab ? ' open' : ''}${tab && tab.id === activeId ? ' active' : ''}`,
      title: node.title,
      dataset: { bookmarkId: node.id },
      onClick: attempt(() => send('openBookmark', { bookmarkId: node.id, windowId: state.windowId })),
      onContextmenu: (e) => { e.preventDefault(); bookmarkMenu(e.clientX, e.clientY, node, { favorite: true }); },
    }, img(bookmarkIcon(node), ''));
    makeDraggable(el, DT_BM, node.id, node.url);
    makeDropTarget(el, { accepts: ['tab', 'bookmark'], cls: 'drop-before', onDrop: (kind, id) => dropIntoFolder(kind, id, state.favoritesId, node.index) });
    return el;
  });
  tiles.push(h('button', {
    class: 'fav add',
    title: 'Add current tab to Favorites (or drag a tab here)',
    text: '+',
    onClick: attempt(async () => {
      const id = activeTabId();
      if (id != null) await send('addTabToFolder', { tabId: id, parentId: state.favoritesId });
    }),
  }));
  box.replaceChildren(...tiles);
}

// ---------- folders ----------
function bookmarkRow(node) {
  const tab = linkedTab(node.id);
  const active = tab && tab.id === activeTabId();
  const titleEl = h('span', { class: 'title', text: node.title || node.url });
  const icon = img(bookmarkIcon(node));
  const row = h('div', {
    class: `row${active ? ' active' : ''}${tab ? '' : ' dim'}`,
    title: node.url,
    dataset: { bookmarkId: node.id },
    onClick: attempt(() => send('openBookmark', { bookmarkId: node.id, windowId: state.windowId })),
    onAuxclick: attempt((e) => e.button === 1 && send('openBookmark', { bookmarkId: node.id, windowId: state.windowId, background: true })),
    onContextmenu: (e) => { e.preventDefault(); bookmarkMenu(e.clientX, e.clientY, node); },
  },
  icon,
  titleEl,
  tab?.audible ? h('span', { class: 'meta-icons', text: tab.mutedInfo?.muted ? '🔇' : '🔊' }) : null,
  tab ? h('button', {
    class: 'close', title: 'Close tab (keeps it in the folder)', text: '×',
    onClick: attempt((e) => { e.stopPropagation(); return chrome.tabs.remove(tab.id); }),
  }) : null);
  titleEl.addEventListener('dblclick', (e) => { e.stopPropagation(); beginBookmarkRename(row, node); });
  icon.addEventListener('dblclick', (e) => { e.stopPropagation(); pickBookmarkIcon(e.clientX, e.clientY, node); });
  makeDraggable(row, DT_BM, node.id, node.url);
  makeDropTarget(row, { accepts: ['tab', 'bookmark'], cls: 'drop-before', onDrop: (kind, id) => dropIntoFolder(kind, id, node.parentId, node.index) });
  return row;
}

function folderEl(node) {
  const open = !!state.ui.open[node.id];
  const count = (node.children || []).filter((c) => c.url).length;
  const titleEl = h('span', { class: 'title', text: node.title || 'Untitled' });
  const icon = img(bookmarkIcon(node));
  const row = h('div', {
    class: 'row folder-row',
    dataset: { bookmarkId: node.id },
    onClick: () => { state.ui.open[node.id] = !open; saveUi(); render(); },
    onContextmenu: (e) => { e.preventDefault(); folderMenu(e.clientX, e.clientY, node); },
  },
  h('span', { class: `chev${open ? ' open' : ''}`, text: '▶' }),
  icon,
  titleEl,
  count ? h('span', { class: 'badge', text: count }) : null);
  titleEl.addEventListener('dblclick', (e) => { e.stopPropagation(); beginBookmarkRename(row, node); });
  icon.addEventListener('dblclick', (e) => { e.stopPropagation(); pickBookmarkIcon(e.clientX, e.clientY, node); });
  makeDraggable(row, DT_BM, node.id);
  makeDropTarget(row, { accepts: ['tab', 'bookmark'], onDrop: (kind, id) => dropIntoFolder(kind, id, node.id) });
  const wrap = h('div', { class: 'folder' }, row);
  if (open) {
    const kids = (node.children || []).map((c) => (c.url ? bookmarkRow(c) : folderEl(c)));
    const children = h('div', { class: 'children' }, kids.length ? kids : h('div', { class: 'empty', text: 'Drag tabs here' }));
    makeDropTarget(children, { accepts: ['tab', 'bookmark'], onDrop: (kind, id) => dropIntoFolder(kind, id, node.id) });
    wrap.append(children);
  }
  return wrap;
}

function renderFolders() {
  const box = $('folders');
  const kids = (state.root?.children || []).filter((c) => c.id !== state.favoritesId);
  const head = h('div', { class: 'section-head' },
    h('span', { text: 'Folders' }),
    h('button', { class: 'link-btn', title: 'New folder', text: '+ New folder', onClick: attempt(newFolder) }));
  const body = h('div', {}, kids.map((c) => (c.url ? bookmarkRow(c) : folderEl(c))));
  if (!kids.length) body.append(h('div', { class: 'empty', text: 'Create a folder, then drag tabs into it.' }));
  makeDropTarget(body, { accepts: ['tab', 'bookmark'], onDrop: (kind, id) => dropIntoFolder(kind, id, state.rootId) });
  box.replaceChildren(head, body);
}

async function newFolder(parentId = state.rootId) {
  const folder = await chrome.bookmarks.create({ parentId, title: 'New Folder' });
  state.ui.open[folder.id] = true;
  if (parentId !== state.rootId) state.ui.open[parentId] = true;
  saveUi();
  state.pendingRenameId = folder.id;
  render();
}

function bookmarkMenu(x, y, node, { favorite = false } = {}) {
  const tab = linkedTab(node.id);
  const row = () => document.querySelector(`.row[data-bookmark-id="${node.id}"]`);
  showMenu(x, y, [
    { label: tab ? 'Go to tab' : 'Open', onClick: () => send('openBookmark', { bookmarkId: node.id, windowId: state.windowId }) },
    { label: 'Open in background', disabled: !!tab, onClick: () => send('openBookmark', { bookmarkId: node.id, windowId: state.windowId, background: true }) },
    'sep',
    {
      label: 'Rename…',
      onClick: () => {
        const r = row();
        if (r) return beginBookmarkRename(r, node);
        const title = prompt('Rename', node.title);
        if (title) return send('renameBookmark', { bookmarkId: node.id, title });
      },
    },
    { label: 'Change icon…', onClick: () => pickBookmarkIcon(x, y, node) },
    { label: 'Copy link', onClick: async () => { await send('copyText', { text: node.url }); toast('Copied link'); } },
    tab && tab.url !== node.url ? { label: 'Save current page as this item', onClick: () => chrome.bookmarks.update(node.id, { url: tab.url }) } : null,
    tab && tab.url !== node.url ? { label: 'Go back to saved page', onClick: () => chrome.tabs.update(tab.id, { url: node.url }) } : null,
    'sep',
    { label: favorite ? 'Move to folder…' : 'Move to…', submenu: () => folderSubmenu((pid) => chrome.bookmarks.move(node.id, { parentId: pid })) },
    tab ? { label: 'Close tab', onClick: () => chrome.tabs.remove(tab.id) } : null,
    { label: favorite ? 'Remove from Favorites' : 'Remove from folder', danger: true, onClick: () => chrome.bookmarks.remove(node.id) },
  ]);
}

function folderMenu(x, y, node) {
  const urls = (node.children || []).filter((c) => c.url);
  const total = (function count(n) { return (n.children || []).reduce((s, c) => s + (c.url ? 1 : 1 + count(c)), 0); })(node);
  showMenu(x, y, [
    {
      label: `Open all (${urls.length})`, disabled: !urls.length,
      onClick: async () => { for (const c of urls) await send('openBookmark', { bookmarkId: c.id, windowId: state.windowId, background: true }); },
    },
    { label: 'Close all open tabs', onClick: () => { const ids = urls.map((c) => linkedTab(c.id)?.id).filter(Boolean); if (ids.length) return chrome.tabs.remove(ids); } },
    'sep',
    { label: 'Rename…', onClick: () => { const r = document.querySelector(`.row[data-bookmark-id="${node.id}"]`); if (r) beginBookmarkRename(r, node); } },
    { label: 'Change icon…', onClick: () => pickBookmarkIcon(x, y, node) },
    { label: 'New subfolder', onClick: () => newFolder(node.id) },
    { label: 'Move to…', submenu: () => folderSubmenu((pid) => chrome.bookmarks.move(node.id, { parentId: pid }), { includeFavorites: false }) },
    'sep',
    {
      label: 'Delete folder', danger: true,
      confirm: total ? `Click again to delete ${total} item${total === 1 ? '' : 's'}` : 'Click again to delete',
      onClick: () => chrome.bookmarks.removeTree(node.id),
    },
  ]);
}

// ---------- GitHub PRs ----------
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hr = Math.round(m / 60);
  return hr < 24 ? `${hr}h ago` : `${Math.round(hr / 24)}d ago`;
}

function reviewPill(pr) {
  if (pr.isDraft) return ['Draft', 'gray'];
  const n = pr.approvals;
  switch (pr.reviewDecision) {
    case 'APPROVED': return [n > 1 ? `Approved ×${n}` : 'Approved', 'green'];
    case 'CHANGES_REQUESTED': return ['Changes requested', 'red'];
    case 'REVIEW_REQUIRED': return [n ? `${n} approval${n > 1 ? 's' : ''} · needs more` : 'Review required', 'yellow'];
    default:
      if (pr.changesRequested) return ['Changes requested', 'red'];
      if (n) return [n > 1 ? `Approved ×${n}` : 'Approved', 'green'];
      return pr.pendingReviewers.length ? ['Awaiting review', 'yellow'] : ['No reviews yet', 'gray'];
  }
}

const CHECK_GLYPH = { SUCCESS: '✓', FAILURE: '✕', ERROR: '✕', PENDING: '●', EXPECTED: '●' };
const CHECK_LABEL = { SUCCESS: 'Checks passed', FAILURE: 'Checks failed', ERROR: 'Checks errored', PENDING: 'Checks running', EXPECTED: 'Checks expected' };

const nativeTabs = () => state.settings.nativeTabs !== false;

function openUrl(url, background = false) {
  if (nativeTabs()) {
    send('openPR', { url, windowId: state.windowId, background }).catch((e) => toast(e.message));
    return;
  }
  const base = url.split('#')[0];
  const existing = state.tabs.find((t) => (t.url || '').split('#')[0] === base);
  if (existing && !background) {
    chrome.tabs.update(existing.id, { active: true });
    chrome.windows.update(existing.windowId, { focused: true });
  } else {
    chrome.tabs.create({ url, windowId: state.windowId, active: !background });
  }
}

function prRow(pr, showAuthor) {
  const [label, color] = reviewPill(pr);
  const reviewerText = pr.reviewers.map((r) => `${r.login}: ${r.state.toLowerCase().replace('_', ' ')}`).join('\n');
  const tip = [
    `${pr.repo}#${pr.number}: ${pr.title}`,
    `by ${pr.author}`,
    reviewerText,
    pr.pendingReviewers.length ? `Waiting on: ${pr.pendingReviewers.join(', ')}` : '',
    pr.checks ? CHECK_LABEL[pr.checks] : '',
  ].filter(Boolean).join('\n');
  return h('div', {
    class: 'row pr-row',
    title: tip,
    onClick: (e) => openUrl(pr.url, e.metaKey || e.ctrlKey),
    onAuxclick: (e) => e.button === 1 && openUrl(pr.url, true),
    onContextmenu: (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { label: 'Open', onClick: () => openUrl(pr.url) },
        { label: 'Open in background', onClick: () => openUrl(pr.url, true) },
        'sep',
        { label: 'Copy link', onClick: async () => { await send('copyText', { text: pr.url }); toast('Copied link'); } },
        { label: 'Copy Markdown link', onClick: async () => { await send('copyText', { text: `[${pr.repo}#${pr.number}: ${pr.title}](${pr.url})` }); toast('Copied Markdown link'); } },
      ]);
    },
  },
  img(pr.isDraft ? PR_DRAFT : PR_OPEN),
  h('div', { class: 'pr-body' },
    h('div', { class: 'pr-title', text: pr.title }),
    h('div', { class: 'pr-sub' },
      showAuthor && pr.authorAvatar ? h('img', { src: pr.authorAvatar, alt: '', width: '14', height: '14', style: 'border-radius:50%;flex:none' }) : null,
      h('span', { class: 'repo', text: `${showAuthor ? `${pr.author} · ` : ''}${pr.repo.split('/')[1] || pr.repo}#${pr.number}` }),
      h('span', { class: `pill ${color}`, text: label }),
      pr.checks ? h('span', { class: `checks ${pr.checks}`, title: CHECK_LABEL[pr.checks], text: CHECK_GLYPH[pr.checks] || '' }) : null,
      pr.reviewers.length ? h('span', { class: 'avatars' }, pr.reviewers.slice(0, 4).map((r) => h('img', { src: r.avatar, alt: r.login, class: r.state }))) : null,
    )));
}

function prGroup(key, label, prs, showAuthor) {
  const open = state.ui.prGroups[key] !== false;
  const head = h('div', {
    class: 'row',
    style: 'height:26px',
    onClick: () => { state.ui.prGroups[key] = !open; saveUi(); render(); },
  },
  h('span', { class: `chev${open ? ' open' : ''}`, text: '▶' }),
  h('span', { class: 'title', style: 'font-size:12px;color:var(--muted);font-weight:600', text: label }),
  h('span', { class: 'badge', text: prs.length }));
  const body = open
    ? h('div', {}, prs.length ? prs.map((p) => prRow(p, showAuthor)) : h('div', { class: 'pr-note', text: 'Nothing here 🎉' }))
    : null;
  return h('div', {}, head, body);
}

function renderPRs() {
  const box = $('prs');
  const d = state.prData;
  const open = state.ui.prOpen;
  const reviewN = d?.reviewRequested?.length || 0;
  const refreshBtn = h('button', {
    class: 'icon-btn', title: 'Refresh now', style: 'width:22px;height:22px',
    onClick: attempt(async (e) => { e.stopPropagation(); await send('refreshPRs'); }),
  }, h('span', { class: state.prLoading ? 'spin' : '', style: 'display:inline-block', text: '↻' }));
  const header = h('div', {
    class: 'row folder-row',
    onClick: () => { state.ui.prOpen = !open; saveUi(); render(); },
  },
  h('span', { class: `chev${open ? ' open' : ''}`, text: '▶' }),
  img(GITHUB),
  h('span', { class: 'title', text: 'Pull Requests' }),
  d?.fetchedAt && !d.error ? h('span', { class: 'updated', text: timeAgo(d.fetchedAt) }) : null,
  reviewN ? h('span', { class: 'pill yellow', title: 'Waiting on your review', text: reviewN }) : null,
  state.hasToken ? refreshBtn : null);

  const kids = [];
  if (open) {
    if (!state.hasToken) {
      kids.push(h('div', { class: 'pr-note' }, 'Add a GitHub token to see your PRs. ',
        h('a', { text: 'Open settings', onClick: () => chrome.runtime.openOptionsPage() })));
    } else {
      if (d?.error && d.error !== 'no-token') kids.push(h('div', { class: 'pr-note error', text: d.error }));
      if (d?.warnings?.length) kids.push(h('div', { class: 'pr-note', title: d.warnings.join('\n'), text: `⚠︎ ${d.warnings.length} org(s) returned partial results. Hover for details.` }));
      if (d?.mine) {
        kids.push(prGroup('review', 'Review requested', d.reviewRequested || [], true));
        kids.push(prGroup('mine', 'Your open PRs', d.mine || [], false));
        if (state.settings.includeAssigned) kids.push(prGroup('assigned', 'Assigned to you', d.assigned || [], true));
      } else if (!d?.error) {
        kids.push(h('div', { class: 'pr-note', text: 'Loading…' }));
      }
    }
  }
  box.replaceChildren(header, open ? h('div', { class: 'children' }, kids) : '');
}

// ---------- today (open tabs) ----------
// Selected tabs, in the order they appear in Today.
function selectedTabIds() {
  return todayTabs().map((t) => t.id).filter((id) => state.selected.has(id));
}
function todayTabs() {
  const linked = new Set(Object.keys(state.tabLinks).map(Number));
  return windowTabs().filter((t) => !linked.has(t.id));
}
// Repaints highlight in place; a full render waits out the double-click hold.
function paintSelection() {
  document.querySelectorAll('#tabs .row[data-tab-id]').forEach((row) => {
    row.classList.toggle('selected', state.selected.has(Number(row.dataset.tabId)));
  });
}
function clearSelection() {
  if (!state.selected.size) return;
  state.selected.clear();
  state.anchor = null;
  paintSelection();
}
function onTabClick(e, tab) {
  if (e.shiftKey) {
    const ids = todayTabs().map((t) => t.id);
    const from = ids.indexOf(state.anchor ?? activeTabId());
    const to = ids.indexOf(tab.id);
    if (!e.metaKey && !e.ctrlKey) state.selected.clear();
    if (from < 0) state.selected.add(tab.id);
    else for (const id of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) state.selected.add(id);
    state.anchor ??= ids[from] ?? tab.id;
    paintSelection();
    return;
  }
  if (e.metaKey || e.ctrlKey) {
    if (!state.selected.size && activeTabId() != null && activeTabId() !== tab.id) state.selected.add(activeTabId());
    state.selected.has(tab.id) ? state.selected.delete(tab.id) : state.selected.add(tab.id);
    state.anchor = tab.id;
    paintSelection();
    return;
  }
  state.selected.clear();
  state.anchor = tab.id;
  paintSelection();
  chrome.tabs.update(tab.id, { active: true });
}
async function addTabsToFolder(ids, parentId, index) {
  for (const [i, tabId] of ids.entries()) {
    await send('addTabToFolder', { tabId, parentId, index: index == null ? undefined : index + i });
  }
  state.selected.clear();
  state.anchor = null;
  if (ids.length > 1) toast(`Added ${ids.length} tabs`);
}

function tabRow(tab, activeId) {
  const titleEl = h('span', { class: 'title', text: tabTitle(tab) });
  const icon = img(tabIcon(tab));
  const row = h('div', {
    class: `row${tab.id === activeId ? ' active' : ''}${state.selected.has(tab.id) ? ' selected' : ''}`,
    title: `${tabTitle(tab)}\n${tab.url || ''}`,
    dataset: { tabId: tab.id },
    onClick: (e) => onTabClick(e, tab),
    onAuxclick: (e) => e.button === 1 && chrome.tabs.remove(tab.id),
    onContextmenu: (e) => { e.preventDefault(); tabMenu(e.clientX, e.clientY, tab); },
  },
  icon,
  titleEl,
  tab.pinned ? h('span', { class: 'meta-icons', title: 'Pinned in tab strip', text: '📌' }) : null,
  tab.audible || tab.mutedInfo?.muted ? h('span', {
    class: 'meta-icons', style: 'cursor:pointer', title: 'Toggle mute', text: tab.mutedInfo?.muted ? '🔇' : '🔊',
    onClick: (e) => { e.stopPropagation(); chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted }); },
  }) : null,
  h('button', { class: 'close', title: 'Close tab', text: '×', onClick: (e) => { e.stopPropagation(); chrome.tabs.remove(tab.id); } }));
  titleEl.addEventListener('dblclick', (e) => { e.stopPropagation(); beginTabRename(row, tab); });
  icon.addEventListener('dblclick', (e) => { e.stopPropagation(); pickTabIcon(e.clientX, e.clientY, tab); });
  makeDraggable(row, DT_TAB, tab.id, tab.url);
  makeDropTarget(row, { accepts: ['tab', 'bookmark'], cls: 'drop-before', onDrop: (kind, id) => dropIntoToday(kind, id, tab.index) });
  return row;
}

function renderTabs() {
  const box = $('tabs');
  const activeId = activeTabId();
  $('today-label').textContent = 'Today';
  $('clear-today').hidden = false;
  const tabs = todayTabs();
  for (const id of state.selected) if (!tabs.some((t) => t.id === id)) state.selected.delete(id);
  const newTab = h('div', { class: 'row new-tab', onClick: () => chrome.tabs.create({ windowId: state.windowId }) },
    h('span', { class: 'plus', text: '+' }), h('span', { class: 'title', text: 'New Tab' }));
  const list = h('div', {}, tabs.map((t) => tabRow(t, activeId)));
  makeDropTarget(list, { accepts: ['tab', 'bookmark'], onDrop: (kind, id) => dropIntoToday(kind, id) });
  box.replaceChildren(newTab, list);
}

function tabMenu(x, y, tab) {
  if (state.selected.size > 1 && state.selected.has(tab.id)) return multiTabMenu(x, y, selectedTabIds());
  if (state.selected.size && !state.selected.has(tab.id)) clearSelection();
  const ov = state.tabOverrides[tab.id] || {};
  showMenu(x, y, [
    { label: 'Rename…', hint: 'double-click', onClick: () => { const r = document.querySelector(`.row[data-tab-id="${tab.id}"]`); if (r) beginTabRename(r, tab); } },
    { label: 'Change icon…', onClick: () => pickTabIcon(x, y, tab) },
    ov.title || ov.icon ? { label: 'Reset name & icon', onClick: () => send('runActionOnTab', { action: 'resetTab', tabId: tab.id }) } : null,
    'sep',
    { label: 'Add to Favorites', onClick: () => send('addTabToFolder', { tabId: tab.id, parentId: state.favoritesId }) },
    { label: 'Add to folder…', submenu: () => folderSubmenu((pid) => send('addTabToFolder', { tabId: tab.id, parentId: pid }), { includeFavorites: false }) },
    'sep',
    { label: 'Copy link', onClick: async () => { await send('copyText', { text: tab.url }); toast('Copied link'); } },
    { label: 'Duplicate', onClick: () => chrome.tabs.duplicate(tab.id) },
    { label: tab.pinned ? 'Unpin from tab strip' : 'Pin to tab strip', onClick: () => chrome.tabs.update(tab.id, { pinned: !tab.pinned }) },
    { label: tab.mutedInfo?.muted ? 'Unmute' : 'Mute', onClick: () => chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted }) },
    { label: 'Move to new window', onClick: () => chrome.windows.create({ tabId: tab.id }) },
    'sep',
    { label: 'Close tab', danger: true, onClick: () => chrome.tabs.remove(tab.id) },
  ]);
}

function multiTabMenu(x, y, ids) {
  const n = ids.length;
  showMenu(x, y, [
    { label: `Add ${n} tabs to Favorites`, onClick: () => addTabsToFolder(ids, state.favoritesId) },
    { label: `Add ${n} tabs to folder…`, submenu: () => folderSubmenu((pid) => addTabsToFolder(ids, pid), { includeFavorites: false }) },
    'sep',
    { label: `Copy ${n} links`, onClick: async () => {
      const urls = state.tabs.filter((t) => ids.includes(t.id)).map((t) => t.url);
      await send('copyText', { text: urls.join('\n') });
      toast(`Copied ${n} links`);
    } },
    { label: `Move ${n} tabs to new window`, onClick: async () => {
      const win = await chrome.windows.create({ tabId: ids[0] });
      if (n > 1) await chrome.tabs.move(ids.slice(1), { windowId: win.id, index: -1 });
    } },
    'sep',
    { label: `Close ${n} tabs`, danger: true, onClick: () => chrome.tabs.remove(ids) },
    { label: 'Deselect', onClick: clearSelection },
  ]);
}

async function clearToday() {
  const btn = $('clear-today');
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = 'Close all?';
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Clear'; }, 3000);
    return;
  }
  delete btn.dataset.armed;
  btn.textContent = 'Clear';
  const linked = new Set(Object.keys(state.tabLinks).map(Number));
  const all = windowTabs();
  const doomed = all.filter((t) => !t.pinned && !linked.has(t.id)).map((t) => t.id);
  if (!doomed.length) return;
  if (doomed.length === all.length) await chrome.tabs.create({ windowId: state.windowId });
  await chrome.tabs.remove(doomed);
}

// Opened from the page's right-click menu ("Change tab icon…").
function openPendingPicker(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab || tab.windowId !== state.windowId) return;
  chrome.storage.session.remove('pendingPanelAction');
  pickTabIcon(16, 80, tab);
}

// ---------- omnibox ----------
function toUrl(text) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(about|chrome|data|file):/i.test(text)) return text;
  if (/^localhost(:\d+)?(\/|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) return `http://${text}`;
  if (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`;
  return null;
}

$('omnibox').addEventListener('submit', attempt(async (e) => {
  e.preventDefault();
  const input = $('omnibox-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.blur();
  const url = toUrl(text);
  if (url) await chrome.tabs.create({ url, windowId: state.windowId });
  else await chrome.search.query({ text, disposition: 'NEW_TAB' });
}));

// ---------- wiring ----------
function connectPort() {
  const port = chrome.runtime.connect({ name: `sidepanel:${state.windowId}` });
  port.onMessage.addListener((msg) => { if (msg.type === 'close') window.close(); });
  port.onDisconnect.addListener(() => setTimeout(connectPort, 250));
}

const refreshTabs = () => loadTabs().then(render);
const refreshTree = () => loadTree().then(render);

async function init() {
  state.windowId = (await chrome.windows.getCurrent()).id;
  ({ rootId: state.rootId, favoritesId: state.favoritesId } = await send('getRoots'));
  await Promise.all([loadTabs(), loadSession(), loadTree(), loadLocal()]);
  render();
  connectPort();

  for (const ev of ['onCreated', 'onUpdated', 'onRemoved', 'onMoved', 'onActivated', 'onAttached', 'onDetached', 'onReplaced']) {
    chrome.tabs[ev].addListener(refreshTabs);
  }
  for (const ev of ['onCreated', 'onChanged', 'onRemoved', 'onMoved', 'onChildrenReordered', 'onImportEnded']) {
    chrome.bookmarks[ev].addListener(refreshTree);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session') loadSession().then(render);
    if (area === 'local' && !('uiState' in changes && Object.keys(changes).length === 1)) loadLocal().then(render);
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.target !== 'panel') return;
    if (msg.type === 'toast' && document.visibilityState === 'visible') toast(msg.text);
    if (msg.type === 'pickIcon') openPendingPicker(msg.tabId);
    if (msg.type === 'startRename') {
      const tab = state.tabs.find((t) => t.id === msg.tabId);
      if (!tab || tab.windowId !== state.windowId) return;
      const bid = state.tabLinks[tab.id];
      const row = document.querySelector(bid ? `.row[data-bookmark-id="${bid}"]` : `.row[data-tab-id="${tab.id}"]`);
      if (row && bid) beginBookmarkRename(row, findNode(state.root, bid));
      else if (row) beginTabRename(row, tab);
    }
  });

  const { pendingPanelAction: pending } = await chrome.storage.session.get('pendingPanelAction');
  if (pending && Date.now() - pending.at < 10_000) {
    chrome.storage.session.remove('pendingPanelAction');
    setTimeout(() => openPendingPicker(pending.tabId), 100);
  }

  $('settings-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('clear-today').addEventListener('click', attempt(clearToday));
  document.addEventListener('mousedown', (e) => {
    if (!$('menu').contains(e.target)) closeMenu();
    if (!$('picker').contains(e.target)) closePicker();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); closePicker(); clearSelection(); } });
  $('scroll').addEventListener('scroll', closeMenu);
  window.addEventListener('blur', closeMenu);
  setInterval(render, 30_000); // keeps "updated Xm ago" fresh
}

init().catch((e) => toast(`hannah's hub failed to start: ${e.message}`));
