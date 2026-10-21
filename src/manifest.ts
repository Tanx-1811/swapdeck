import pkg from '../package.json' with { type: 'json' };

/**
 * Builds manifest.json at build time so the version always matches package.json.
 *
 * None of the install-time permissions shows a warning (see docs/PRIVACY.md):
 * - storage, unlimitedStorage: saved sessions and settings stay on this device.
 * - cookies: saves and restores the sign-in cookies of the sites the user added.
 * - scripting: reads and restores the site's local storage while switching, and
 *   shows a small confirmation on the page afterwards.
 * - activeTab: lets the popup offer "Add this site" for the tab the user is on.
 * - contextMenus, alarms, favicon: right-click switching, auto-lock, site icons.
 * - declarativeNetRequestWithHostAccess: while a switch runs, blocks the site's own
 *   scripts in the one tab doing the swap, so they can't write the old session back.
 * - sidePanel: Swapdeck can stay open next to the page for frequent switching.
 * - tabGroups: "Open workspace" opens a workspace's pages together in a named group.
 * Host access is optional and requested per site when the user adds it, e.g.
 * only *.supabase.com for Supabase. Cookies and storage of other sites are never read.
 */
export function createManifest(mode: string): chrome.runtime.ManifestV3 {
  const manifest: chrome.runtime.ManifestV3 = {
    manifest_version: 3,
    name: '__MSG_extName__',
    short_name: 'Swapdeck',
    version: pkg.version,
    description: '__MSG_extDescription__',
    // Open source (MIT): Chrome links "Visit website" here.
    homepage_url: 'https://github.com/Tanx-1811/swapdeck',
    default_locale: 'en',
    minimum_chrome_version: '116',
    // Sessions saved from incognito would outlive it; keep the extension out of incognito.
    incognito: 'not_allowed',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: '__MSG_actionTitle__',
      default_popup: 'popup/popup.html',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
    options_ui: { page: 'options/options.html', open_in_tab: true },
    background: {
      service_worker: 'service-worker.js',
      type: 'module',
    },
    permissions: [
      'storage',
      'unlimitedStorage',
      'cookies',
      'scripting',
      'activeTab',
      'contextMenus',
      'alarms',
      'favicon',
      'declarativeNetRequestWithHostAccess',
      'sidePanel',
      'tabGroups',
    ],
    side_panel: { default_path: 'sidepanel/sidepanel.html' },
    optional_host_permissions: ['*://*/*'],
    // Unusual on purpose: a common word would hijack ordinary searches.
    omnibox: { keyword: 'swd' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+A' },
        description: '__MSG_commandOpen__',
      },
      'switch-next': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: '__MSG_commandNext__',
      },
      'switch-previous': { description: '__MSG_commandPrevious__' },
      'new-login': { description: '__MSG_commandNewLogin__' },
      'switch-workspace-next': { description: '__MSG_commandWorkspaceNext__' },
      'open-side-panel': { description: '__MSG_commandSidePanel__' },
      'open-manager': { description: '__MSG_commandManager__' },
    },
  };

  // The e2e build is granted host access up front, because automated tests
  // cannot click Chrome's permission prompt. Production never requests it at install.
  if (mode === 'e2e') {
    manifest.host_permissions = ['<all_urls>'];
  }

  return manifest;
}
