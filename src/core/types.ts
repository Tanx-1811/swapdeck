/** Which parts of a site's state make up a sign-in session. */
export type StorageKinds = {
  cookies: boolean;
  localStorage: boolean;
  sessionStorage: boolean;
  indexedDB: boolean;
};

/** Dotted paths tried in order to read identity fields out of a JSON value or JWT payload. */
export type IdentityFields = {
  id?: string[];
  email?: string[];
  name?: string[];
  avatar?: string[];
};

/**
 * How to tell which account is signed in, from the captured state alone.
 * Names may use `*` as a wildcard.
 */
export type DetectorSpec =
  | { kind: 'auto' }
  | { kind: 'none' }
  | { kind: 'localStorage'; keys: string[]; fields?: IdentityFields }
  | { kind: 'cookie'; names: string[]; format: 'plain' | 'json' | 'jwt' | 'supabase-ssr'; fields?: IdentityFields };

/** A site (web app) whose accounts Swapdeck switches between. */
export type AppDef = {
  id: string;
  /** Set when the app was added from a built-in preset. */
  presetId?: string;
  name: string;
  /** Hex color used for the app's tile when it has no icon. */
  color: string;
  /** Registrable domains whose cookies form the session, e.g. ["supabase.com"]. Subdomains are included. */
  domains: string[];
  /** The origin whose web storage is part of the session, e.g. "https://supabase.com". */
  origin: string;
  /** Where to go when the app is opened without a remembered page. */
  homeUrl: string;
  /** Where to go after "sign in with another account"; defaults to homeUrl. */
  loginUrl?: string;
  /**
   * A static page on the origin (no app code runs there) used while swapping
   * storage, so the app can't write the old account's data back mid-switch.
   */
  stagingPath: string;
  storage: StorageKinds;
  detector: DetectorSpec;
  /** Regex (on pathname) whose first group identifies a "recent item", e.g. a Supabase project ref. */
  recentPattern?: string;
  /** Suffix stripped from page titles for recent items, e.g. " | Supabase". */
  titleSuffix?: string;
  order: number;
  createdAt: number;
};

export type Pin = { id: string; title: string; url: string };
export type RecentItem = { key: string; title: string; url: string; at: number };

export type Account = {
  id: string;
  appId: string;
  label: string;
  color: string;
  /** Optional symbol (one of ACCOUNT_ICONS) shown instead of initials. */
  icon?: string;
  /** Emoji chosen in earlier versions; still shown when there is no icon. */
  emoji?: string;
  note?: string;
  email?: string;
  name?: string;
  /** Stable user id from the site (e.g. Supabase user id), used to recognise the account. */
  identityId?: string;
  avatarUrl?: string;
  /** Page to open after switching, overriding the remembered one. */
  homeUrl?: string;
  /**
   * Production or a client's live account: a red label, a warning strip on its
   * pages while in use, and a confirmation before switching to it.
   */
  important?: boolean;
  /** Last page used with this account. */
  lastUrl?: string;
  pins: Pin[];
  recents: RecentItem[];
  order: number;
  createdAt: number;
  lastUsedAt?: number;
  /** When the saved session was last refreshed from the live browser. */
  capturedAt?: number;
  /** Size of the saved session, for display (the session itself may be sealed). */
  stats?: SessionStats;
  switchCount: number;
};

export type SessionStats = { cookies: number; storageKeys: number; databases: number; bytes: number };

/** A cookie as saved in a snapshot (a subset of chrome.cookies.Cookie). */
export type CookieRecord = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  hostOnly: boolean;
  session: boolean;
  sameSite: 'no_restriction' | 'lax' | 'strict' | 'unspecified';
  expirationDate?: number;
};

/** A value or key from IndexedDB, encoded so it survives JSON. */
export type Encoded = unknown;

export type IdbIndexDump = { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean };
export type IdbStoreDump = {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: IdbIndexDump[];
  /** [key, value] pairs; the key is null for in-line keys. */
  records: [Encoded, Encoded][];
};
export type IdbDatabaseDump = { name: string; version: number; stores: IdbStoreDump[] };

