// Applies custom tab titles/icons and listens for in-page custom shortcuts.
(() => {
  // After the extension reloads, the old copy of this script stays in the page
  // but can no longer reach the extension. Let a fresh copy take over then.
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  if (window.top !== window) return;
  if (window.__arcSidebarLoaded?.()) return;
  window.__arcSidebarLoaded = alive;

  let overrides = {};
  let shortcutMap = {}; // combo -> action
  let ourIcon = null;
  let observer = null;
  let headObserved = false;

  // ---------- title ----------
  function applyTitle() {
    if (overrides.title && document.title !== overrides.title) document.title = overrides.title;
  }

  // ---------- icon ----------
  function disableSiteIcons() {
    document.querySelectorAll('link[rel~="icon"]:not([data-arc-sidebar])').forEach((l) => {
      l.dataset.arcOrigRel = l.getAttribute('rel');
      l.setAttribute('rel', 'arc-sidebar-disabled-icon');
    });
  }

  function restoreSiteIcons() {
    document.querySelectorAll('link[data-arc-orig-rel]').forEach((l) => {
      l.setAttribute('rel', l.dataset.arcOrigRel);
      delete l.dataset.arcOrigRel;
    });
  }

  function applyIcon() {
    const head = document.head;
    if (!head) return;
    if (!overrides.icon) {
      if (ourIcon) { ourIcon.remove(); ourIcon = null; restoreSiteIcons(); }
      return;
    }
    disableSiteIcons();
    if (!ourIcon || !ourIcon.isConnected) {
      ourIcon = document.createElement('link');
      ourIcon.rel = 'icon';
      ourIcon.dataset.arcSidebar = '1';
      head.appendChild(ourIcon);
    }
    if (ourIcon.href !== overrides.icon) ourIcon.href = overrides.icon;
  }

  function applyAll() {
    applyTitle();
    applyIcon();
    if (overrides.title || overrides.icon) watch();
  }

  // Sites rewrite their title/favicon (SPAs, notification counts); keep ours.
  function watch() {
    if (!observer) {
      observer = new MutationObserver(() => {
        if (!headObserved && document.head) observeHead();
        applyTitle();
        applyIcon();
      });
      observer.observe(document.documentElement, { childList: true });
    }
    if (!headObserved && document.head) observeHead();
  }

  function observeHead() {
    headObserved = true;
    observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['rel', 'href'] });
  }

  // ---------- shortcuts ----------
  function keyFromCode(code, key) {
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

  function comboFromEvent(e) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return null;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    parts.push(keyFromCode(e.code, e.key));
    return parts.join('+');
  }

  function setShortcuts(shortcuts) {
    shortcutMap = {};
    for (const [action, combo] of Object.entries(shortcuts || {})) if (combo) shortcutMap[combo] = action;
  }

  function isEditable(el) {
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  window.addEventListener('keydown', function onKey(e) {
    if (!alive()) { window.removeEventListener('keydown', onKey, true); return; }
    if (e.repeat) return;
    const combo = comboFromEvent(e);
    const action = combo && shortcutMap[combo];
    if (!action) return;
    const hasMod = e.ctrlKey || e.metaKey || e.altKey;
    if (!hasMod && isEditable(document.activeElement)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    chrome.runtime.sendMessage({ type: 'runAction', action }).catch(() => {});
  }, true);

  // ---------- wiring ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'applyOverrides') {
      overrides = msg.overrides || {};
      applyAll();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shortcuts) setShortcuts(changes.shortcuts.newValue);
  });

  chrome.storage.local.get('shortcuts').then(({ shortcuts }) => setShortcuts(shortcuts)).catch(() => {});

  chrome.runtime.sendMessage({ type: 'getOverrides' }).then((res) => {
    if (res?.ok && res.result) {
      overrides = res.result;
      applyAll();
    }
  }).catch(() => {});

  document.addEventListener('DOMContentLoaded', () => { if (overrides.title || overrides.icon) applyAll(); });
})();
