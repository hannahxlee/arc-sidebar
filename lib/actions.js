// Actions that can be bound to keyboard shortcuts.
// "command" is the matching chrome.commands name (browser-wide shortcut), if any.
export const ACTIONS = [
  { id: 'copyUrl', label: 'Copy URL', command: 'copy-url' },
  { id: 'copyMarkdownLink', label: 'Copy Markdown link', command: 'copy-markdown-link' },
  { id: 'copyTitle', label: 'Copy page title' },
  { id: 'renameTab', label: 'Rename tab', command: 'rename-tab' },
  { id: 'resetTab', label: 'Reset tab name & icon' },
  { id: 'addToFavorites', label: 'Add tab to Favorites', command: 'add-to-favorites' },
  { id: 'duplicateTab', label: 'Duplicate tab', command: 'duplicate-tab' },
  { id: 'togglePin', label: 'Pin / unpin tab' },
  { id: 'toggleMute', label: 'Mute / unmute tab' },
  { id: 'newTab', label: 'New tab' },
  { id: 'reopenClosedTab', label: 'Reopen last closed tab' },
  { id: 'moveToNewWindow', label: 'Move tab to new window' },
  { id: 'refreshPRs', label: 'Refresh GitHub PRs', command: 'refresh-prs' },
  { id: 'openSettings', label: "Open hannah's hub settings" },
];

export const COMMAND_TO_ACTION = Object.fromEntries(
  ACTIONS.filter((a) => a.command).map((a) => [a.command, a.id])
);

// In-page shortcuts written on first install. They avoid combos Chrome already
// uses. Copy URL is bound here too so that it still works on regular pages
// when Chrome refused to assign the browser-wide ⌘⇧C command.
export function defaultShortcuts(isMac) {
  if (isMac) {
    return {
      copyUrl: 'Shift+Meta+C',
      copyMarkdownLink: 'Alt+Shift+Meta+C',
      renameTab: 'Alt+Shift+Meta+R',
      addToFavorites: 'Alt+Shift+Meta+F',
      duplicateTab: 'Alt+Shift+Meta+D',
    };
  }
  return {
    copyUrl: 'Ctrl+Shift+C',
    copyMarkdownLink: 'Alt+Shift+M',
    renameTab: 'Alt+Shift+R',
    addToFavorites: 'Alt+Shift+F',
    duplicateTab: 'Alt+Shift+D',
  };
}

// Defaults shipped in 1.0.0, used to migrate untouched bindings.
export function legacyDefaultShortcuts(isMac) {
  const mod = isMac ? 'Meta' : 'Ctrl';
  return {
    copyMarkdownLink: `Alt+${mod}+C`,
    renameTab: `Alt+${mod}+R`,
    addToFavorites: `Alt+${mod}+F`,
    duplicateTab: `Alt+${mod}+D`,
  };
}

// Chrome's own shortcuts. "reserved" ones never reach web pages, so an in-page
// binding on them can't work; the rest work in-page but shadow Chrome's action.
const CHROME_MAC = {
  'Meta+T': ['New tab', true], 'Meta+N': ['New window', true], 'Meta+W': ['Close tab', true],
  'Meta+Q': ['Quit Chrome', true], 'Shift+Meta+T': ['Reopen closed tab', true],
  'Shift+Meta+N': ['New Incognito window', true], 'Shift+Meta+W': ['Close window', true],
  'Shift+Meta+C': ['DevTools inspect element'], 'Alt+Meta+C': ['DevTools inspect element'],
  'Alt+Meta+I': ['Developer tools'], 'Alt+Meta+J': ['JavaScript console'], 'Alt+Meta+U': ['View source'],
  'Shift+Meta+B': ['Show bookmarks bar'], 'Alt+Meta+B': ['Bookmark manager'], 'Shift+Meta+O': ['Bookmark manager'],
  'Shift+Meta+D': ['Bookmark all tabs'], 'Shift+Meta+R': ['Hard reload'], 'Shift+Meta+H': ['Home page'],
  'Shift+Meta+A': ['Search tabs'], 'Shift+Meta+M': ['Switch profile'], 'Shift+Meta+G': ['Find previous'],
  'Shift+Meta+Backspace': ['Clear browsing data'], 'Alt+Meta+L': ['Downloads'], 'Meta+Y': ['History'],
  'Meta+L': ['Address bar'], 'Meta+D': ['Bookmark this tab'], 'Meta+R': ['Reload'], 'Meta+F': ['Find'],
  'Meta+G': ['Find next'], 'Meta+P': ['Print'], 'Meta+S': ['Save page'], 'Meta+O': ['Open file'],
  'Meta+,': ['Settings'], 'Alt+Meta+Left': ['Previous tab'], 'Alt+Meta+Right': ['Next tab'],
  'Shift+Meta+[': ['Previous tab'], 'Shift+Meta+]': ['Next tab'],
};
const CHROME_OTHER = {
  'Ctrl+T': ['New tab', true], 'Ctrl+N': ['New window', true], 'Ctrl+W': ['Close tab', true],
  'Ctrl+Shift+T': ['Reopen closed tab', true], 'Ctrl+Shift+N': ['New Incognito window', true],
  'Ctrl+Shift+W': ['Close window', true], 'Ctrl+Shift+Q': ['Quit Chrome', true],
  'Ctrl+Shift+C': ['DevTools inspect element'], 'Ctrl+Shift+I': ['Developer tools'], 'Ctrl+Shift+J': ['JavaScript console'],
  'Ctrl+U': ['View source'], 'Ctrl+Shift+B': ['Show bookmarks bar'], 'Ctrl+Shift+O': ['Bookmark manager'],
  'Ctrl+Shift+D': ['Bookmark all tabs'], 'Ctrl+Shift+R': ['Hard reload'], 'Ctrl+Shift+A': ['Search tabs'],
  'Ctrl+Shift+M': ['Switch profile'], 'Ctrl+Shift+Delete': ['Clear browsing data'], 'Ctrl+H': ['History'],
  'Ctrl+J': ['Downloads'], 'Ctrl+L': ['Address bar'], 'Ctrl+D': ['Bookmark this tab'], 'Ctrl+R': ['Reload'],
  'Ctrl+F': ['Find'], 'Ctrl+G': ['Find next'], 'Ctrl+P': ['Print'], 'Ctrl+S': ['Save page'], 'Ctrl+O': ['Open file'],
  'Ctrl+E': ['Search'], 'Ctrl+K': ['Search'], 'Alt+F': ['Chrome menu'], 'Alt+E': ['Chrome menu'],
  'Alt+Left': ['Back'], 'Alt+Right': ['Forward'], 'Alt+Home': ['Home page'],
};

export function chromeConflict(combo, isMac) {
  const hit = (isMac ? CHROME_MAC : CHROME_OTHER)[combo];
  if (hit) return { label: hit[0], reserved: !!hit[1] };
  if (/^(Meta|Ctrl)\+\d$/.test(combo)) return { label: 'Switch to tab', reserved: true };
  return null;
}

const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'];

export function keyFromCode(code, key) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  const named = {
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=',
    Backquote: '`', Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  };
  return named[code] || key;
}

export function comboFromEvent(e) {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(keyFromCode(e.code, e.key));
  return parts.join('+');
}

export function formatCombo(combo, isMac) {
  if (!combo) return '';
  const parts = combo.split('+');
  if (!isMac) return parts.join(' + ');
  const sym = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
  return parts.map((p) => (MODS.includes(p) ? sym[p] : p)).join('');
}
