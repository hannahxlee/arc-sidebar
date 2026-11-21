import { COMMAND_TO_ACTION, defaultShortcuts, legacyDefaultShortcuts } from './lib/actions.js';
import { fetchPRs } from './lib/github.js';

const ROOT_TITLE = "hannah's hub";
const OLD_ROOT_TITLES = ['Arc Sidebar'];
const FAVORITES_TITLE = 'Favorites';
const PR_ALARM = 'refresh-prs';

// ---------- storage helpers ----------
const session = {
  async get(key, def) { return (await chrome.storage.session.get(key))[key] ?? def; },
  set(key, val) { return chrome.storage.session.set({ [key]: val }); },
};
const local = {
  async get(key, def) { return (await chrome.storage.local.get(key))[key] ?? def; },
  set(key, val) { return chrome.storage.local.set({ [key]: val }); },
};

// Serialize all state mutations so concurrent messages don't clobber each other.
let queue = Promise.resolve();
function locked(fn) {
  const run = queue.then(() => fn());
  queue = run.catch(() => {});
  return run;
}

// ---------- bookmark roots ----------
async function bookmarkExists(id) {
  if (!id) return false;
  try { await chrome.bookmarks.get(id); return true; } catch { return false; }
}

// Concurrent callers share one run so the folders are never created twice.
let rootsInflight = null;
function ensureRoots() {
  rootsInflight ??= ensureRootsOnce().finally(() => { rootsInflight = null; });
  return rootsInflight;
}

async function ensureRootsOnce() {
  let { rootId, favoritesId } = await chrome.storage.local.get(['rootId', 'favoritesId']);
  if (!(await bookmarkExists(rootId))) {
    const [tree] = await chrome.bookmarks.getTree();
    const other = tree.children.find((c) => c.id === '2') || tree.children[1] || tree.children[0];
    const existing = (other.children || []).find((c) => !c.url && (c.title === ROOT_TITLE || OLD_ROOT_TITLES.includes(c.title)));
    rootId = existing ? existing.id : (await chrome.bookmarks.create({ parentId: other.id, title: ROOT_TITLE })).id;
    favoritesId = null;
  }
  if (!(await bookmarkExists(favoritesId))) {
    const kids = await chrome.bookmarks.getChildren(rootId);
    const existing = kids.find((c) => !c.url && c.title === FAVORITES_TITLE);
    favoritesId = existing
      ? existing.id
      : (await chrome.bookmarks.create({ parentId: rootId, title: FAVORITES_TITLE, index: 0 })).id;
  }
  const [root] = await chrome.bookmarks.get(rootId);
  if (OLD_ROOT_TITLES.includes(root.title)) await chrome.bookmarks.update(rootId, { title: ROOT_TITLE });
  await chrome.storage.local.set({ rootId, favoritesId });
  return { rootId, favoritesId };
}

// ---------- tab overrides (custom title / icon) ----------
async function getOverrides(tabId) {
  return (await session.get('tabOverrides', {}))[tabId] || {};
}

async function pushOverrides(tabId, overrides) {
  const msg = { type: 'applyOverrides', overrides };
  try { await chrome.tabs.sendMessage(tabId, msg); return; } catch {}
  // Tab was opened before the extension loaded: inject the content script, which
  // pulls its overrides on start-up.
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch {}
}

async function setTabOverride(tabId, patch) {
  const all = await session.get('tabOverrides', {});
  const cur = { ...(all[tabId] || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === '') delete cur[k];
    else cur[k] = v;
  }
  if (Object.keys(cur).length) all[tabId] = cur;
  else delete all[tabId];
  await session.set('tabOverrides', all);
  pushOverrides(tabId, cur);
  return cur;
}

// ---------- tab <-> bookmark links ----------
async function linkTab(tabId, bookmarkId) {
  const links = await session.get('tabLinks', {});
  for (const [tid, bid] of Object.entries(links)) if (bid === bookmarkId) delete links[tid];
  links[tabId] = bookmarkId;
  await session.set('tabLinks', links);
}

async function findLinkedTab(bookmarkId) {
  const links = await session.get('tabLinks', {});
  for (const [tid, bid] of Object.entries(links)) {
    if (bid !== bookmarkId) continue;
    try { return await chrome.tabs.get(Number(tid)); } catch {}
  }
  return null;
}

