import { Check, Globe, ListChecks, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  findPreset,
  isBlockedDomain,
  PRESET_CATEGORIES,
  searchPresets,
  type Preset,
  type PresetCategory,
} from '../../core/presets';
import { customAppFromUrl, presetToInput } from '../../shared/apps';
import type { AppInput } from '../../shared/protocol';
import { requestAccess } from '../../ui/access';
import { AppIcon } from '../../ui/Avatar';
import { Callout, Field, Spinner, useToast } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { useManager } from '../context';
import { Card, PageHeader } from '../Options';
import { navigate } from '../router';
import { AppForm } from './AppForm';

export function AddApp() {
  const { t } = useI18n();
  const { data, run, pending } = useManager();
  const notify = useToast();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PresetCategory | 'all'>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const added = new Map(data.state.apps.filter((app) => app.presetId).map((app) => [app.presetId!, app.id]));
  const results = useMemo(
    () => searchPresets(query).filter((preset) => category === 'all' || preset.category === category),
    [query, category],
  );

  const add = async (preset: Preset) => {
    const existing = added.get(preset.id);
    if (existing) {
      navigate(`#/apps/${existing}`);
      return;
    }
    if (!(await requestAccess(preset))) {
      notify(t('add.denied'), 'error');
      return;
    }
    const app = await run('app.add', { app: presetToInput(preset) }, `add:${preset.id}`);
    if (app) {
      notify(t('add.addedToast', { app: app.name }));
      navigate(`#/apps/${app.id}`);
    }
  };

  const toggle = (preset: Preset) => {
    if (added.has(preset.id)) return;
    setSelected((list) => (list.includes(preset.id) ? list.filter((id) => id !== preset.id) : [...list, preset.id]));
  };

  /** One permission prompt for every chosen site, then one step to add them all. */
  const addSelected = async () => {
    const presets = selected.map(findPreset).filter((preset): preset is Preset => Boolean(preset));
    if (!presets.length) return;
    if (!(await requestAccess({ domains: presets.flatMap((preset) => preset.domains) }))) {
      notify(t('add.denied'), 'error');
      return;
    }
    const apps = await run('app.addMany', { apps: presets.map(presetToInput) }, 'add:many');
    if (apps) {
      notify(t('add.addedMany', { n: apps.length }));
      setSelected([]);
      setSelecting(false);
      navigate('#/apps');
    }
  };

  return (
    <div className="stack">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="#/apps">{t('nav.apps')}</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{t('add.title')}</span>
      </nav>
      <PageHeader
        title={t('add.title')}
        lead={t('add.lead')}
        actions={
          <button
            type="button"
            className={`btn${selecting ? ' btn--soft' : ''}`}
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((value) => !value);
              setSelected([]);
            }}
          >
            <ListChecks /> {t('add.selectMany')}
          </button>
        }
      />
      <div className="gallery-toolbar">
        <div className="input-with-icon gallery-toolbar__search">
          <Search aria-hidden="true" />
          <input
            className="input"
            type="search"
            value={query}
            autoFocus
            placeholder={t('add.search')}
            aria-label={t('add.search')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="segmented segmented--wrap" role="group" aria-label={t('add.categories')}>
          <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
            {t('add.all')}
          </button>
          {PRESET_CATEGORIES.map((item) => (
            <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>
              {t(`add.cat.${item}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="gallery">
        {results.map((preset) => {
          const isAdded = added.has(preset.id);
          const isSelected = selected.includes(preset.id);
          return (
            <button
              key={preset.id}
              type="button"
              className={`preset${isAdded ? ' preset--added' : ''}${isSelected ? ' preset--selected' : ''}`}
              aria-pressed={selecting ? isSelected : undefined}
              disabled={selecting && isAdded}
              onClick={() => (selecting ? toggle(preset) : void add(preset))}
            >
              <AppIcon app={preset} size="lg" favicon={false} />
              <span className="preset__text">
                <span className="preset__name">
                  {preset.name}
                  {preset.id === 'supabase' && <span className="pill pill--brand">{t('add.recommended')}</span>}
                </span>
                <span className="muted truncate">{preset.domains.join(', ')}</span>
                {preset.nativeSwitcher && <span className="preset__note">{t('add.native')}</span>}
              </span>
              <span className="preset__action" aria-hidden="true">
                {isAdded || isSelected ? <Check /> : <Plus />}
              </span>
              <span className="visually-hidden">{isAdded ? t('add.alreadyAdded') : t('common.add')}</span>
            </button>
          );
        })}
        {!selecting && (
          <a className="preset preset--custom" href="#/add/custom">
            <span className="app-icon app-icon--lg app-icon--custom" aria-hidden="true">
              <Globe />
            </span>
            <span className="preset__text">
              <span className="preset__name">{t('add.custom')}</span>
              <span className="muted">{t('add.customLead')}</span>
            </span>
            <span className="preset__action" aria-hidden="true">
              <Plus />
            </span>
          </a>
        )}
      </div>
      {results.length === 0 && <p className="muted">{t('add.noResults', { query })}</p>}
      {selecting && (
        <div className="selection-bar" role="region" aria-label={t('add.selectMany')}>
          <span>{t('add.selectedCount', { n: selected.length })}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!selected.length}
            onClick={() => setSelected([])}
          >
            {t('add.clearSelection')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!selected.length || pending === 'add:many'}
            onClick={() => void addSelected()}
          >
            {pending === 'add:many' ? <Spinner /> : <Plus />} {t('add.addSelected', { n: selected.length })}
          </button>
        </div>
      )}
    </div>
  );
}

export function CustomApp({ initialUrl }: { initialUrl: string }) {
  const { t } = useI18n();
  const { run, pending } = useManager();
  const notify = useToast();
  const [url, setUrl] = useState(initialUrl);
  const [draft, setDraft] = useState<AppInput | null>(() => (initialUrl ? customAppFromUrl(initialUrl) : null));
  const urlError = url && !customAppFromUrl(url) ? t('form.invalidUrl') : null;

  return (
    <div className="stack">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="#/apps">{t('nav.apps')}</a>
        <span aria-hidden="true">/</span>
        <a href="#/add">{t('add.title')}</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{t('add.customTitle')}</span>
      </nav>
      <PageHeader title={t('add.customTitle')} lead={t('add.customLead')} />
      <Card>
        <form
          className="url-step"
          onSubmit={(event) => {
            event.preventDefault();
            setDraft(customAppFromUrl(url));
          }}
        >
          <Field label={t('add.customUrl')} hint={t('add.customUrlHint')} error={urlError} htmlFor="custom-url">
            <div className="row">
              <input
                id="custom-url"
                className="input"
                type="url"
                value={url}
                autoFocus={!initialUrl}
                placeholder="https://app.example.com"
                aria-invalid={Boolean(urlError)}
                onChange={(event) => setUrl(event.target.value)}
              />
              <button type="submit" className="btn btn--primary" disabled={!url || Boolean(urlError)}>
                {t('common.add')}
              </button>
            </div>
          </Field>
        </form>
      </Card>
      {draft && (
        <Card>
          <div className="draft-head">
            <AppIcon app={draft} size="lg" favicon={false} />
            <Callout tone="info">{t('onboarding.allowBody', { domains: draft.domains.join(', ') })}</Callout>
          </div>
          <AppForm
            key={JSON.stringify(draft)}
            initial={draft}
            submitLabel={t('common.add')}
            busy={pending === 'app.add'}
            onCancel={() => navigate('#/add')}
            onSubmit={async (input) => {
              const blocked = input.domains.find(isBlockedDomain);
              if (blocked) {
                notify(t('error.BLOCKED_DOMAIN', { domain: blocked }), 'error');
                return;
              }
              if (!(await requestAccess(input))) {
                notify(t('add.denied'), 'error');
                return;
              }
              const app = await run('app.add', { app: input });
              if (app) {
                notify(t('add.addedToast', { app: app.name }));
                navigate(`#/apps/${app.id}`);
              }
            }}
          />
        </Card>
      )}
    </div>
  );
}
