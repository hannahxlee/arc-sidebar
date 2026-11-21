import { ACTIONS, chromeConflict, comboFromEvent, defaultShortcuts, formatCombo } from './lib/actions.js';
import { fetchPRs } from './lib/github.js';

const $ = (id) => document.getElementById(id);
const isMac = (await chrome.runtime.getPlatformInfo()).os === 'mac';

function status(id, text, kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${kind}`;
}

// ---------- GitHub ----------
const { githubToken, settings = {} } = await chrome.storage.local.get(['githubToken', 'settings']);
if (githubToken) {
  $('token').placeholder = '•••••••••• (saved)';
  status('token-status', 'A token is saved.', 'ok');
}
$('refresh').value = String(settings.refreshMinutes || 3);
$('include-assigned').checked = !!settings.includeAssigned;
$('native-tabs').checked = settings.nativeTabs !== false;
$('switch-existing').checked = settings.switchToExisting !== false;

async function saveSettings(patch) {
  const { settings: cur = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...cur, ...patch } });
}

async function testToken(token) {
  status('token-status', 'Testing…');
  try {
    const d = await fetchPRs(token);
    status('token-status', `Connected as ${d.login}. ${d.reviewRequested.length} PR(s) await your review and ${d.mine.length} of yours are open.`, 'ok');
    return true;
  } catch (e) {
    status('token-status', e.message, 'err');
    return false;
  }
}

$('save-token').addEventListener('click', async () => {
  const token = $('token').value.trim();
  if (!token) return status('token-status', 'Paste a token first.', 'err');
  if (await testToken(token)) {
    await chrome.storage.local.set({ githubToken: token });
    $('token').value = '';
    $('token').placeholder = '•••••••••• (saved)';
  }
});
$('test-token').addEventListener('click', async () => {
  const token = $('token').value.trim() || (await chrome.storage.local.get('githubToken')).githubToken;
  if (!token) return status('token-status', 'No token saved yet.', 'err');
  testToken(token);
});
$('clear-token').addEventListener('click', async () => {
  await chrome.storage.local.remove(['githubToken', 'prData']);
  $('token').placeholder = 'ghp_…';
  status('token-status', 'Token removed.');
});
$('refresh').addEventListener('change', () => saveSettings({ refreshMinutes: Number($('refresh').value) }));
$('include-assigned').addEventListener('change', () => saveSettings({ includeAssigned: $('include-assigned').checked }));
$('switch-existing').addEventListener('change', () => saveSettings({ switchToExisting: $('switch-existing').checked }));
$('native-tabs').addEventListener('change', () => saveSettings({ nativeTabs: $('native-tabs').checked }));

// ---------- chrome.commands ----------
async function renderCommands() {
  const cmds = await chrome.commands.getAll();
  const copy = cmds.find((c) => c.name === 'copy-url');
  $('setup-banner').hidden = !copy || !!copy.shortcut;
  const combo = isMac ? '⌘⇧C' : 'Ctrl+Shift+C';
  for (const id of ['banner-combo', 'banner-combo-2', 'banner-combo-3']) $(id).textContent = combo;
  $('commands').replaceChildren(...cmds.filter((c) => c.description).map((c) => {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.textContent = c.description;
    const b = document.createElement('td');
    const k = document.createElement('span');
    k.className = `kbd${c.shortcut ? '' : ' empty'}`;
    k.style.cursor = 'default';
    k.textContent = c.shortcut || 'Not set';
    b.append(k);
    tr.append(a, b);
    return tr;
  }));
}
const snippet = `chrome.developerPrivate.updateExtensionCommand({extensionId: '${chrome.runtime.id}', commandName: 'copy-url', keybinding: '${isMac ? 'Command' : 'Ctrl'}+Shift+C'}, () => console.log(chrome.runtime.lastError?.message || 'Done: reload this page to see it'))`;
$('console-snippet').textContent = snippet;
$('copy-snippet').addEventListener('click', async () => {
  await navigator.clipboard.writeText(snippet);
  status('snippet-status', 'Copied.', 'ok');
});
document.querySelectorAll('.open-shortcuts').forEach((b) =>
  b.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })));
document.addEventListener('focus', renderCommands, true);
window.addEventListener('focus', renderCommands);
renderCommands();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') renderCommands(); });

// ---------- custom shortcuts ----------
let shortcuts = (await chrome.storage.local.get('shortcuts')).shortcuts || defaultShortcuts(isMac);
let recording = null;

async function saveShortcuts() {
  await chrome.storage.local.set({ shortcuts });
  renderShortcuts();
}

function renderShortcuts() {
  $('shortcuts').replaceChildren(...ACTIONS.map((a) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = a.label;
    const cell = document.createElement('td');
    const btn = document.createElement('button');
    const combo = shortcuts[a.id];
    btn.className = `kbd${combo ? '' : ' empty'}${recording === a.id ? ' recording' : ''}`;
    btn.textContent = recording === a.id ? 'Press keys…' : combo ? formatCombo(combo, isMac) : 'Click to set';
    btn.addEventListener('click', () => { recording = a.id; renderShortcuts(); });
    cell.append(btn);
    const clash = combo && chromeConflict(combo, isMac);
    if (clash) {
      const w = document.createElement('span');
      w.className = `warn${clash.reserved ? ' bad' : ''}`;
      w.textContent = clash.reserved
        ? `Chrome reserves this for "${clash.label}", so it will never reach the page.`
        : a.id === 'copyUrl'
          ? `Overrides Chrome's "${clash.label}" on web pages.`
          : `Replaces Chrome's "${clash.label}" on web pages.`;
      name.append(w);
    }
    if (combo) {
      const x = document.createElement('button');
      x.className = 'x';
      x.title = 'Clear';
      x.textContent = '×';
      x.addEventListener('click', () => { delete shortcuts[a.id]; saveShortcuts(); });
      cell.append(x);
    }
    tr.append(name, cell);
    return tr;
  }));
}

window.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { recording = null; return renderShortcuts(); }
  if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    delete shortcuts[recording];
    recording = null;
    return saveShortcuts();
  }
  const combo = comboFromEvent(e);
  if (!combo) return;
  if (!e.metaKey && !e.ctrlKey && !e.altKey) {
    return status('shortcut-status', 'Include ⌘, Ctrl, or Option/Alt so the shortcut does not fire while typing.', 'err');
  }
  const clash = Object.entries(shortcuts).find(([id, c]) => c === combo && id !== recording);
  if (clash) delete shortcuts[clash[0]];
  shortcuts[recording] = combo;
  const label = ACTIONS.find((a) => a.id === recording).label;
  const chrome_ = chromeConflict(combo, isMac);
  const note = chrome_?.reserved ? ` Chrome reserves it for "${chrome_.label}", so pick another.` : chrome_ ? ` It replaces Chrome's "${chrome_.label}" on web pages.` : '';
  status('shortcut-status', `${formatCombo(combo, isMac)} now runs "${label}".${clash ? ' It was removed from another action.' : ''}${note}`, chrome_?.reserved ? 'err' : 'ok');
  recording = null;
  saveShortcuts();
}, true);

$('reset-shortcuts').addEventListener('click', () => {
  shortcuts = defaultShortcuts(isMac);
  status('shortcut-status', 'Defaults restored.', 'ok');
  saveShortcuts();
});

renderShortcuts();