async function linkedBookmarkId(tabId) {
  return (await session.get('tabLinks', {}))[tabId] || null;
}

async function getMeta() { return local.get('bookmarkMeta', {}); }
async function patchMeta(bookmarkId, patch) {
  const meta = await getMeta();
  const cur = { ...(meta[bookmarkId] || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === false) delete cur[k];
    else cur[k] = v;
  }
  if (Object.keys(cur).length) meta[bookmarkId] = cur;
  else delete meta[bookmarkId];
  await local.set('bookmarkMeta', meta);
}

async function openBookmark({ bookmarkId, windowId, background = false }) {
  const [bm] = await chrome.bookmarks.get(bookmarkId);
  if (!bm.url) return null;
  const existing = await findLinkedTab(bookmarkId);
  if (existing) {
    if (!background) {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return existing.id;
  }
  const tab = await chrome.tabs.create({ url: bm.url, windowId, active: !background });
  await linkTab(tab.id, bookmarkId);
  const meta = (await getMeta())[bookmarkId] || {};
  const patch = {};
  if (meta.renamed) patch.title = bm.title;
  if (meta.icon) patch.icon = meta.icon;
  if (Object.keys(patch).length) await setTabOverride(tab.id, patch);
  if (await nativeMode()) await placeTab(tab.id, bm);
  return tab.id;
}

async function addTabToFolder({ tabId, parentId, index }) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) throw new Error('This tab has no URL yet');
  const ov = await getOverrides(tabId);
  const bm = await chrome.bookmarks.create({
    parentId, index, title: ov.title || tab.title || tab.url, url: tab.url,
  });
  await patchMeta(bm.id, { renamed: !!ov.title, icon: ov.icon || null });
  await linkTab(tabId, bm.id);
  if (await nativeMode()) await placeTab(tabId, bm);
  return bm.id;
}

// ---------- Chrome vertical tabs integration ----------
// Favorites <-> pinned tabs, folders <-> tab groups. Changes made in Chrome's
// native tab list flow back into the bookmarks, and vice versa.
const GROUP_COLORS = ['blue', 'purple', 'green', 'orange', 'pink', 'cyan', 'red', 'yellow', 'grey'];
const PR_GROUP_TITLE = 'Pull Requests';

async function nativeMode() {
  return (await local.get('settings', {})).nativeTabs !== false;
}

