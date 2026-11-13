import { useEffect, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PRIORITY_LABEL, STATUS_LABEL, type DeckColor, type Status } from '../types';
import { t } from '../i18n';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ---------- Icons ----------
const PATHS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h4.5v-5.5h4v5.5h4.5V10',
  cards: 'M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 18V9A1.5 1.5 0 0 1 7 7.5ZM8.5 4.5h8',
  list: 'M8.5 6.5h11M8.5 12h11M8.5 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
  chart: 'M5 19.5V11M10 19.5V5M15 19.5v-6M20 19.5V8.5',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z',
  plus: 'M12 5v14M5 12h14',
  search: 'M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6ZM20 20l-4.3-4.3',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  back: 'M14.5 5.5 8 12l6.5 6.5',
  right: 'M9.5 5.5 16 12l-6.5 6.5',
  filter: 'M4 6.5h16M7 12h10M10 17.5h4',
  trash: 'M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7',
  edit: 'M4.5 19.5l1-4L16 5a2 2 0 0 1 3 3L8.5 18.5l-4 1Z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  alert: 'M12 4 2.8 19.5h18.4L12 4Zm0 6v4.5m0 2.5v.01',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 19.5h14',
  upload: 'M12 15.5v-11m0 0-4 4m4-4 4 4M5 19.5h14',
  sparkle: 'M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8L12 4Z',
  book: 'M5 5.5h5.5A1.5 1.5 0 0 1 12 7v12a1.5 1.5 0 0 0-1.5-1.5H5v-12Zm14 0h-5.5A1.5 1.5 0 0 0 12 7v12a1.5 1.5 0 0 1 1.5-1.5H19v-12Z',
  target: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-4a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-4h.01',
  flame: 'M12 3.5c.5 3.5 5 5.500 5 10a5 5 0 0 1-10 0c0-1.800.8-3 1.800-4 .2 1.500 1 2.300 1.700 2.500C10.500 9 10.500 6 12 3.500Z',
  eye: 'M2.500 12s3.500-6.500 9.500-6.500S21.500 12 21.500 12s-3.500 6.500-9.500 6.500S2.500 12 2.500 12Zm9.500 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  image: 'M4.500 5.500h15v13h-15zM4.500 15l4-4 3.500 3.500 2.500-2.500 5 5M15 9.500h.01',
  layers: 'M12 4 3.500 8.500 12 13l8.500-4.500L12 4ZM3.500 12.500 12 17l8.500-4.500M3.500 16.500 12 21l8.500-4.500',
  keyboard: 'M3.500 7h17v10h-17zM7 10.500h.01M10.500 10.500h.01M14 10.500h.01M17 10.500h.01M7.500 14h9',
  palette: 'M12 3.500a8.500 8.500 0 1 0 0 17c1.200 0 1.800-.8 1.800-1.700 0-1.300-1.300-1.600-1.300-2.900 0-1 .8-1.700 1.900-1.700h2.100a3.500 3.500 0 0 0 3.500-3.500C20 6.500 16.500 3.500 12 3.500ZM7.500 12h.01M9 8h.01M14 7.500h.01',
  table: 'M4.500 5.500h15v13h-15zM4.500 10h15M4.500 14.500h15M10 5.500v13',
  'chevron-up': 'M6 14.500 12 8.500l6 6',
  'chevron-down': 'M6 9.500l6 6 6-6',
};
export function Icon({ name, size = 22, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}

// ---------- Building blocks ----------
export function Page({ title, back, actions, children, subtitle }: { title: string; subtitle?: ReactNode; back?: boolean | string; actions?: ReactNode; children: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="mx-auto min-h-full max-w-xl px-4 nav-space">
      <header className="safe-top sticky top-0 z-20 -mx-4 mb-2 bg-bg/90 px-4 pb-2 backdrop-blur">
        <div className="flex min-h-[2.75rem] items-center gap-1">
          {back && (
            <button aria-label={t("Zurück")} className="-ml-2 grid h-11 w-11 place-items-center rounded-full text-accent" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}>
              <Icon name="back" />
            </button>
          )}
          <h1 className={cx('flex-1 truncate font-bold tracking-tight', back ? 'text-xl' : 'text-[1.9rem]')}>{title}</h1>
          <div className="flex items-center gap-1">{actions}</div>
        </div>
        {subtitle && <div className="text-sm text-muted">{subtitle}</div>}
      </header>
      {children}
    </div>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-card bg-surface p-4 shadow-card', className)} {...rest}>{children}</div>;
}

type BtnVariant = 'primary' | 'soft' | 'ghost' | 'danger' | 'ok' | 'bad';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent text-on-accent shadow-[0_8px_20px_-10px_rgb(var(--accent)/0.8)]',
  soft: 'bg-accent-soft text-accent',
  ghost: 'text-accent',
  danger: 'bg-bad-soft text-bad',
  ok: 'bg-ok text-white dark:text-[#062a1d]',
  bad: 'bg-bad text-white dark:text-[#3a0a10]',
};
export function Button({ variant = 'primary', size = 'md', className, children, ...rest }: { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-[1.1rem] font-semibold transition duration-150 active:scale-[0.97] disabled:opacity-40',
        size === 'sm' ? 'min-h-[2.5rem] px-3.5 text-sm' : size === 'lg' ? 'min-h-[3.75rem] px-6 text-lg' : 'min-h-[3rem] px-5',
        BTN[variant], className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className, ...rest }: { icon: string; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('grid h-11 w-11 place-items-center rounded-full text-accent active:bg-sunken', className)} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; raw?: boolean }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-2xl bg-sunken p-1">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx('min-h-[2.5rem] flex-1 rounded-xl px-2 text-sm font-semibold transition', value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
          {o.raw ? o.label : t(o.label)}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, children, onClick, className }: { active?: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cx('min-h-[2.5rem] whitespace-nowrap rounded-full border px-3.5 text-sm font-medium', active ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-ink', className)}>
      {children}
    </button>
  );
}

