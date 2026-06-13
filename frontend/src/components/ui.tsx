/**
 * Primitivas UI del AgoraOps Design System: toasts, botones, campos,
 * modales, confirmación, tabla y estados vacíos. Tema claro estilo
 * Polaris Food (tokens en index.css).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2, AlertCircle, X, Inbox, Eye, EyeOff, UtensilsCrossed,
} from "lucide-react";

/* ───────────────────────── Toasts ───────────────────────── */

interface Toast {
  id: number;
  type: "success" | "error" | "warning";
  message: string;
}

const ToastContext = createContext<(type: Toast["type"], message: string) => void>(
  () => {},
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((type: Toast["type"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`glass fade-in-up flex max-w-sm items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-2xl ${
              t.type === "success" ? "border-accent-emerald/40"
                : t.type === "warning" ? "border-accent-amber/40" : "border-accent-rose/40"
            }`}
          >
            {t.type === "success" ? (
              <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-accent-emerald" />
            ) : t.type === "warning" ? (
              <AlertCircle size={17} className="mt-0.5 shrink-0 text-accent-amber" />
            ) : (
              <AlertCircle size={17} className="mt-0.5 shrink-0 text-accent-rose" />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* ───────────────────────── Botones ───────────────────────── */

const BTN_VARIANTS = {
  primary:
    "bg-gradient-to-br from-accent-blue to-accent-blue-hover text-white shadow-[0_0_16px_var(--accent-glow)] hover:brightness-110",
  success:
    "bg-gradient-to-br from-accent-emerald to-emerald-700 text-white hover:brightness-110",
  danger:
    "bg-accent-rose/15 text-accent-rose border border-accent-rose/40 hover:bg-accent-rose/25",
  dark:
    "bg-[hsl(222_25%_15%)] text-white hover:brightness-150",
  ghost:
    "border border-border-medium text-text-secondary hover:text-text-primary hover:border-border-subtle hover:bg-bg-tertiary",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BTN_VARIANTS;
  size?: "sm" | "md";
}) {
  return (
    <button
      {...props}
      className={`rounded-lg font-medium transition active:scale-95 disabled:pointer-events-none disabled:opacity-50 ${
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm"
      } ${BTN_VARIANTS[variant]} ${className}`}
    />
  );
}

/* ───────────────────────── Campos ───────────────────────── */

const FIELD_CLS =
  "w-full rounded-lg border border-border-subtle bg-bg-tertiary px-3 py-2.5 text-sm outline-none transition focus:border-accent-blue focus:shadow-[0_0_16px_var(--accent-glow)]";

/** Fila de formulario tipo página (estilo Polaris "Agregar nueva …"):
 * etiqueta a la izquierda con * de obligatorio, control a la derecha. */
export function FormRow({ label, required, children }: {
  label: string; required?: boolean; children: ReactNode;
}) {
  return (
    <label className="grid items-center gap-2 sm:grid-cols-[220px_1fr]">
      <span className="text-sm font-semibold">
        {label} {required && <span className="text-accent-rose">*</span>}
      </span>
      {children}
    </label>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">
        {label}
      </span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD_CLS} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${FIELD_CLS} ${props.className ?? ""}`}>
      {props.children}
    </select>
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD_CLS} ${props.className ?? ""}`} />;
}

/** Campo de contraseña con botón 👁 para mostrar/ocultar el valor. */
export function PasswordInput(
  props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">,
) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={show ? "text" : "password"}
        className={`${FIELD_CLS} pr-10 ${props.className ?? ""}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted transition hover:text-text-primary"
      >
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

/* ─────────── Moneda configurable por establecimiento ───────────
   El símbolo y los decimales se definen por establecimiento (Super Admin,
   nacional/internacional) y se aplican en TODA la app: configureCurrency()
   se llama al cargar el branding (Layout) tras iniciar sesión. */
let currencyCfg = { symbol: "$", decimals: 0 };
let currencyFmt = new Intl.NumberFormat("es-CO", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function configureCurrency(cfg: { symbol?: string | null; decimals?: number | null }) {
  currencyCfg = {
    symbol: cfg.symbol || "$",
    decimals: cfg.decimals === 2 ? 2 : 0,
  };
  currencyFmt = new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: currencyCfg.decimals,
    maximumFractionDigits: currencyCfg.decimals,
  });
}

/** Decimales de moneda configurados (para inputs y validaciones). */
export function currencyDecimals(): number {
  return currencyCfg.decimals;
}

/** Input de dinero: muestra el valor formateado según los decimales del
 * establecimiento mientras se escribe (sin decimales: 315000 → 315.000;
 * con 2 decimales los dígitos se interpretan como centavos, estilo POS:
 * 31500000 → 315.000,00) y entrega al padre el valor numérico. */
export function MoneyInput({
  value,
  onValueChange,
  bare = false,
  className = "",
  decimals,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string | number;
  onValueChange: (raw: string) => void;
  /** Sin estilos de campo (para inputs con estilo propio). */
  bare?: boolean;
  /** Decimales a mostrar; por defecto los del establecimiento. */
  decimals?: number;
}) {
  const dec = decimals ?? currencyCfg.decimals;
  const n = Number(value);
  const display = value === "" || value == null || Number.isNaN(n)
    ? ""
    : new Intl.NumberFormat("es-CO", {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      }).format(n);
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        if (digits === "") { onValueChange(""); return; }
        const num = dec > 0 ? Number(digits) / 10 ** dec : Number(digits);
        onValueChange(String(num));
      }}
      className={bare ? className : `${FIELD_CLS} ${className}`}
    />
  );
}

/* ───────────────────────── Modal ───────────────────────── */

export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  // Portal a <body>: los contenedores animados (fade-in-up) tienen transform
  // y atrapan a los hijos `fixed`; desde body el overlay cubre toda la página
  // (sidebar incluido, z por encima de su z-50).
  return createPortal(
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`glass fade-in-up max-h-[90vh] w-full overflow-y-auto rounded-2xl p-6 shadow-2xl ${
          wide ? "max-w-3xl" : "max-w-md"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-text-muted transition hover:bg-bg-tertiary hover:text-text-primary"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ───────────────────────── Confirmación ───────────────────────── */

export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Aceptar",
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="mb-5 text-sm text-text-secondary">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* ───────────────────────── Tabla ───────────────────────── */

export function Table({
  headers,
  children,
  empty,
}: {
  headers: string[];
  children: ReactNode;
  empty?: boolean;
}) {
  if (empty) {
    return (
      <div className="glass grid place-items-center rounded-2xl py-14 text-text-muted">
        <Inbox size={32} className="mb-2 opacity-60" />
        <p className="text-sm">No hay registros para mostrar</p>
      </div>
    );
  }
  return (
    <div className="glass overflow-x-auto rounded-2xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle/60">{children}</tbody>
      </table>
    </div>
  );
}

/* ───────────────────────── Loader ─────────────────────────
   Animación de carga global con la lógica del negocio (plato +
   cubiertos) en el color de la paleta del establecimiento.
   `full` ocupa toda la pantalla (guards de sesión); sin `full` se
   centra en el área de contenido de la página. */

export function Loader({ label = "Cargando", full = false }: {
  label?: string;
  full?: boolean;
}) {
  const content = (
    <div className="flex flex-col items-center gap-5" role="status" aria-live="polite">
      <div className="relative grid h-28 w-28 place-items-center sm:h-32 sm:w-32">
        <span className="loader-ring absolute inset-0" />
        <span className="grid h-20 w-20 place-items-center rounded-full bg-bg-secondary shadow-xl sm:h-[88px] sm:w-[88px]">
          <UtensilsCrossed className="loader-utensils h-9 w-9 text-accent-blue sm:h-10 sm:w-10" />
        </span>
      </div>
      <p className="text-base font-semibold text-text-secondary">
        {label}
        <span className="loader-dots" />
      </p>
    </div>
  );
  if (full) {
    return <div className="grid min-h-[100dvh] place-items-center p-6">{content}</div>;
  }
  return <div className="grid place-items-center px-6 py-20">{content}</div>;
}

/* ───────────────────────── Varios ───────────────────────── */

export function Badge({
  color,
  children,
}: {
  color: "emerald" | "amber" | "rose" | "blue" | "cyan" | "gray";
  children: ReactNode;
}) {
  const map = {
    emerald: "bg-accent-emerald/15 text-accent-emerald",
    amber: "bg-accent-amber/15 text-accent-amber",
    rose: "bg-accent-rose/15 text-accent-rose",
    blue: "bg-accent-blue/15 text-accent-blue",
    cyan: "bg-accent-cyan/15 text-accent-cyan",
    gray: "bg-bg-tertiary text-text-secondary",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${map[color]}`}>
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

/** Formatea un monto con el símbolo y los decimales del establecimiento
 * (ver configureCurrency). Mantiene la API `cop.format(n)` usada en la app. */
export const cop = {
  format(value: number): string {
    const n = Number(value);
    return `${currencyCfg.symbol}${currencyFmt.format(Number.isFinite(n) ? n : 0)}`;
  },
};

/** Fecha y hora local (es-CO) de un valor de BD; `fallback` si viene vacío. */
export function fmtDateTime(
  value: string | null | undefined,
  fallback = "—",
): string {
  if (!value) return fallback;
  return new Date(value).toLocaleString("es-CO");
}

/* ─────────────── Paginación estilo Polaris (todas las tablas) ───────────────
   "Ver 10/20/50" · « ‹ pág › » · [x a y de z] */

export function usePagination<T>(items: T[]) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const cur = Math.min(page, totalPages);
  const slice = items.slice((cur - 1) * pageSize, cur * pageSize);
  const from = items.length === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(cur * pageSize, items.length);
  // Sin registros no se muestra la barra (solo el estado vacío)
  const bar = items.length === 0 ? null : (
    <PaginationBar page={cur} totalPages={totalPages} pageSize={pageSize}
      from={from} to={to} total={items.length}
      onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
  );
  return { slice, bar, resetPage: () => setPage(1) };
}

export function PaginationBar({ page, totalPages, pageSize, from, to, total, onPage, onPageSize }: {
  page: number; totalPages: number; pageSize: number;
  from: number; to: number; total: number;
  onPage: (p: number) => void; onPageSize: (n: number) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <label className="flex items-center gap-2 text-text-secondary">
        Ver
        <Select value={pageSize} className="!w-20 !py-1.5"
          onChange={(e) => onPageSize(Number(e.target.value))}>
          {[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
      </label>
      <div className="flex items-center gap-1">
        <Pager label="«" disabled={page === 1} onClick={() => onPage(1)} />
        <Pager label="‹" disabled={page === 1} onClick={() => onPage(page - 1)} />
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-blue text-sm font-semibold text-white">
          {page}
        </span>
        <Pager label="›" disabled={page === totalPages} onClick={() => onPage(page + 1)} />
        <Pager label="»" disabled={page === totalPages} onClick={() => onPage(totalPages)} />
      </div>
      <span className="text-xs text-text-muted">[{from} a {to} de {total}]</span>
    </div>
  );
}

function Pager({ label, disabled, onClick }: {
  label: string; disabled: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-lg border border-border-subtle text-text-secondary transition hover:bg-bg-tertiary disabled:opacity-40">
      {label}
    </button>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-border-subtle">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
            active === t
              ? "border-accent-blue font-medium text-accent-blue"
              : "border-transparent text-text-secondary hover:text-text-primary"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