function colorFor(folderId, meta) {
  if (meta?.color) return meta.color;
  let h = 0;
  for (const ch of String(folderId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

async function aliveGroup(groupId, windowId) {
  if (groupId == null) return null;
  try {
    const g = await chrome.tabGroups.get(groupId);
    return windowId == null || g.windowId === windowId ? g : null;
  } catch { return null; }
}

// folderGroups: { "<windowId>:<folderId>": groupId }. Stale entries are kept on
// purpose so a just-removed group can still be traced back to its folder.
async function folderForGroup(groupId) {
  if (groupId == null || groupId === -1) return null;
  const map = await session.get('folderGroups', {});
  for (const [key, gid] of Object.entries(map)) if (gid === groupId) return key.split(':')[1];
  // A group the user made natively whose name matches a folder joins that folder.
  const g = await aliveGroup(groupId);
  if (!g?.title) return null;
  const { rootId, favoritesId } = await ensureRoots();
  const match = (await chrome.bookmarks.getSubTree(rootId))[0].children
    .find((c) => !c.url && c.id !== favoritesId && c.title === g.title);
  if (!match) return null;
  map[`${g.windowId}:${match.id}`] = groupId;
  await session.set('folderGroups', map);
  return match.id;
}

async function ensureGroup(folderId, windowId, tabId) {
  const key = `${windowId}:${folderId}`;
  const map = await session.get('folderGroups', {});
  let group = await aliveGroup(map[key], windowId);
  if (group) {
    await chrome.tabs.group({ groupId: group.id, tabIds: [tabId] });
    return group.id;
  }
  const [folder] = await chrome.bookmarks.get(folderId);
  const meta = (await getMeta())[folderId];
  const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
  map[key] = groupId;
  await session.set('folderGroups', map);
  await chrome.tabGroups.update(groupId, { title: folder.title, color: colorFor(folderId, meta) });
  return groupId;
}

async function rememberPlacement(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const seen = await session.get('tabPlacement', {});
    seen[tabId] = { groupId: tab.groupId, windowId: tab.windowId };
    await session.set('tabPlacement', seen);
  } catch {}
}

// Puts a linked tab where its bookmark says it belongs.
async function placeTab(tabId, bm) {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  const { rootId, favoritesId } = await ensureRoots();
  if (bm.parentId === favoritesId) {
    if (!tab.pinned) await chrome.tabs.update(tabId, { pinned: true });
  } else {
    if (tab.pinned) await chrome.tabs.update(tabId, { pinned: false });
    if (bm.parentId === rootId) {
      if (tab.groupId !== -1) await chrome.tabs.ungroup(tabId);
    } else {
      const map = await session.get('folderGroups', {});
      const want = await aliveGroup(map[`${tab.windowId}:${bm.parentId}`], tab.windowId);
      if (!want || tab.groupId !== want.id) await ensureGroup(bm.parentId, tab.windowId, tabId);
    }
  }
  await rememberPlacement(tabId);
}

async function unlinkTab(tabId) {
  const links = await session.get('tabLinks', {});
  delete links[tabId];
  await session.set('tabLinks', links);
}

const isScratchUrl = (url) => !url || /^chrome:\/\/(newtab|new-tab-page)\b/.test(url) || url === 'about:blank';

// Reacts to the user pinning/unpinning or (un)grouping a tab in Chrome's UI.
async function reconcileTab(tabId) {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  const { rootId, favoritesId } = await ensureRoots();
  const prev = (await session.get('tabPlacement', {}))[tabId];
  const bid = await linkedBookmarkId(tabId);
  let bm = null;
  if (bid) { try { [bm] = await chrome.bookmarks.get(bid); } catch {} }

  if (tab.pinned) {
    if (bm && bm.parentId !== favoritesId) await chrome.bookmarks.move(bm.id, { parentId: favoritesId });
    else if (!bm && !isScratchUrl(tab.url)) await addTabToFolder({ tabId, parentId: favoritesId });
    return rememberPlacement(tabId);
  }
  if (bm?.parentId === favoritesId) {
    // Unpinned in Chrome: it's no longer a favorite.
    await unlinkTab(tabId);
    await chrome.bookmarks.remove(bm.id);
    return rememberPlacement(tabId);
  }

  const groupFolder = await folderForGroup(tab.groupId);
  if (!bm) {
    if (groupFolder && !isScratchUrl(tab.url)) await addTabToFolder({ tabId, parentId: groupFolder });
    return rememberPlacement(tabId);
  }
  const expected = bm.parentId === rootId ? null : bm.parentId;
  if (groupFolder === expected) return rememberPlacement(tabId);
  if (groupFolder) {
    await chrome.bookmarks.move(bm.id, { parentId: groupFolder });
    return rememberPlacement(tabId);
  }
  if (!expected) return rememberPlacement(tabId);
  // The tab left its folder's group. If it was dragged out within the same
  // window, the user removed it from the folder. If it changed windows, Chrome
  // dropped the group membership, so regroup it in the new window.
  const leftOwnGroup = prev && prev.windowId === tab.windowId && (await folderForGroup(prev.groupId)) === expected;
  if (leftOwnGroup) {
    await unlinkTab(tabId);
    await chrome.bookmarks.remove(bm.id);
    return rememberPlacement(tabId);
  }
  await placeTab(tabId, bm);
}

const sameOrigin = (a, b) => { try { return new URL(a).origin === new URL(b).origin; } catch { return false; } };

function matchTabs(tabs, bookmarks, links) {
  const linkedBms = new Set(Object.values(links));
  const free = bookmarks.filter((b) => b.url && !linkedBms.has(b.id));
  const pairs = [];
  for (const test of [(t, b) => t.url === b.url, (t, b) => sameOrigin(t.url, b.url)]) {
    for (const t of tabs) {
      if (links[t.id] || pairs.some((p) => p[0] === t)) continue;
      const i = free.findIndex((b) => test(t, b));
      if (i >= 0) pairs.push([t, free.splice(i, 1)[0]]);
    }
  }
  return pairs;
}

// After a restart (or when the mode is switched on), re-link Chrome's restored
// pinned tabs and tab groups to Favorites and folders.
async function reconcileAll() {
  if (!(await nativeMode())) return;
  const { rootId, favoritesId } = await ensureRoots();
  const [root] = await chrome.bookmarks.getSubTree(rootId);
  const folders = root.children.filter((c) => !c.url && c.id !== favoritesId);
  const favs = root.children.find((c) => c.id === favoritesId)?.children || [];
  const tabs = await chrome.tabs.query({});
  const links = await session.get('tabLinks', {});

  const pinned = tabs.filter((t) => t.pinned);
  for (const [t, b] of matchTabs(pinned, favs, links)) { links[t.id] = b.id; }
  await session.set('tabLinks', links);

  const groups = await chrome.tabGroups.query({});
  const map = await session.get('folderGroups', {});
  for (const g of groups) {
    const folder = folders.find((f) => f.title === g.title);
    if (!folder) continue;
    map[`${g.windowId}:${folder.id}`] = g.id;
    const inGroup = tabs.filter((t) => t.groupId === g.id);
    for (const [t, b] of matchTabs(inGroup, folder.children || [], links)) links[t.id] = b.id;
  }
  await session.set('folderGroups', map);
  await session.set('tabLinks', links);

  // Anything still unlinked in a pinned slot or a folder's group becomes a new item.
  for (const t of tabs) await reconcileTab(t.id);
}

async function openInPRGroup({ url, windowId, background = false }) {
  const base = url.split('#')[0];
  const existing = (await chrome.tabs.query({})).find((t) => (t.url || '').split('#')[0] === base);
  if (existing) {
    if (!background) {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return existing.id;
  }
  const tab = await chrome.tabs.create({ url, windowId, active: !background });
  if (await nativeMode()) {
    const [group] = await chrome.tabGroups.query({ windowId: tab.windowId, title: PR_GROUP_TITLE });
    if (group) await chrome.tabs.group({ groupId: group.id, tabIds: [tab.id] });
    else {
      const gid = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
      await chrome.tabGroups.update(gid, { title: PR_GROUP_TITLE, color: 'grey', collapsed: false });
    }
    await rememberPlacement(tab.id);
  }
  return tab.id;
}

async function renameBookmark({ bookmarkId, title }) {
  title = (title || '').trim();
  if (!title) return;
  await chrome.bookmarks.update(bookmarkId, { title });
  await patchMeta(bookmarkId, { renamed: true });
  const tab = await findLinkedTab(bookmarkId);
  if (tab) await setTabOverride(tab.id, { title });
}

async function setBookmarkIcon({ bookmarkId, icon }) {
  await patchMeta(bookmarkId, { icon: icon || null });
  const tab = await findLinkedTab(bookmarkId);
  if (tab) await setTabOverride(tab.id, { icon: icon || null });
}

// Renames a tab; if the tab belongs to a folder/favorite, rename the bookmark too.
async function renameTab({ tabId, title }) {
  title = (title || '').trim();
  const bid = await linkedBookmarkId(tabId);
  if (bid && title) return renameBookmark({ bookmarkId: bid, title });
  if (bid && !title) await patchMeta(bid, { renamed: false });
  await setTabOverride(tabId, { title: title || null });
}

async function setTabIcon({ tabId, icon }) {
  const bid = await linkedBookmarkId(tabId);
  if (bid) return setBookmarkIcon({ bookmarkId: bid, icon });
  await setTabOverride(tabId, { icon: icon || null });
}

// ---------- clipboard & toasts ----------
let offscreenReady = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  offscreenReady ??= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['CLIPBOARD'],
    justification: 'Copy the current tab URL to the clipboard from a keyboard shortcut',
  }).finally(() => { offscreenReady = null; });
  try { await offscreenReady; } catch (e) {
    if (!String(e).includes('single offscreen')) throw e;
  }
}