/** Five-star priority picker. Display-only without onChange. */
export function Stars({ value, onChange, size = 28 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  const star = (i: number) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={i <= value ? 'text-star' : 'text-line'}>
      <path fill="currentColor" d="M12 3.2l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.400-3-5.400 3 1.200-6L3.300 9.500l6.100-.7L12 3.200Z" />
    </svg>
  );
  if (!onChange) return <span className="inline-flex" role="img" aria-label={t('Priorität {n} von 5: {label}', { n: value, label: t(PRIORITY_LABEL[value]) })}>{[1, 2, 3, 4, 5].map((i) => <span key={i}>{star(i)}</span>)}</span>;
  return (
    <div role="radiogroup" aria-label={t("Priorität")} className="flex items-center">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={t('Priorität {n}: {label}', { n: i, label: t(PRIORITY_LABEL[i]) })} onClick={() => onChange(i)} className="grid h-11 w-10 place-items-center">
          {star(i)}
        </button>
      ))}
      <span className="ml-2 text-sm text-muted">{t(PRIORITY_LABEL[value])}</span>
    </div>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  neu: 'var(--c-neu)', unsicher: 'var(--c-bad)', bearbeitung: 'var(--c-bearbeitung)', gut: 'var(--c-gut)', sicher: 'var(--c-sicher)',
};
export const statusColor = (s: Status) => STATUS_STYLE[s];
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_STYLE[status] }} />
      {t(STATUS_LABEL[status])}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
export const inputCls = 'w-full rounded-2xl border border-line bg-surface px-4 py-3 text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15';

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: color ?? 'rgb(var(--accent))' }} />
    </div>
  );
}

