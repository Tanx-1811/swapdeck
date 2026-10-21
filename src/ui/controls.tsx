import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from './i18n';

// --- Switch ------------------------------------------------------------------

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  // Flip at once; the stored setting catches up a moment later.
  const [shown, setShown] = useState({ checked, from: checked });
  if (shown.from !== checked) setShown({ checked, from: checked });
  return (
    <span className="switch">
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={shown.checked}
        disabled={disabled}
        onChange={(event) => {
          setShown({ checked: event.target.checked, from: checked });
          onChange(event.target.checked);
        }}
      />
      <span className="switch__track" aria-hidden="true" />
    </span>
  );
}

export function ToggleRow({
  title,
  hint,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="toggle-row">
      <div className="toggle-row__text">
        <label className="toggle-row__title" htmlFor={id}>
          {title}
        </label>
        {hint && <p className="field__hint">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

// --- Field -------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="field__hint">{hint}</p>
      )}
    </div>
  );
}

// --- Callout -----------------------------------------------------------------

const CALLOUT_ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert, brand: Info };

export function Callout({
  tone = 'info',
  title,
  children,
  actions,
  icon,
}: {
  tone?: keyof typeof CALLOUT_ICONS;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  const Icon = CALLOUT_ICONS[tone];
  return (
    <div className={`callout callout--${tone}`} role={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}>
      {icon ?? <Icon aria-hidden="true" />}
      <div className="callout__body">
        {title && <p className="callout__title">{title}</p>}
        {children && <div className="callout__text">{children}</div>}
        {actions && <div className="callout__actions">{actions}</div>}
      </div>
    </div>
  );
}

// --- Dialog ------------------------------------------------------------------

/** A modal built on <dialog>: focus is trapped, Escape closes it. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      style={wide ? { width: 'min(560px, calc(100vw - 24px))' } : undefined}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog__form">
          <div className="dialog__header">
            <h2 className="dialog__title" id={titleId}>
              {title}
            </h2>
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <X />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
};

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

/** `const confirm = useConfirm(); if (await confirm({...})) …` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const { t } = useI18n();
  const ask = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setRequest({ ...options, resolve })),
    [],
  );
  const finish = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  return (
    <ConfirmContext value={ask}>
      {children}
      <Dialog open={Boolean(request)} onClose={() => finish(false)} title={request?.title ?? ''}>
        {request?.body && <p className="dialog__text">{request.body}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={() => finish(false)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`btn ${request?.danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={() => finish(true)}
            autoFocus
          >
            {request?.confirmLabel}
          </button>
        </div>
      </Dialog>
    </ConfirmContext>
  );
}

export function useConfirm() {
  return use(ConfirmContext);
}

// --- Menu --------------------------------------------------------------------

export type MenuItem =
  | { kind?: 'item'; label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | { kind: 'separator' };

/** A dropdown menu anchored to its trigger button. Arrow keys move, Escape closes. */
export function MenuButton({
  label,
  icon,
  items,
  className = 'btn btn--ghost btn--icon btn--sm',
  children,
}: {
  label: string;
  icon?: ReactNode;
  items: MenuItem[];
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 8));
    const below = anchor.bottom + 4;
    const top = below + menu.height > window.innerHeight - 8 ? Math.max(8, anchor.top - menu.height - 4) : below;
    setPosition({ top, left });
    menuRef.current.querySelector<HTMLButtonElement>('.menu__item:not(:disabled)')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('.menu__item:not(:disabled)') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={children ? undefined : label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {icon}
        {children}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="menu"
          role="menu"
          aria-label={label}
          style={{ top: position.top, left: position.left }}
          onKeyDown={onKeyDown}
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((item, index) =>
            item.kind === 'separator' ? (
              <div key={`sep-${index}`} className="menu__separator" role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}

// --- Toasts ------------------------------------------------------------------

type ToastTone = 'success' | 'error' | 'info';
type ToastItem = { id: number; tone: ToastTone; text: string };
type Notify = (text: string, tone?: ToastTone) => void;

const ToastContext = createContext<Notify>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const { t } = useI18n();
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const notify = useCallback<Notify>(
    (text, tone = 'success') => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-2), { id, tone, text }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4200);
    },
    [dismiss],
  );
  const icons = useMemo(() => ({ success: CircleCheck, error: CircleAlert, info: Info }), []);
  return (
    <ToastContext value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = icons[toast.tone];
          return (
            <div key={toast.id} className={`toast toast--${toast.tone}`}>
              <Icon aria-hidden="true" />
              <span className="toast__text">{toast.text}</span>
              <button type="button" onClick={() => dismiss(toast.id)} aria-label={t('common.close')}>
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}

export function useToast(): Notify {
  return use(ToastContext);
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} />;
}