async function copyText(text, tab, message) {
  await ensureOffscreen();
  const ok = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'copy', text });
  toast(tab, ok ? message : 'Copy failed');
  return ok;
}

// `action` adds a button: { label, message } sends `message` to the background when clicked.
async function toast(tab, text, action = null) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [text, action],
      func: (msg, action) => {
        const old = document.getElementById('__arc_sidebar_toast');
        if (old) old.remove();
        const host = document.createElement('div');
        host.id = '__arc_sidebar_toast';
        const root = host.attachShadow({ mode: 'closed' });
        root.innerHTML = `<style>
          div{position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-8px);
          z-index:2147483647;background:rgba(28,28,30,.92);color:#fff;
          font:500 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          padding:10px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);
          opacity:0;transition:opacity .15s,transform .15s;pointer-events:none;
          display:flex;align-items:center;gap:12px}
          div.show{opacity:1;transform:translateX(-50%) translateY(0)}
          div.show.has-action{pointer-events:auto}
          button{all:unset;cursor:pointer;color:#8ab4ff;font-weight:600}
          button:hover{text-decoration:underline}</style><div><span></span></div>`;
        const box = root.querySelector('div');
        box.firstChild.textContent = msg;
        let timer;
        const hide = () => { box.classList.remove('show'); setTimeout(() => host.remove(), 200); };
        if (action) {
          box.classList.add('has-action');
          const btn = document.createElement('button');
          btn.textContent = action.label;
          btn.addEventListener('click', () => { clearTimeout(timer); hide(); chrome.runtime.sendMessage(action.message).catch(() => {}); });
          box.addEventListener('mouseenter', () => clearTimeout(timer));
          box.addEventListener('mouseleave', () => { timer = setTimeout(hide, 1500); });
          box.appendChild(btn);
        }
        (document.body || document.documentElement).appendChild(host);
        requestAnimationFrame(() => box.classList.add('show'));
        timer = setTimeout(hide, action ? 5000 : 1600);
      },
    });
  } catch {
    // Restricted page (chrome://, Web Store). Show it in the sidebar instead.
    chrome.runtime.sendMessage({ target: 'panel', type: 'toast', text }).catch(() => {});
  }
}

