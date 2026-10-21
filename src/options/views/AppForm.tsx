import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { normalizeDomain, parseHttpUrl } from '../../core/domains';
import type { DetectorSpec } from '../../core/types';
import type { AppInput } from '../../shared/protocol';
import { ColorPicker } from '../../ui/ColorPicker';
import { Field, Switch } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';

type DetectorKind = DetectorSpec['kind'];

function splitList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** The settings of an app: where its sign-in lives and how the account is recognised. */
export function AppForm({
  initial,
  submitLabel,
  onSubmit,
  busy,
  onCancel,
}: {
  initial: AppInput;
  submitLabel: string;
  onSubmit: (input: AppInput) => void;
  busy?: boolean;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const ids = useId();
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [domains, setDomains] = useState(initial.domains);
  const [domainDraft, setDomainDraft] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);
  const [origin, setOrigin] = useState(initial.origin);
  const [homeUrl, setHomeUrl] = useState(initial.homeUrl);
  const [loginUrl, setLoginUrl] = useState(initial.loginUrl ?? '');
  const [stagingPath, setStagingPath] = useState(initial.stagingPath);
  const [storage, setStorage] = useState(initial.storage);
  const [detectorKind, setDetectorKind] = useState<DetectorKind>(initial.detector.kind);
  const [detectorNames, setDetectorNames] = useState(
    initial.detector.kind === 'localStorage'
      ? initial.detector.keys.join(', ')
      : initial.detector.kind === 'cookie'
        ? initial.detector.names.join(', ')
        : '',
  );
  const [cookieFormat, setCookieFormat] = useState(
    initial.detector.kind === 'cookie' ? initial.detector.format : 'plain',
  );
  const [recentPattern, setRecentPattern] = useState(initial.recentPattern ?? '');
  const [titleSuffix, setTitleSuffix] = useState(initial.titleSuffix ?? '');
  const [advanced, setAdvanced] = useState(false);

  const addDomain = (raw: string) => {
    const value = normalizeDomain(raw);
    if (!raw.trim()) return true;
    if (!value) {
      setDomainError(t('form.invalidDomain', { value: raw.trim() }));
      return false;
    }
    setDomains((list) => (list.includes(value) ? list : [...list, value]));
    setDomainDraft('');
    setDomainError(null);
    return true;
  };

  const originError = parseHttpUrl(origin) ? null : t('form.invalidUrl');
  const homeError = parseHttpUrl(homeUrl) ? null : t('form.invalidUrl');
  const loginError = loginUrl && !parseHttpUrl(loginUrl) ? t('form.invalidUrl') : null;
  let patternError: string | null = null;
  if (recentPattern) {
    try {
      new RegExp(recentPattern);
    } catch {
      patternError = t('error.INVALID');
    }
  }
  const invalid =
    !name.trim() || domains.length === 0 || Boolean(originError || homeError || loginError || patternError);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (domainDraft && !addDomain(domainDraft)) return;
    if (invalid) return;
    const names = splitList(detectorNames);
    let detector: DetectorSpec = { kind: 'auto' };
    if (detectorKind === 'none') detector = { kind: 'none' };
    else if (detectorKind === 'localStorage' && names.length) {
      detector =
        initial.detector.kind === 'localStorage' && initial.detector.fields
          ? { kind: 'localStorage', keys: names, fields: initial.detector.fields }
          : { kind: 'localStorage', keys: names };
    } else if (detectorKind === 'cookie' && names.length) {
      detector = { kind: 'cookie', names, format: cookieFormat };
    }
    const input: AppInput = {
      name: name.trim(),
      color,
      domains: domainDraft ? [...new Set([...domains, normalizeDomain(domainDraft)!])] : domains,
      origin: new URL(origin).origin,
      homeUrl: homeUrl.trim(),
      stagingPath: stagingPath.trim().startsWith('/') ? stagingPath.trim() : `/${stagingPath.trim()}`,
      storage,
      detector,
    };
    if (initial.presetId) input.presetId = initial.presetId;
    input.loginUrl = loginUrl.trim();
    input.recentPattern = recentPattern.trim();
    input.titleSuffix = titleSuffix;
    onSubmit(input);
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="form__grid">
        <Field label={t('form.name')} htmlFor={`${ids}-name`}>
          <input
            id={`${ids}-name`}
            className="input"
            value={name}
            maxLength={80}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <ColorPicker label={t('form.color')} value={color} onChange={setColor} keep={initial.color} limit={10} />
      </div>

      <Field label={t('form.domains')} hint={t('form.domainsHint')} error={domainError} htmlFor={`${ids}-domain`}>
        <div className="tags-input">
          {domains.map((domain) => (
            <span key={domain} className="tag">
              {domain}
              <button
                type="button"
                aria-label={`${t('common.remove')} ${domain}`}
                onClick={() => setDomains((list) => list.filter((item) => item !== domain))}
              >
                <X />
              </button>
            </span>
          ))}
          <input
            id={`${ids}-domain`}
            value={domainDraft}
            placeholder={domains.length ? '' : t('form.domainPlaceholder')}
            aria-invalid={Boolean(domainError)}
            onChange={(event) => {
              setDomainDraft(event.target.value);
              setDomainError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                addDomain(domainDraft);
              } else if (event.key === 'Backspace' && !domainDraft && domains.length) {
                setDomains((list) => list.slice(0, -1));
              }
            }}
            onBlur={() => addDomain(domainDraft)}
          />
        </div>
      </Field>

      <div className="form__grid">
        <Field label={t('form.origin')} hint={t('form.originHint')} error={originError} htmlFor={`${ids}-origin`}>
          <input
            id={`${ids}-origin`}
            className="input"
            type="url"
            value={origin}
            aria-invalid={Boolean(originError)}
            onChange={(event) => setOrigin(event.target.value.trim())}
          />
        </Field>
        <Field label={t('form.homeUrl')} error={homeError} htmlFor={`${ids}-home`}>
          <input
            id={`${ids}-home`}
            className="input"
            type="url"
            value={homeUrl}
            aria-invalid={Boolean(homeError)}
            onChange={(event) => setHomeUrl(event.target.value)}
          />
        </Field>
      </div>

      <fieldset className="fieldset">
        <legend className="field__label">{t('form.parts')}</legend>
        <div className="parts">
          {(
            [
              ['cookies', t('form.cookies')],
              ['localStorage', t('form.localStorage')],
              ['sessionStorage', t('form.sessionStorage')],
              ['indexedDB', t('form.indexedDB')],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="part">
              <Switch
                checked={storage[key]}
                label={label}
                onChange={(checked) => setStorage((value) => ({ ...value, [key]: checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {storage.indexedDB && <p className="field__hint">{t('form.indexedDBHint')}</p>}
      </fieldset>

      <Field label={t('form.detector')} hint={t('form.detectorHint')} htmlFor={`${ids}-detector`}>
        <select
          id={`${ids}-detector`}
          className="select"
          value={detectorKind}
          onChange={(event) => setDetectorKind(event.target.value as DetectorKind)}
        >
          <option value="auto">{t('form.detectorAuto')}</option>
          <option value="localStorage">{t('form.detectorLocal')}</option>
          <option value="cookie">{t('form.detectorCookie')}</option>
          <option value="none">{t('form.detectorNone')}</option>
        </select>
      </Field>
      {(detectorKind === 'localStorage' || detectorKind === 'cookie') && (
        <div className="form__grid">
          <Field
            label={detectorKind === 'cookie' ? t('form.cookieNames') : t('form.detectorKeys')}
            htmlFor={`${ids}-names`}
          >
            <input
              id={`${ids}-names`}
              className="input mono"
              value={detectorNames}
              placeholder={detectorKind === 'cookie' ? 'user_session' : 'sb-*-auth-token'}
              onChange={(event) => setDetectorNames(event.target.value)}
            />
          </Field>
          {detectorKind === 'cookie' && (
            <Field label={t('form.cookieFormat')} htmlFor={`${ids}-format`}>
              <select
                id={`${ids}-format`}
                className="select"
                value={cookieFormat}
                onChange={(event) => setCookieFormat(event.target.value as typeof cookieFormat)}
              >
                <option value="plain">{t('form.formatPlain')}</option>
                <option value="json">{t('form.formatJson')}</option>
                <option value="jwt">{t('form.formatJwt')}</option>
                <option value="supabase-ssr">{t('form.formatSupabase')}</option>
              </select>
            </Field>
          )}
        </div>
      )}

      <button
        type="button"
        className="disclosure"
        aria-expanded={advanced}
        onClick={() => setAdvanced((value) => !value)}
      >
        {t('common.advanced')}
      </button>
      {advanced && (
        <div className="stack stack--tight">
          <div className="form__grid">
            <Field label={t('form.loginUrl')} error={loginError} hint={t('common.optional')} htmlFor={`${ids}-login`}>
              <input
                id={`${ids}-login`}
                className="input"
                type="url"
                value={loginUrl}
                aria-invalid={Boolean(loginError)}
                onChange={(event) => setLoginUrl(event.target.value)}
              />
            </Field>
            <Field label={t('form.stagingPath')} hint={t('form.stagingHint')} htmlFor={`${ids}-staging`}>
              <input
                id={`${ids}-staging`}
                className="input mono"
                value={stagingPath}
                onChange={(event) => setStagingPath(event.target.value)}
              />
            </Field>
          </div>
          <div className="form__grid">
            <Field
              label={t('form.recentPattern')}
              hint={t('form.recentHint')}
              error={patternError}
              htmlFor={`${ids}-recent`}
            >
              <input
                id={`${ids}-recent`}
                className="input mono"
                value={recentPattern}
                placeholder="^/project/([a-z0-9]+)"
                onChange={(event) => setRecentPattern(event.target.value)}
              />
            </Field>
            <Field label={t('form.titleSuffix')} hint={t('common.optional')} htmlFor={`${ids}-suffix`}>
              <input
                id={`${ids}-suffix`}
                className="input"
                value={titleSuffix}
                placeholder=" | Example"
                onChange={(event) => setTitleSuffix(event.target.value)}
              />
            </Field>
          </div>
        </div>
      )}

      <div className="form__actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
        <button type="submit" className="btn btn--primary" disabled={busy || invalid}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
