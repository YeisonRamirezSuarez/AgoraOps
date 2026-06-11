/**
 * Primitivas UI del AgoraOps Design System: toasts, botones, campos,
 * modales, confirmación, tabla y estados vacíos. Dark premium +
 * glassmorphism (docs/implementation_plan.md — Sistema de Diseño).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, X, Inbox } from "lucide-react";

/* ───────────────────────── Toasts ───────────────────────── */

interface Toast {
  id: number;
  type: "success" | "error";
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
              t.type === "success" ? "border-accent-emerald/40" : "border-accent-rose/40"
            }`}
          >
            {t.type === "success" ? (
              <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-accent-emerald" />
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
    "bg-gradient-to-br from-accent-blue to-accent-blue-hover text-white shadow-[0_0_16px_hsl(217_91%_60%/0.2)] hover:brightness-110",
  success:
    "bg-gradient-to-br from-accent-emerald to-emerald-700 text-white hover:brightness-110",
  danger:
    "bg-accent-rose/15 text-accent-rose border border-accent-rose/40 hover:bg-accent-rose/25",
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
  "w-full rounded-lg border border-border-subtle bg-bg-tertiary px-3 py-2.5 text-sm outline-none transition focus:border-accent-blue focus:shadow-[0_0_16px_hsl(217_91%_60%/0.15)]";

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
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
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
    </div>
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
        <p className="text-sm">Sin registros</p>
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

export const cop = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

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