// ---------- actions ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function displayTitle(tab) {
  return (await getOverrides(tab.id)).title || tab.title || tab.url;
}

async function promptRename(tab) {
  const current = await displayTitle(tab);
  let result;
  try {
    [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [current],
      func: (cur) => prompt('Rename tab (leave empty to reset)', cur),
    });
  } catch {
    // Can't script this page; let the sidebar do an inline rename if it's open.
    chrome.runtime.sendMessage({ target: 'panel', type: 'startRename', tabId: tab.id }).catch(() => {});
    return;
  }
  if (result != null) await locked(() => renameTab({ tabId: tab.id, title: result }));
}

async function runAction(action, tab) {
  tab ||= await activeTab();
  if (!tab && !['newTab', 'reopenClosedTab', 'refreshPRs', 'openSettings'].includes(action)) return;
  switch (action) {
    case 'copyUrl':
      return copyText(tab.url, tab, 'Copied URL to clipboard');
    case 'copyMarkdownLink':
      return copyText(`[${await displayTitle(tab)}](${tab.url})`, tab, 'Copied Markdown link');
    case 'copyTitle':
      return copyText(await displayTitle(tab), tab, 'Copied page title');
    case 'renameTab':
      return promptRename(tab);
    case 'resetTab':
      return locked(async () => {
        const bid = await linkedBookmarkId(tab.id);
        if (bid) await patchMeta(bid, { renamed: false, icon: null });
        await setTabOverride(tab.id, { title: null, icon: null });
      });
    case 'addToFavorites': {
      const { favoritesId } = await ensureRoots();
      await locked(() => addTabToFolder({ tabId: tab.id, parentId: favoritesId }));
      return toast(tab, 'Added to Favorites');
    }
    case 'duplicateTab':
      return chrome.tabs.duplicate(tab.id);
    case 'togglePin':
      return chrome.tabs.update(tab.id, { pinned: !tab.pinned });
    case 'toggleMute':
      return chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted });
    case 'newTab':
      return chrome.tabs.create(tab ? { windowId: tab.windowId } : {});
    case 'reopenClosedTab':
      return chrome.sessions.restore();
    case 'moveToNewWindow':
      return chrome.windows.create({ tabId: tab.id });
    case 'refreshPRs':
      return refreshPRs();
    case 'openSettings':
      return chrome.runtime.openOptionsPage();
  }
}

