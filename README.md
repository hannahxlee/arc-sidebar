# hannah's hub for Chrome

An Arc-style vertical sidebar for Chrome, built on the Side Panel API (Manifest V3).

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin the extension and click its icon, or press **⌘⇧S**, to open the sidebar.
4. Open **Settings** (gear icon) and paste a GitHub token to enable the PR folder.

Requires Chrome 116 or newer.

## Features

| Feature | How to use it |
| --- | --- |
| Keyboard shortcuts | **⌘⇧C** copies the current URL (see below for a one-time setup) and **⌘⇧S** toggles the sidebar. Add your own in-page shortcuts for any action in Settings. |
| GitHub PRs live folder | Lists your open PRs and PRs where your review is requested. Each row shows the review decision, approval count, CI status, and reviewer avatars. Refreshes every 3 minutes (configurable). The toolbar badge counts PRs waiting on you. |
| Folders | **+ New folder**, then drag tabs in, or right-click a tab and choose **Add to folder**. Folders are real bookmarks under *Other Bookmarks > hannah's hub*, so they sync and survive restarts. Clicking an item opens it or jumps to its open tab. |
| Favorites | Drag a tab onto the icon grid or click **+**. Stored in *hannah's hub > Favorites*. A dot means the tab is open. |
| Rename tabs | Double-click any title in the sidebar, or use the rename shortcut. The new name is also enforced on the page's real title, even if the site changes it. |
| Change tab icon | Double-click a tab's icon, or right-click and choose **Change icon…**. Pick an emoji, type any emoji, or upload an image. |

Other Arc behaviours included:

- Tabs inside Favorites or folders leave the **Today** list.
- Dragging a folder item back into Today unpins it.
- **Clear** closes everything in Today.
- **Select several tabs** in Today with Shift-click (a range) or ⌘-click (one at a time). Drag the selection onto a folder or Favorites, or right-click it to add, copy, move or close them together. Esc clears the selection.
- **No duplicate tabs.** If you press ⌘T and go to a page that's already open, the new tab closes and Chrome switches to the existing tab. To get a separate copy, click **Open in new tab** in the message that appears. Turn this off under Settings → Tabs.
- Middle-click a row to close it or open it in the background.

## Claiming ⌘⇧C from Chrome

Chrome uses ⌘⇧C for DevTools, so it won't hand that shortcut to an extension automatically. On install, the extension detects this and opens Settings with setup steps. To claim it:

1. Open `chrome://extensions/shortcuts`.
2. Find **hannah's hub → Copy the current tab's URL** and click the pencil icon.
3. Press ⌘⇧C.

Until you do, ⌘⇧C still copies the URL on regular web pages through an in-page fallback. In-page shortcuts can't work on `chrome://` pages or while the address bar has focus. The Settings page warns when a shortcut you record clashes with one of Chrome's.

## Chrome vertical tabs mode

This mode is on by default and can be turned off in Settings. Turn on Chrome's vertical tabs by right-clicking the tab strip and choosing **Show tabs vertically**.

- **Favorites are pinned tabs.** Pinning a tab in Chrome adds it to Favorites, and unpinning removes it.
- **Folders are tab groups** with the folder's name. Dragging a tab into the group adds it to the folder, and dragging it out of the group removes it. Renaming or recoloring the group updates the folder, and renaming the folder renames the group.
- **PRs** opened from the sidebar collect in a "Pull Requests" group.
- **Today lists every open tab** that isn't in a Favorite or folder, the same as with the mode off, so you can double-click to rename or change icons on any of them. The page's right-click menu also has **Rename tab…** and **Change tab icon…**.
- **After a restart,** the extension re-links Chrome's restored pinned tabs and tab groups to Favorites and folders.
- **Existing tabs are imported.** Pinned tabs that aren't Favorites yet are added to Favorites. Tabs in a group whose name matches a folder are added to that folder.

## GitHub token

Use a classic token with the `repo` and `read:org` scopes. Fine-grained tokens work too, but only for the repositories they cover. For organizations that use SAML single sign-on, click **Configure SSO** on the token and authorize it, or those PRs will be missing. The token is stored in `chrome.storage.local` and only sent to `api.github.com`.

## Limitations

- **Restricted pages.** Chrome doesn't let extensions script `chrome://` pages, the Web Store, or the new-tab page. Renames and custom icons there show only in the sidebar, and in-page shortcuts don't fire. Browser-wide shortcuts such as ⌘⇧C still work.
- **Renames and icons on loose tabs** last until the tab closes. Renames and icons on Favorites and folder items are saved permanently.
- **Browser-wide shortcuts.** Chrome allows at most four suggested shortcuts per extension. The others start unbound and can be assigned at `chrome://extensions/shortcuts`.

## Files

- `background.js`: service worker. Owns state, bookmarks, actions, and GitHub polling.
- `sidepanel.*`: the sidebar UI.
- `content.js`: enforces custom titles and icons and listens for in-page shortcuts.
- `options.*`: settings page.
- `lib/github.js`: GraphQL query for PRs.
- `lib/actions.js`: shortcut actions and key-combo helpers.
- `offscreen.*`: clipboard writer used by the copy shortcuts.