export function Ring({ value, size = 112, children }: { value: number; size?: number; children?: ReactNode }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--sunken))" strokeWidth={10} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--accent))" strokeWidth={10} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset .4s' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function EmptyState({ icon = 'cards', title, text, children }: { icon?: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-sunken text-accent"><Icon name={icon} size={30} /></div>
      <h2 className="text-lg font-bold">{title}</h2>
      {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
      {children && <div className="mt-5 flex w-full max-w-xs flex-col gap-2">{children}</div>}
    </div>
  );
}

// ---------- Sheet & Dialog ----------
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label={t("Schließen")} className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="sheet-panel relative flex max-h-[88vh] w-full max-w-xl flex-col rounded-t-[1.75rem] bg-bg shadow-card">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <IconButton icon="x" label={t("Schließen")} onClick={onClose} className="-mr-2 text-muted" />
        </div>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="safe-bottom border-t border-line px-5 pt-3">{footer}</div>}
        {!footer && <div className="safe-bottom" />}
      </div>
    </div>
  );
}

export function Confirm({ open, title, text, confirmLabel, danger, onConfirm, onCancel, children }: { open: boolean; title: string; text?: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void; children?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6" role="alertdialog" aria-modal="true" aria-label={title}>
      <button aria-label={t("Abbrechen")} className="absolute inset-0 bg-black/45" onClick={onCancel} />
      <div className="sheet-panel relative w-full max-w-sm rounded-card bg-surface p-5 shadow-card">
        <h2 className="text-lg font-bold">{title}</h2>
        {text && <div className="mt-2 text-sm text-muted">{text}</div>}
        {children}
        <div className="mt-5 flex flex-col gap-2">
          <Button variant={danger ? 'bad' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
          <Button variant="soft" onClick={onCancel}>{t('Abbrechen')}</Button>
        </div>
      </div>
    </div>
  );
}

// ---------- Toast ----------
let toastMsg: { id: number; text: string } | null = null;
const listeners = new Set<() => void>();
export function toast(text: string) {
  const id = Date.now();
  toastMsg = { id, text };
  listeners.forEach((l) => l());
  setTimeout(() => { if (toastMsg?.id === id) { toastMsg = null; listeners.forEach((l) => l()); } }, 2600);
}
export function Toaster() {
  const msg = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => toastMsg);
  if (!msg) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ bottom: 'calc(5.25rem + env(safe-area-inset-bottom))' }}>
      <div className="sheet-panel rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-bg shadow-card">{msg.text}</div>
    </div>
  );
}

/**
 * Persian text with the correct direction and language.
 * Size/layout classes go on the wrapper so the em-based Persian font scaling is preserved.
 */
export function Fa({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={className}><bdi lang="fa" dir="rtl" className="fa">{children}</bdi></span>;
}

export function Stepper({ value, onChange, min, max, step = 1, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label: string }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" aria-label={t('{label} verringern', { label })} className="grid h-11 w-11 place-items-center rounded-full bg-sunken text-xl font-semibold disabled:opacity-40" disabled={value <= min} onClick={() => set(value - step)}>−</button>
      <input aria-label={label} inputMode="numeric" className="h-11 w-16 rounded-xl border border-line bg-surface text-center font-semibold" value={value}
        onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); set(Number.isFinite(n) ? n : min); }} />
      <button type="button" aria-label={t('{label} erhöhen', { label })} className="grid h-11 w-11 place-items-center rounded-full bg-sunken text-xl font-semibold disabled:opacity-40" disabled={value >= max} onClick={() => set(value + step)}>+</button>
    </div>
  );
}

/** Small coloured badge for a deck. */
export function DeckDot({ color, size = 12 }: { color: DeckColor; size?: number }) {
  return <span aria-hidden="true" className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: `rgb(var(--deck-${color}-ink))` }} />;
}
export const deckTint = (color: DeckColor) => ({ background: `rgb(var(--deck-${color}))`, color: `rgb(var(--deck-${color}-ink))` });