// ---------- GitHub ----------
let refreshing = null;
async function refreshPRs() {
  refreshing ??= (async () => {
    const { githubToken, settings = {}, prData } = await chrome.storage.local.get(['githubToken', 'settings', 'prData']);
    if (!githubToken) {
      await local.set('prData', { error: 'no-token', fetchedAt: Date.now() });
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    await local.set('prLoading', true);
    try {
      const data = await fetchPRs(githubToken, { includeAssigned: !!settings.includeAssigned });
      await local.set('prData', { ...data, fetchedAt: Date.now(), error: null });
      const n = data.reviewRequested.length;
      await chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
      await chrome.action.setBadgeText({ text: n ? String(n) : '' });
    } catch (e) {
      await local.set('prData', { ...(prData || {}), error: e.message || String(e), fetchedAt: Date.now() });
    } finally {
      await local.set('prLoading', false);
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function setupAlarm() {
  const settings = await local.get('settings', {});
  const minutes = Math.max(1, Number(settings.refreshMinutes) || 3);
  await chrome.alarms.create(PR_ALARM, { periodInMinutes: minutes });
}

// ---------- side panel ports (for toggling) ----------
const panelPorts = new Map();
chrome.runtime.onConnect.addListener((port) => {
  const m = /^sidepanel:(\d+)$/.exec(port.name);
  if (!m) return;
  const windowId = Number(m[1]);
  panelPorts.set(windowId, port);
  port.onDisconnect.addListener(() => {
    if (panelPorts.get(windowId) === port) panelPorts.delete(windowId);
  });
  local.get('prData', null).then((d) => {
    if (!d || Date.now() - (d.fetchedAt || 0) > 60_000) refreshPRs();
  });
});

// ---------- event wiring ----------
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const isMac = (await chrome.runtime.getPlatformInfo()).os === 'mac';
  const { shortcuts } = await chrome.storage.local.get('shortcuts');
  if (!shortcuts) {
    await local.set('shortcuts', defaultShortcuts(isMac));
  } else if (reason === 'update') {
    // Move bindings the user never changed off the old defaults, which clashed
    // with Chrome's DevTools shortcuts.
    const legacy = legacyDefaultShortcuts(isMac);
    const fresh = defaultShortcuts(isMac);
    const used = new Set(Object.values(shortcuts));
    for (const [action, combo] of Object.entries(fresh)) {
      if (shortcuts[action] === legacy[action] || (!(action in shortcuts) && !used.has(combo))) {
        shortcuts[action] = combo;
      }
    }
    await local.set('shortcuts', shortcuts);
  }
  await ensureRoots();
  await setupAlarm();
  refreshPRs();
  locked(reconcileAll);
  if (reason === 'install' || reason === 'update') checkCommandShortcuts();
  // Chrome doesn't inject content scripts into tabs that were already open, so
  // shortcuts and renames wouldn't work there until each tab reloads.
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] })) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'rename-tab', title: 'Rename tab…', contexts: ['page', 'frame', 'link', 'image', 'selection'] });
    chrome.contextMenus.create({ id: 'change-icon', title: 'Change tab icon…', contexts: ['page', 'frame', 'link', 'image', 'selection'] });
  });
});

// Chrome's native tab list can't be extended, so the page's right-click menu
// offers rename and icon change for the current tab.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  if (info.menuItemId === 'rename-tab') promptRename(tab);
  if (info.menuItemId === 'change-icon') {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {}); // must stay in the gesture
    chrome.storage.session.set({ pendingPanelAction: { type: 'pickIcon', tabId: tab.id, at: Date.now() } });
    chrome.runtime.sendMessage({ target: 'panel', type: 'pickIcon', tabId: tab.id }).catch(() => {});
  }
});

// Chrome silently skips a suggested shortcut that it uses itself (⌘⇧C is
// DevTools' inspect element). Only the user can claim it, so point them there.
async function checkCommandShortcuts() {
  const cmds = await chrome.commands.getAll();
  const copy = cmds.find((c) => c.name === 'copy-url');
  if (copy && !copy.shortcut) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#setup-shortcuts') });
  }
}

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm();
  refreshPRs();
  locked(reconcileAll);
  // Chrome may still be restoring tabs and groups; check again shortly.
  setTimeout(() => locked(reconcileAll), 5000);
});

