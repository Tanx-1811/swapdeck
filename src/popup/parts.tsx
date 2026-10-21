import { Ellipsis, Globe, Lock, LockOpen, PanelRight, Pin, Plus, Settings, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { displayUrl, parseHttpUrl } from '../core/domains';
import { findPreset } from '../core/presets';
import type { Account, AppDef } from '../core/types';
import { relativeTime } from '../i18n/translate';
import { send } from '../shared/protocol';
import { hasAccess, onAccessChange, requestAccess } from '../ui/access';
import { Avatar } from '../ui/Avatar';
import { Callout, MenuButton, Spinner, type MenuItem } from '../ui/controls';
import { errorText } from '../ui/hooks';
import { useI18n } from '../ui/i18n';
import { LogoMark } from '../ui/Logo';
import { TEST_TAB, useSwitcher } from './context';

export function Header() {
  const { t } = useI18n();
  const { data, locked, run, openManager, mode, close } = useSwitcher();
  const hasVault = Boolean(data.state.vault);
  // Known before the click: sidePanel.open() must be called straight from the gesture.
  const [windowId, setWindowId] = useState<number | null>(null);
  useEffect(() => {
    if (mode === 'popup') void chrome.windows.getCurrent().then((window) => setWindowId(window.id ?? null));
  }, [mode]);
  return (
    <header className="popup__header">
      <span className="logo">
        <LogoMark size={22} />
        <span>Swapdeck</span>
      </span>
      <div className="popup__header-actions">
        {hasVault &&
          (locked ? (
            <span className="pill pill--muted" title={t('vault.locked')}>
              <Lock size={11} /> {t('vault.lockedShort')}
            </span>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              onClick={() => void run('vault.lock', {})}
              aria-label={t('vault.lockNow')}
              title={t('vault.lockNow')}
            >
              <LockOpen />
            </button>
          ))}
        {mode === 'popup' && TEST_TAB === null && windowId !== null && (
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            aria-label={t('panel.open')}
            title={t('panel.open')}
            onClick={() => {
              void chrome.sidePanel
                .open({ windowId })
                .then(close)
                .catch(() => undefined);
            }}
          >
            <PanelRight />
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          onClick={() => openManager()}
          aria-label={t('popup.manager')}
          title={t('popup.manager')}
        >
          <Settings />
        </button>
      </div>
    </header>
  );
}

export function Footer({ showKeys = false }: { showKeys?: boolean }) {
  const { t } = useI18n();
  const { openManager } = useSwitcher();
  return (
    <footer className="popup__footer">
      <span className="muted">{showKeys ? t('popup.keys') : t('app.tagline')}</span>
      <button type="button" className="link-button" onClick={() => openManager()}>
        {t('common.manage')}
      </button>
    </footer>
  );
}

/** One saved account: click to switch; chips open its pinned and recent pages. */
export function AccountRow({
  account,
  index,
  active,
  busy,
  disabled,
  menu,
  onSwitch,
  onOpen,
  appName,
}: {
  account: Account;
  index: number;
  active: boolean;
  busy: boolean;
  disabled: boolean;
  menu: MenuItem[];
  onSwitch: () => void;
  onOpen: (url: string) => void;
  /** Shown when accounts of several apps are listed together (search results). */
  appName?: string;
}) {
  const { t, language } = useI18n();
  const shortcuts = [...account.pins.map((pin) => ({ key: pin.id, title: pin.title, url: pin.url, pinned: true }))];
  for (const recent of account.recents) {
    if (shortcuts.length >= 4) break;
    if (!shortcuts.some((item) => item.url === recent.url)) {
      shortcuts.push({ key: recent.key, title: recent.title, url: recent.url, pinned: false });
    }
  }
  const saved = account.capturedAt
    ? t('account.saved', { time: relativeTime(account.capturedAt, language) })
    : t('account.noSession');
  const identity = account.email && account.email !== account.label ? account.email : null;
  const meta = account.capturedAt && identity ? identity : saved;

  return (
    <div className={`account${active ? ' account--active' : ''}${busy ? ' account--busy' : ''}`} role="listitem">
      <button
        type="button"
        className="account__main"
        onClick={onSwitch}
        disabled={disabled || !account.capturedAt}
        title={saved}
        aria-current={active ? 'true' : undefined}
      >
        <Avatar account={account} />
        <span className="account__text">
          <span className="account__name">
            <span className="visually-hidden">{active ? t('account.openPrefix') : t('account.switchPrefix')} </span>
            <span className="truncate">{account.label}</span>
            {account.important && (
              <span className="flag-important">
                <TriangleAlert aria-hidden="true" />
                {t('account.importantTag')}
              </span>
            )}
            {active && <span className="seal">{t('account.inUse')}</span>}
          </span>
          <span className="account__meta truncate">{appName ? `${appName} · ${meta}` : meta}</span>
          {account.note && <span className="account__note truncate">{account.note}</span>}
        </span>
        {busy && (
          <span className="visually-hidden" role="status">
            {t('popup.switching')}
          </span>
        )}
        <span className="account__side" aria-hidden="true">
          {busy ? <Spinner /> : !active && index < 9 ? <kbd>{index + 1}</kbd> : null}
        </span>
      </button>
      <MenuButton label={`${t('common.more')}: ${account.label}`} icon={<Ellipsis />} items={menu} />
      {shortcuts.length > 0 && (
        <div className="account__chips">
          {shortcuts.map((item) => (
            <button
              key={item.key}
              type="button"
              className="chip"
              disabled={disabled}
              title={displayUrl(item.url)}
              onClick={() => onOpen(item.url)}
            >
              {item.pinned && <Pin aria-hidden="true" />}
              <span className="truncate">{item.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The current tab's site when it isn't an app yet: add it in one click. */
export function ThisSite() {
  const { t } = useI18n();
  const { probe, addPreset, addSite, openManager } = useSwitcher();
  const url = parseHttpUrl(probe.url);
  if (!url) {
    return <p className="muted site-note">{t('popup.unsupported')}</p>;
  }
  const preset = findPreset(probe.presetId ?? undefined);
  return (
    <section className="section" aria-labelledby="this-site">
      <h2 className="section__title" id="this-site">
        {t('popup.thisSite')}
      </h2>
      <div className="site-card">
        <Globe className="site-card__icon" aria-hidden="true" />
        <span className="site-card__text truncate">{t('popup.notAdded', { host: url.hostname })}</span>
        {preset ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void addPreset(preset.id)}>
            <Plus /> {t('popup.addPreset', { app: preset.name })}
          </button>
        ) : (
          <span className="site-card__actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void addSite(url.href)}>
              <Plus /> {t('popup.addSite')}
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => openManager(`#/add/custom?url=${encodeURIComponent(url.href)}`)}
            >
              {t('popup.customize')}
            </button>
          </span>
        )}
      </div>
    </section>
  );
}

/** Offers to allow access when the app's sites can't be reached yet. */
export function AccessCheck({ app }: { app: AppDef }) {
  const { t } = useI18n();
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => void hasAccess(app).then(setGranted);
    check();
    return onAccessChange(check);
  }, [app]);
  if (granted !== false) return null;
  return (
    <Callout
      tone="warning"
      title={t('status.noAccess', { domains: app.domains.join(', ') })}
      actions={
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => void requestAccess(app).then(setGranted)}
        >
          {t('common.allow')}
        </button>
      }
    >
      {t('status.noAccessHint')}
    </Callout>
  );
}

export function UnlockForm() {
  const { t } = useI18n();
  const { unlocked } = useSwitcher();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  return (
    <form
      className="unlock"
      onSubmit={async (event) => {
        event.preventDefault();
        setWorking(true);
        const result = await send('vault.unlock', { passphrase });
        setWorking(false);
        if (result.ok) unlocked();
        else setError(result.error === 'BAD_PASSPHRASE' ? t('vault.wrong') : errorText(t, result));
      }}
    >
      <div className="unlock__head">
        <Lock aria-hidden="true" />
        <div>
          <p className="callout__title">{t('vault.locked')}</p>
          <p className="field__hint">{t('vault.lockedHint')}</p>
        </div>
      </div>
      <div className="unlock__row">
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={passphrase}
          aria-label={t('vault.passphrase')}
          placeholder={t('vault.passphrase')}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setPassphrase(event.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="btn btn--primary" disabled={!passphrase || working}>
          {working ? <Spinner /> : <LockOpen />} {t('common.unlock')}
        </button>
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