export type WebStorageDump = {
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  indexedDB?: IdbDatabaseDump[];
};

export type Identity = {
  id?: string;
  email?: string;
  name?: string;
  avatar?: string;
  /** strong: read from a known sign-in record. weak: a guess, shown but never acted on. */
  confidence: 'strong' | 'weak';
  /** Where it was found, for the details view, e.g. "localStorage: sb-abc-auth-token". */
  source: string;
};

export type Snapshot = {
  v: 1;
  capturedAt: number;
  origin: string;
  cookies: CookieRecord[];
  storage: WebStorageDump;
  identity?: Identity;
};

/** Snapshot sealed with the vault's public key (see core/crypto.ts). */
export type SealedBox = { alg: 'RSA-OAEP-256+A256GCM'; key: string; iv: string; data: string };

export type StoredSnapshot = { v: 1; plain: Snapshot } | { v: 1; sealed: SealedBox };

export type HistoryKind = 'switch' | 'fresh' | 'save' | 'auto-save' | 'restore';

export type HistoryEntry = {
  id: string;
  at: number;
  kind: HistoryKind;
  appId: string;
  appName: string;
  fromId?: string | null;
  fromLabel?: string;
  toId?: string | null;
  toLabel?: string;
  ok: boolean;
  error?: string;
  /** The workspace whose switch this was part of. */
  via?: string;
};

/**
 * A workspace (VI: "bên") is a client, company or project: which saved account
 * it uses on each app. Switching to it switches every one of those apps at once.
 */
export type Workspace = {
  id: string;
  name: string;
  color: string;
  icon?: string;
  emoji?: string;
  note?: string;
  /** appId → accountId. Apps not listed are left as they are. */
  members: Record<string, string>;
  /** Pages opened together in a tab group with "Open workspace". */
  links: Pin[];
  order: number;
  createdAt: number;
  lastUsedAt?: number;
  switchCount: number;
};

export type PopupLayout = 'auto' | 'compact' | 'wide';
/** Accent colors of the lacquer palette: son (vermilion), ngọc (jade), chàm (indigo), vàng (gold leaf). */
export type Accent = 'son' | 'ngoc' | 'cham' | 'vang';
export type ActionOpens = 'popup' | 'panel';

export type LanguagePreference = 'auto' | 'en' | 'vi';
export type AfterSwitch = 'last' | 'same' | 'home';
export type ThemePreference = 'system' | 'light' | 'dark';

export type Settings = {
  language: LanguagePreference;
  theme: ThemePreference;
  /** Where a tab goes after switching: the account's last page, the same page, or the app's home. */
  afterSwitch: AfterSwitch;
  /** Save a newly signed-in account automatically (only with a reliable detector). */
  autoCapture: boolean;
  /** Keep the active account's saved session fresh while browsing (identity-checked). */
  autoSync: boolean;
  /** Show a small confirmation on the page after switching. */
  pageToasts: boolean;
  /** Ask before switching from the popup. */
  confirmSwitch: boolean;
  /** Show the active account's initials on the toolbar icon. */
  badge: boolean;
  /** Lock the vault after this many minutes without switching (0 = only when Chrome closes). */
  autoLockMinutes: number;
  /** Popup width: two columns when many apps are added (auto), always narrow, or always wide. */
  popupLayout: PopupLayout;
  /** What the toolbar button opens. */
  actionOpens: ActionOpens;
  accent: Accent;
  /** Until when the reminder to lock saved sessions with a passphrase stays hidden (0: not snoozed). */
  vaultNudgeUntil: number;
  /** Ask before a switch reloads tabs that may hold unsaved work. */
  guardUnsaved: boolean;
};

export type VaultMeta = {
  v: 1;
  salt: string;
  iterations: number;
  /** SPKI public key (base64): sealing works while locked. */
  publicKey: string;
  /** PKCS#8 private key encrypted with the passphrase-derived key. */
  privateKey: { iv: string; data: string };
  createdAt: number;
};

export type ActiveMap = Record<string, string | null>;