chrome.alarms.onAlarm.addListener((a) => { if (a.name === PR_ALARM) refreshPRs(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.githubToken) refreshPRs();
  if (changes.settings) {
    setupAlarm();
    if (changes.settings.newValue?.nativeTabs !== false && changes.settings.oldValue?.nativeTabs === false) {
      locked(reconcileAll);
    }
    const before = changes.settings.oldValue?.includeAssigned;
    const after = changes.settings.newValue?.includeAssigned;
    if (before !== after) refreshPRs();
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-sidebar') {
    // sidePanel.open must run synchronously inside the user gesture.
    const windowId = tab?.windowId;
    const port = panelPorts.get(windowId);
    if (port) port.postMessage({ type: 'close' });
    else if (windowId != null) chrome.sidePanel.open({ windowId }).catch(() => {});
    return;
  }
  const action = COMMAND_TO_ACTION[command];
  if (action) runAction(action, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => locked(async () => {
  trackNewTab(tabId, false);
  for (const key of ['tabOverrides', 'tabLinks', 'tabPlacement']) {
    const map = await session.get(key, {});
    if (tabId in map) { delete map[tabId]; await session.set(key, map); }
  }
}));

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!('pinned' in info) && !('groupId' in info)) return;
  locked(async () => { if (await nativeMode()) await reconcileTab(tabId); });
});

// ---------- switch to an already-open tab ----------
// A tab opened with ⌘T starts on the New Tab page. If its first navigation
// lands on a URL that's already open in another tab, close it and switch there.
const isNewTabPage = (url) => /^chrome:\/\/(newtab|new-tab-page)\b/.test(url || '');
function sameUrlKey(url) {
  try {
    const u = new URL(url);
    if (!/^(https?|file):$/.test(u.protocol)) return null;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol === 'file:' ? 'file:' : ''}//${u.host.replace(/^www\./, '')}${path}${u.search}`;
  } catch { return null; }
}
async function trackNewTab(tabId, on) {
  const ids = new Set(await session.get('freshTabs', []));
  if (on === ids.has(tabId)) return;
  on ? ids.add(tabId) : ids.delete(tabId);
  await session.set('freshTabs', [...ids]);
}
let switchQueue = Promise.resolve();
async function maybeSwitchToExisting(tabId, url) {
  if (!(await session.get('freshTabs', [])).includes(tabId)) return;
  if ((await local.get('settings', {})).switchToExisting === false) return trackNewTab(tabId, false);
  const key = sameUrlKey(url);
  if (!key) return;
  let fresh;
  try { fresh = await chrome.tabs.get(tabId); } catch { return trackNewTab(tabId, false); }
  const others = (await chrome.tabs.query({})).filter((t) => t.id !== tabId && t.incognito === fresh.incognito
    && sameUrlKey(t.url || t.pendingUrl) === key);
  if (!others.length) return;
  const target = others.find((t) => t.windowId === fresh.windowId) || others[0];
  const reopen = { type: 'openSeparately', url, windowId: fresh.windowId, index: fresh.index };
  await trackNewTab(tabId, false);
  await chrome.tabs.update(target.id, { active: true });
  await chrome.windows.update(target.windowId, { focused: true });
  await chrome.tabs.remove(tabId).catch(() => {});
  toast(target, 'Switched to the tab you already had open', { label: 'Open in new tab', message: reopen });
}

chrome.tabs.onCreated.addListener((tab) => {
  if (isNewTabPage(tab.pendingUrl || tab.url)) trackNewTab(tab.id, true);
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url && !isNewTabPage(info.url)) {
    switchQueue = switchQueue.then(() => maybeSwitchToExisting(tabId, info.url)).catch(() => {});
  }
  // Redirects during the first load still count; after that it's a normal tab.
  if (info.status === 'complete') {
    switchQueue = switchQueue.then(async () => {
      try { if (isNewTabPage((await chrome.tabs.get(tabId)).url)) return; } catch {}
      await trackNewTab(tabId, false);
    }).catch(() => {});
  }
});

chrome.tabs.onAttached.addListener((tabId) => {
  locked(async () => { if (await nativeMode()) await reconcileTab(tabId); });
});

// Renaming or recoloring a group in Chrome renames/recolors its folder.
chrome.tabGroups.onUpdated.addListener(({ id }) => locked(async () => {
  if (!(await nativeMode())) return;
  const group = await aliveGroup(id); // the event's snapshot can predate our own update
  if (!group) return;
  const map = await session.get('folderGroups', {});
  const entry = Object.entries(map).find(([, gid]) => gid === group.id);
  if (!entry) return;
  const folderId = entry[0].split(':')[1];
  try {
    const [folder] = await chrome.bookmarks.get(folderId);
    if (group.title && group.title !== folder.title) await chrome.bookmarks.update(folderId, { title: group.title });
  } catch { return; }
  const meta = (await getMeta())[folderId];
  if (group.color !== colorFor(folderId, meta)) await patchMeta(folderId, { color: group.color });
}));

// Moving an item between folders in the sidebar (or bookmark manager) moves
// its open tab into the matching group.
chrome.bookmarks.onMoved.addListener((id) => locked(async () => {
  if (!(await nativeMode())) return;
  const tab = await findLinkedTab(id);
  if (!tab) return;
  const [bm] = await chrome.bookmarks.get(id);
  await placeTab(tab.id, bm);
}));

chrome.bookmarks.onChanged.addListener((id, info) => locked(async () => {
  if (!info.title || !(await nativeMode())) return;
  const map = await session.get('folderGroups', {});
  for (const [key, gid] of Object.entries(map)) {
    if (key.split(':')[1] !== id) continue;
    const g = await aliveGroup(gid);
    if (g && g.title !== info.title) await chrome.tabGroups.update(gid, { title: info.title });
  }
}));

chrome.tabs.onReplaced.addListener((added, removed) => locked(async () => {
  for (const key of ['tabOverrides', 'tabLinks']) {
    const map = await session.get(key, {});
    if (removed in map) { map[added] = map[removed]; delete map[removed]; await session.set(key, map); }
  }
}));

chrome.bookmarks.onRemoved.addListener((id, info) => locked(async () => {
  const gone = new Set([id]);
  (function walk(n) { if (!n) return; gone.add(n.id); (n.children || []).forEach(walk); })(info.node);
  const meta = await getMeta();
  let changed = false;
  for (const bid of gone) if (bid in meta) { delete meta[bid]; changed = true; }
  if (changed) await local.set('bookmarkMeta', meta);
  const links = await session.get('tabLinks', {});
  let linksChanged = false;
  for (const [tid, bid] of Object.entries(links)) if (gone.has(bid)) { delete links[tid]; linksChanged = true; }
  if (linksChanged) await session.set('tabLinks', links);
}));

// "Open in new tab" on the switched-tab message. The tab starts at the URL, not
// the New Tab page, so it isn't treated as a duplicate.
async function openSeparately({ url, windowId, index }) {
  const win = await chrome.windows.get(windowId).catch(() => null);
  const tab = await chrome.tabs.create({ url, active: true, ...(win ? { windowId, index } : {}) });
  await chrome.windows.update(tab.windowId, { focused: true });
  return tab.id;
}

const handlers = {
  openSeparately: (m) => openSeparately(m),
  getOverrides: (msg, sender) => (sender.tab ? getOverrides(sender.tab.id) : {}),
  getRoots: () => locked(ensureRoots),
  runAction: (msg, sender) => runAction(msg.action, msg.tabId ? null : sender.tab)
    .then(() => true),
  runActionOnTab: async (msg) => runAction(msg.action, await chrome.tabs.get(msg.tabId)).then(() => true),
  openBookmark: (msg) => locked(() => openBookmark(msg)),
  addTabToFolder: (msg) => locked(() => addTabToFolder(msg)),
  renameBookmark: (msg) => locked(() => renameBookmark(msg)),
  setBookmarkIcon: (msg) => locked(() => setBookmarkIcon(msg)),
  renameTab: (msg) => locked(() => renameTab(msg)),
  setTabIcon: (msg) => locked(() => setTabIcon(msg)),
  linkTab: (msg) => locked(() => linkTab(msg.tabId, msg.bookmarkId)),
  unlinkTab: (msg) => locked(async () => {
    const links = await session.get('tabLinks', {});
    delete links[msg.tabId];
    await session.set('tabLinks', links);
  }),
  refreshPRs: () => refreshPRs().then(() => true),
  openPR: (msg) => locked(() => openInPRGroup(msg)),
  copyText: async (msg) => {
    await ensureOffscreen();
    return chrome.runtime.sendMessage({ target: 'offscreen', type: 'copy', text: msg.text });
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target) return false; // addressed to the offscreen doc or the panel
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});
