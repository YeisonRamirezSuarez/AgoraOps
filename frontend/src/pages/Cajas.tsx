/**
 * Gestión de Cajas — manual §1.8, flujo Apertura/Cierre estilo Polaris:
 * lista (búsqueda rápida, + Nuevo, Exportar, tabla con editar y
 * registrar entrada/salida, paginación) → "Abrir caja" (caja,
 * responsable, dinero de apertura, estado, nota*) → "Cierre de caja"
 * (desglose por método con %, apertura/entradas/salidas, total y total
 * efectivo, efectivo contado con diferencia, nota* y guardar; botones
 * Generar informe de caja y Abrir caja registradora).
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ArrowLeft, CalendarCheck, Download, FileText, Info,
  LogIn, LogOut, Pencil, Plus, Printer, Save, Search,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import {
  type DocLine, fetchDetectedPrinters, openCashDrawer, printToEndpoint,
} from "../lib/printing";
import { CajasGrid } from "../components/CajasGrid";
import { CrudPage } from "../components/CrudPage";
import { DownloadPrintService } from "../components/DownloadPrintService";
import { ParametersForm } from "../components/ParametersForm";
import { useTabParam } from "../lib/useTab";
import {
  Badge, Button, cop, fmtDateTime, FormRow, Input, MoneyInput, PageHeader, Select,
  Table, TextArea, usePagination, useToast,
} from "../components/ui";

interface SessionRow {
  cash_register_id: number; name: string; register_status: string;
  session_id: number | null; status: string | null;
  opening_amount: string | null; opened_at: string | null; user_name: string | null;
  responsible_name: string | null; opening_note: string | null;
  current_total: string | null;
}
interface Summary {
  session: {
    id: number; register_name: string; status: string;
    opening_amount: string; opening_note: string | null;
    responsible_name: string | null; user_name: string | null;
    opened_at: string; closed_at: string | null;
  };
  byMethod: { name: string; total: string; tips: string; tx_count: string }[];
  transactions: { id: number; type: string; reason: string; amount: string; user_name: string; created_at: string }[];
  business: { business_name: string | null; tax_id: string | null; address: string | null; phone: string | null } | null;
}

const TABS = [
  "Configuración de parámetros", "Cajas", "Apertura / Cierre de cajas",
  "Reporte de cajas", "Descargar servicio de impresión", "Configuración de impresoras",
];

export default function Cajas() {
  const [tab, setTab] = useTabParam(TABS);
  return (
    <div className="fade-in-up">
      <PageHeader title={tab} subtitle="Gestión de cajas" />
      {tab === "Configuración de parámetros" && <ParametersForm />}
      {tab === "Apertura / Cierre de cajas" && <SessionsTab />}
      {tab === "Cajas" && <CajasGrid />}
      {tab === "Reporte de cajas" && <ReportTab />}
      {tab === "Descargar servicio de impresión" && <DownloadPrintService />}
      {tab === "Configuración de impresoras" && <PrintersTab />}
    </div>
  );
}

/* ═════════════ Configuración de impresoras (§1.8.6, flujo Polaris) ═════════════
   El nombre se ELIGE de las impresoras detectadas por el servicio local
   (AgoraOpsPrintService en localhost:9090), no se escribe a mano. Si el
   servicio no responde, se muestra el error y no se puede agregar (igual que
   Polaris). Extensiones del cliente: Ancho de papel (58/80mm) y BLUETOOTH. */
function PrintersTab() {
  const toast = useToast();
  const [detected, setDetected] = useState<{ value: string; label: string }[]>([]);
  const [svcError, setSvcError] = useState(false);

  useEffect(() => {
    fetchDetectedPrinters()
      .then((printers) => {
        setDetected(printers.map((p) => ({ value: p.name, label: p.name })));
        setSvcError(false);
      })
      .catch(() => {
        setDetected([]);
        setSvcError(true);
        toast("error", "¡Error: AgoraOpsPrintService no responde!");
      });
  }, [toast]);

  return (
    <div className="fade-in-up">
      {/* Solo se avisa cuando el servicio local no responde (igual que Polaris) */}
      {svcError && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-accent-rose/40 bg-accent-rose/10 px-4 py-3 text-sm text-accent-rose">
          <AlertTriangle size={16} className="shrink-0" />
          ¡Error: AgoraOpsPrintService no responde! Inicie el servicio de impresión para detectar impresoras.
        </div>
      )}

      <CrudPage title="impresora" endpoint="/api/catalogs/printers"
        canCreate={!svcError}
        fields={[
          // Nombre = impresora detectada por el servicio (no editable a mano)
          {
            name: "name", label: "Nombre de impresora", type: "select",
            required: true, immutable: true, options: detected,
          },
          {
            name: "connection_type", label: "Tipo de conexión", type: "select", required: true,
            options: [
              { value: "USB", label: "USB" },
              { value: "ETHERNET", label: "ETHERNET" },
              { value: "BLUETOOTH", label: "BLUETOOTH" },
            ],
          },
          // IP y Puerto solo cuando la conexión es ETHERNET (Polaris);
          // USB/BLUETOOTH usan el nombre del dispositivo del SO
          {
            name: "ip_address", label: "IP", required: true,
            visible: (d) => d.connection_type === "ETHERNET",
          },
          {
            name: "port", label: "Puerto", type: "number", required: true, inTable: false,
            visible: (d) => d.connection_type === "ETHERNET",
          },
          // Ancho de papel (extensión): el servicio de impresión arma la
          // tirilla al número de columnas que tenga la impresora destino.
          // Valores numéricos → la columna en BD es INT.
          {
            name: "paper_width", label: "Ancho de papel", type: "select", required: true,
            options: [
              { value: 80, label: "80 mm" },
              { value: 58, label: "58 mm" },
            ],
          },
          // Endpoint (rol): la misma impresora se registra una vez por
          // endpoint, igual que Polaris.
          {
            name: "endpoint", label: "Endpoint", type: "select", required: true,
            options: [
              { value: "PAGO", label: "PAGO" },
              { value: "PEDIDO", label: "PEDIDO" },
              { value: "PREFACTURA", label: "PREFACTURA" },
              { value: "CAJA", label: "CAJA" },
            ],
          },
          { name: "is_active", label: "Estado", type: "checkbox", trueLabel: "Activo", falseLabel: "Inactivo" },
          { name: "location", label: "Ubicación", inTable: false },
        ]} />
    </div>
  );
}

/* ═════════════ Apertura / Cierre (§1.8.3, flujo Polaris) ═════════════ */
function SessionsTab() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [view, setView] = useState<"list" | "open">("list");
  const [closing, setClosing] = useState<SessionRow | null>(null);
  const [tx, setTx] = useState<{ row: SessionRow; type: "ENTRADA" | "SALIDA" } | null>(null);
  const [search, setSearch] = useState("");
  const load = useCallback(() => {
    api<SessionRow[]>("/api/cash/sessions").then(setRows).catch(() => {});
  }, []);
  useEffect(load, [load]);

  // La lista muestra las cajas abiertas (aperturas vigentes)
  const open = rows.filter((r) => r.session_id);
  const filtered = open.filter((r) =>
    [r.name, r.user_name, r.responsible_name].join(" ").toLowerCase()
      .includes(search.toLowerCase()));
  const { slice, bar, resetPage } = usePagination(filtered);

  if (view === "open") {
    return <OpenForm registers={rows}
      onBack={() => setView("list")}
      onDone={() => { setView("list"); load(); }} />;
  }
  if (closing) {
    return <CloseView row={closing} onBack={() => { setClosing(null); load(); }} />;
  }
  if (tx) {
    return <TxView row={tx.row} type={tx.type} sessions={open}
      onBack={() => { setTx(null); load(); }} />;
  }

  function exportCsv() {
    const headers = ["Nombre de la caja", "Abierta por", "Responsable de la caja",
      "Dinero de apertura", "Total", "Estado", "Creado por", "Fecha de creación"];
    const lines = filtered.map((r) => [
      r.name, r.user_name ?? "", r.responsible_name ?? "", r.opening_amount ?? "",
      r.current_total ?? "", "ABIERTO", r.user_name ?? "",
      fmtDateTime(r.opened_at, ""),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
    const blob = new Blob(["﻿" + [headers.join(";"), ...lines].join("\r\n")],
      { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "apertura_cierre_cajas.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      {/* Búsqueda rápida + Nuevo / Exportar (Polaris) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-64">
          <Input placeholder="Búsqueda Rápida" value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }} className="!pr-9" />
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setView("open")}>
            <Plus size={15} className="-mt-0.5 mr-1 inline" /> Nuevo
          </Button>
          <Button variant="ghost" onClick={exportCsv}>
            <Download size={15} className="-mt-0.5 mr-1 inline" /> Exportar
          </Button>
        </div>
      </div>

      <Table
        headers={["", "Nombre de la caja", "Abierta por", "Responsable de la caja",
          "Dinero de apertura", "Total", "Estado", "Creado por", "Fecha de creación",
          "Registrar entrada", "Registrar salida"]}
        empty={slice.length === 0}
      >
        {slice.map((r) => (
          <tr key={r.session_id} className="hover:bg-bg-tertiary/40">
            <td className="px-4 py-2">
              <button onClick={() => setClosing(r)} title="Cierre de caja"
                aria-label={`Cierre de ${r.name}`}
                className="rounded-lg p-1.5 text-text-muted transition hover:bg-bg-tertiary hover:text-accent-blue">
                <Pencil size={16} />
              </button>
            </td>
            <td className="px-4 py-2 font-medium">{r.name}</td>
            <td className="px-4 py-2">{r.user_name ?? "—"}</td>
            <td className="px-4 py-2">{r.responsible_name ?? "—"}</td>
            <td className="px-4 py-2">{cop.format(Number(r.opening_amount))}</td>
            <td className="px-4 py-2 font-semibold">{cop.format(Number(r.current_total))}</td>
            <td className="px-4 py-2"><Badge color="emerald">ABIERTO</Badge></td>
            <td className="px-4 py-2">{r.user_name ?? "—"}</td>
            <td className="px-4 py-2 text-xs">
              {fmtDateTime(r.opened_at)}
            </td>
            <td className="px-4 py-2 text-center">
              <button onClick={() => setTx({ row: r, type: "ENTRADA" })} title="Registrar entrada"
                aria-label={`Registrar entrada en ${r.name}`}
                className="rounded-lg p-1.5 text-accent-emerald transition hover:bg-accent-emerald/10">
                <LogIn size={16} />
              </button>
            </td>
            <td className="px-4 py-2 text-center">
              <button onClick={() => setTx({ row: r, type: "SALIDA" })} title="Registrar salida"
                aria-label={`Registrar salida en ${r.name}`}
                className="rounded-lg p-1.5 text-accent-rose transition hover:bg-accent-rose/10">
                <LogOut size={16} />
              </button>
            </td>
          </tr>
        ))}
      </Table>

      {bar}

      {open.length === 0 && (
        <p className="mt-4 text-center text-sm text-text-muted">
          No hay cajas abiertas. Use <b>+ Nuevo</b> para abrir una caja
          {rows.length === 0 && " (cree primero la caja en la pestaña \"Cajas\")"}.
        </p>
      )}
    </>
  );
}

/* ───────── Abrir caja (formulario Polaris) ───────── */
function OpenForm({ registers, onBack, onDone }: {
  registers: SessionRow[]; onBack: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [regId, setRegId] = useState("");
  const [respId, setRespId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ id: string; full_name: string }[]>("/api/users").then(setUsers).catch(() => {});
  }, []);

  // Solo cajas activas y sin sesión abierta
  const available = registers.filter((r) => r.register_status === "FUNCIONANDO" && !r.session_id);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!regId || !respId || !note.trim()) {
      toast("error", "Complete todos los campos obligatorios (*)");
      return;
    }
    setSaving(true);
    try {
      await api("/api/cash/sessions", {
        method: "POST",
        body: {
          cashRegisterId: Number(regId), openingAmount: Number(amount) || 0,
          responsibleId: respId, note,
        },
      });
      toast("success", "Caja abierta correctamente");
      onDone();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "No se pudo abrir la caja");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="fade-in-up">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">Abrir caja</h2>
        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            <Plus size={15} className="-mt-0.5 mr-1 inline" /> Agregar
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft size={15} className="-mt-0.5 mr-1 inline" /> Volver
          </Button>
        </div>
      </div>

      <div className="glass max-w-3xl space-y-4 rounded-2xl p-6">
        <FormRow label="Caja" required>
          <Select value={regId} onChange={(e) => setRegId(e.target.value)} required>
            <option value="">Seleccione una opción</option>
            {available.map((r) => (
              <option key={r.cash_register_id} value={r.cash_register_id}>{r.name}</option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="Responsable de la caja" required>
          <Select value={respId} onChange={(e) => setRespId(e.target.value)} required>
            <option value="">Seleccione una opción</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </Select>
        </FormRow>
        <FormRow label="Dinero de la apertura">
          <MoneyInput value={amount} onValueChange={setAmount} maxLength={17} />
        </FormRow>
        <FormRow label="Estado">
          <Select value="ABIERTO" disabled>
            <option>ABIERTO</option>
          </Select>
        </FormRow>
        <FormRow label="Nota" required>
          <TextArea rows={3} value={note} maxLength={250}
            onChange={(e) => setNote(e.target.value)} required />
        </FormRow>
      </div>
      <p className="mt-2 text-xs font-medium text-accent-rose">* Campos obligatorios</p>
      {available.length === 0 && (
        <p className="mt-2 text-sm text-accent-amber">
          No hay cajas disponibles para abrir (todas abiertas o fallando).
        </p>
      )}
    </form>
  );
}

/* ───────── Totales e informe de caja (compartidos por Cierre de caja
   y el voucher de cierre del Reporte de cajas) ───────── */
function summarizeCash(summary: Summary) {
  const opening = Number(summary.session.opening_amount ?? 0);
  const income = summary.transactions.filter((t) => t.type === "ENTRADA")
    .reduce((s, t) => s + Number(t.amount), 0);
  const expense = summary.transactions.filter((t) => t.type === "SALIDA")
    .reduce((s, t) => s + Number(t.amount), 0);
  const salesTotal = summary.byMethod.reduce((s, m) => s + Number(m.total), 0);
  const tipsTotal = summary.byMethod.reduce((s, m) => s + Number(m.tips), 0);
  const cashSales = Number(summary.byMethod.find((m) => m.name === "EFECTIVO")?.total ?? 0);
  const grandTotal = opening + income - expense + salesTotal;
  const cashTotal = opening + cashSales + income - expense;
  return { opening, income, expense, salesTotal, tipsTotal, cashSales, grandTotal, cashTotal };
}

/** Documento "REPORTE DE CIERRE DE CAJA" (formato Polaris). Se renderiza al
 * ancho de la impresora del endpoint CAJA por el servicio local. */
function buildCierreDoc(summary: Summary, counted: number | null): DocLine[] {
  const s = summary.session;
  const b = summary.business;
  const t = summarizeCash(summary);
  const money = (n: number) => cop.format(n);
  const now = new Date();
  return [
    { t: "text", v: "REPORTE DE CIERRE DE CAJA", align: "center" },
    { t: "kv", k: "FECHA", v: now.toLocaleDateString("es-CO") },
    { t: "kv", k: "HORA", v: now.toLocaleTimeString("es-CO") },
    { t: "blank" },
    { t: "kv", k: "CAJA", v: s.register_name },
    { t: "kv", k: "RESPONSABLE", v: s.responsible_name ?? s.user_name ?? "-" },
    { t: "kv", k: "F APERTURA", v: fmtDateTime(s.opened_at, "") },
    { t: "kv", k: "F CIERRE", v: fmtDateTime(s.closed_at, "") },
    { t: "divider" },
    { t: "text", v: "ESTABLECIMIENTO", align: "center" },
    { t: "text", v: b?.business_name ?? "AgoraOps" },
    ...(b?.tax_id ? [{ t: "kv", k: "NIT", v: b.tax_id } as DocLine] : []),
    ...(b?.address ? [{ t: "text", v: b.address } as DocLine] : []),
    ...(b?.phone ? [{ t: "kv", k: "TEL", v: b.phone } as DocLine] : []),
    { t: "divider" },
    { t: "text", v: "CAJA", align: "center" },
    { t: "kv", k: "Monto de apertura", v: money(t.opening) },
    { t: "kv", k: "Ventas totales", v: money(t.salesTotal) },
    { t: "kv", k: "Entradas", v: money(t.income) },
    { t: "kv", k: "Salidas", v: "- " + money(t.expense) },
    { t: "kv", k: "TOTAL", v: money(t.grandTotal) },
    { t: "divider" },
    { t: "text", v: "PROPINAS POR METODO DE PAGO", align: "center" },
    ...summary.byMethod.map((m): DocLine => ({ t: "kv", k: m.name, v: money(Number(m.tips)) })),
    { t: "divider" },
    { t: "text", v: "NUMERO DE TRANSACCIONES", align: "center" },
    ...summary.byMethod.map((m): DocLine => ({ t: "kv", k: m.name, v: String(m.tx_count) })),
    { t: "divider" },
    { t: "text", v: "TOTALES", align: "center" },
    ...summary.byMethod.map((m): DocLine => ({
      t: "kv", k: `Ventas ${m.name.toLowerCase()}`, v: money(Number(m.total)),
    })),
    { t: "kv", k: "Propinas", v: money(t.tipsTotal) },
    { t: "kv", k: "TOTAL", v: money(t.salesTotal) },
    { t: "kv", k: "Efectivo contado", v: money(counted ?? 0) },
    { t: "blank" },
    { t: "text", v: "Impreso por | AgoraOps", align: "center" },
  ];
}

/* ───────── Cierre de caja (vista Polaris) ───────── */
function CloseView({ row, onBack }: { row: SessionRow; onBack: () => void }) {
  const toast = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Summary>(`/api/cash/sessions/${row.session_id}/summary`).then(setSummary).catch(() => {});
  }, [row.session_id]);

  const { opening, income, expense, grandTotal, cashTotal } = summary
    ? summarizeCash(summary)
    : { opening: 0, income: 0, expense: 0, grandTotal: 0, cashTotal: 0 };
  const pct = (v: number) => grandTotal === 0 ? "0%" : `${Math.round((v / grandTotal) * 1000) / 10}%`;
  const diff = counted === "" ? 0 : Number(counted) - cashTotal;

  async function save() {
    if (counted === "") {
      toast("error", "El campo Efectivo contado es obligatorio para cerrar la caja");
      return;
    }
    if (!note.trim()) {
      toast("error", "El campo Nota es obligatorio para cerrar la caja");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/cash/sessions/${row.session_id}/close`, {
        method: "POST",
        body: { countedCash: Number(counted), note },
      });
      toast("success", "Caja cerrada correctamente");
      onBack();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "No se pudo cerrar la caja");
    } finally {
      setSaving(false);
    }
  }

  /** Informe de caja imprimible (endpoint CAJA, ancho de la impresora). */
  async function printReport() {
    if (!summary) return;
    try {
      await printToEndpoint("CAJA", buildCierreDoc(summary, counted === "" ? null : Number(counted)));
      toast("success", "Informe de caja enviado a impresión.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "No fue posible generar el informe.");
    }
  }


  return (
    <div className="fade-in-up">
      {/* Encabezado: Caja | Estado | Nota + acciones */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <h2 className="text-base">
          <span className="font-bold">Caja:</span> {row.name}
          <span className="mx-2 text-text-muted">|</span>
          <span className="font-bold">Estado:</span> <Badge color="emerald">ABIERTO</Badge>
          <span className="mx-2 text-text-muted">|</span>
          <span className="font-bold">Nota:</span> {row.opening_note ?? "—"}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={printReport}>
            <CalendarCheck size={15} className="-mt-0.5 mr-1 inline" /> Generar informe de caja
          </Button>
          <Button variant="ghost" onClick={async () => {
            try { await openCashDrawer(); toast("success", "Cajón abierto."); }
            catch (e) { toast("error", e instanceof Error ? e.message : "No fue posible abrir el cajón."); }
          }}>
            <Printer size={15} className="-mt-0.5 mr-1 inline" /> Abrir caja registradora
          </Button>
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={15} className="-mt-0.5 mr-1 inline" /> Volver
          </Button>
        </div>
      </div>

      {/* Tarjetas por método de pago con % */}
      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        {(summary?.byMethod ?? []).map((m) => (
          <div key={m.name} className="glass rounded-2xl p-4 text-center">
            <p className="text-sm font-bold uppercase">{m.name}</p>
            <p className="text-lg font-bold">{cop.format(Number(m.total))}</p>
            <p className="text-sm text-text-secondary">({pct(Number(m.total))})</p>
          </div>
        ))}
        {summary && summary.byMethod.length === 0 && (
          <p className="col-span-full text-center text-sm text-text-muted">
            Sin ventas registradas en esta caja.
          </p>
        )}
      </div>

      {/* Apertura / entradas / salidas */}
      <div className="mb-6 grid gap-3 border-y border-border-subtle py-4 text-center sm:grid-cols-3">
        <StatBlock label="Monto apertura" value={cop.format(opening)} pct={pct(opening)} />
        <StatBlock label="Total entradas" value={cop.format(income)} pct={pct(income)} />
        <StatBlock label="Total salidas" value={cop.format(expense)} pct={pct(expense)} />
      </div>

      {/* Total / Total efectivo */}
      <div className="mx-auto mb-6 grid max-w-md grid-cols-2 gap-6 text-center">
        <div>
          <p className="font-bold">Total</p>
          <p className="text-lg font-bold">{cop.format(grandTotal)}</p>
          <Info size={14} className="mx-auto text-accent-orange"
            aria-label="Apertura + ventas + entradas − salidas" />
        </div>
        <div>
          <p className="font-bold">Total efectivo</p>
          <p className="text-lg font-bold">{cop.format(cashTotal)}</p>
          <Info size={14} className="mx-auto text-accent-orange"
            aria-label="Dinero físico esperado en la caja" />
        </div>
      </div>

      {/* Efectivo contado + diferencia */}
      <div className="glass mx-auto mb-5 max-w-sm rounded-2xl p-5 text-center">
        <p className="mb-2 text-sm font-semibold">
          Efectivo contado:<span className="text-accent-rose">*</span>
        </p>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-text-muted">$</span>
          <MoneyInput placeholder="0,00" value={counted} maxLength={16}
            onValueChange={setCounted} className="text-center" />
          <Info size={15} className="shrink-0 text-accent-orange" />
        </div>
        <p className={`font-bold ${
          counted === "" ? "text-text-secondary"
            : diff >= 0 ? "text-accent-emerald" : "text-accent-rose"
        }`}>
          Diferencia: {cop.format(diff)}
        </p>
      </div>

      {/* Nota + Guardar */}
      <div className="mx-auto max-w-4xl">
        <p className="mb-1.5 text-sm font-semibold">
          Nota: <span className="text-accent-rose">*</span>
        </p>
        <TextArea rows={3} placeholder="ESCRIBE UNA NOTA..." value={note} maxLength={255}
          onChange={(e) => setNote(e.target.value)} />
        <div className="mt-4 flex justify-center">
          <Button onClick={save} disabled={saving || !summary}>
            <Save size={15} className="-mt-0.5 mr-1.5 inline" />
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatBlock({ label, value, pct }: { label: string; value: string; pct: string }) {
  return (
    <div>
      <p className="font-bold">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-sm text-text-secondary">({pct})</p>
    </div>
  );
}

/* ───────── Registro / Registrar entrada y salida (§1.8.3, flujo Polaris):
   lista de movimientos del tipo → formulario con caja, monto, tipo fijo
   y descripción obligatoria ───────── */
function TxView({ row, type, sessions, onBack }: {
  row: SessionRow; type: "ENTRADA" | "SALIDA";
  sessions: SessionRow[]; onBack: () => void;
}) {
  const toast = useToast();
  const isIncome = type === "ENTRADA";
  const label = isIncome ? "entrada" : "salida";

  const [mode, setMode] = useState<"list" | "form">("list");
  const [sessionId, setSessionId] = useState(String(row.session_id));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [search, setSearch] = useState("");
  // Formulario
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const current = sessions.find((s) => String(s.session_id) === sessionId) ?? row;

  const loadSummary = useCallback(() => {
    api<Summary>(`/api/cash/sessions/${sessionId}/summary`)
      .then(setSummary).catch(() => {});
  }, [sessionId]);
  useEffect(loadSummary, [loadSummary]);

  const movements = (summary?.transactions ?? []).filter((t) => t.type === type);
  const filtered = movements.filter((t) =>
    [t.reason, t.user_name].join(" ").toLowerCase().includes(search.toLowerCase()));
  const { slice, bar, resetPage } = usePagination(filtered);

  async function register(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!amount || !reason.trim()) {
      toast("error", "Complete todos los campos obligatorios (*)");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/cash/sessions/${sessionId}/transactions`, {
        method: "POST", body: { type, reason, amount: Number(amount) },
      });
      toast("success", `${isIncome ? "Entrada" : "Salida"} registrada correctamente`);
      setAmount(""); setReason("");
      loadSummary();
      setMode("list");
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "No se pudo registrar");
    } finally {
      setSaving(false);
    }
  }

  /* ── Formulario "Registrar entrada/salida" (Polaris) ── */
  if (mode === "form") {
    return (
      <form onSubmit={register} className="fade-in-up">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Registrar {label}</h2>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              <Plus size={15} className="-mt-0.5 mr-1 inline" /> Agregar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("list")}>
              <ArrowLeft size={15} className="-mt-0.5 mr-1 inline" /> Volver
            </Button>
          </div>
        </div>

        <div className="glass max-w-3xl space-y-4 rounded-2xl p-6">
          <FormRow label="Caja registradora">
            <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              {sessions.map((s) => (
                <option key={s.session_id} value={String(s.session_id)}>{s.name}</option>
              ))}
            </Select>
          </FormRow>
          <FormRow label="Monto" required>
            <MoneyInput value={amount} required onValueChange={setAmount} />
          </FormRow>
          <FormRow label="Tipo de movimiento">
            <span className="text-sm font-medium text-text-secondary">{type}</span>
          </FormRow>
          <FormRow label="Descripción" required>
            <TextArea rows={3} value={reason} required
              onChange={(e) => setReason(e.target.value)} />
          </FormRow>
        </div>
        <p className="mt-2 text-xs font-medium text-accent-rose">* Campos obligatorios</p>
      </form>
    );
  }

  /* ── Lista "Registro de entrada/salida" (Polaris) ── */
  return (
    <div className="fade-in-up">
      <h2 className="mb-4 text-lg font-bold">Registro de {label}</h2>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-64">
          <Input placeholder="Búsqueda Rápida" value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }} className="!pr-9" />
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("form")}>
            {isIncome
              ? <LogIn size={15} className="-mt-0.5 mr-1 inline" />
              : <LogOut size={15} className="-mt-0.5 mr-1 inline" />}
            Registrar {label}
          </Button>
          <Button variant="ghost" onClick={async () => {
            try { await openCashDrawer(); toast("success", "Cajón abierto."); }
            catch (e) { toast("error", e instanceof Error ? e.message : "No fue posible abrir el cajón."); }
          }}>
            <Printer size={15} className="-mt-0.5 mr-1 inline" /> Abrir caja registradora
          </Button>
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={15} className="-mt-0.5 mr-1 inline" /> Volver
          </Button>
        </div>
      </div>

      <Table
        headers={["Nombre de la caja", "Dinero", "Tipo de movimiento",
          "Razón del movimiento", "Creado por", "Fecha de creación"]}
        empty={slice.length === 0}
      >
        {slice.map((t) => (
          <tr key={t.id} className="hover:bg-bg-tertiary/40">
            <td className="px-4 py-2 font-medium">{current.name}</td>
            <td className="px-4 py-2">{cop.format(Number(t.amount))}</td>
            <td className="px-4 py-2">
              <Badge color={isIncome ? "emerald" : "rose"}>{t.type}</Badge>
            </td>
            <td className="px-4 py-2">{t.reason}</td>
            <td className="px-4 py-2">{t.user_name}</td>
            <td className="px-4 py-2 text-xs">{fmtDateTime(t.created_at)}</td>
          </tr>
        ))}
      </Table>

      {bar}
    </div>
  );
}

/* ───────── Reporte de cajas (§1.8.4, flujo Polaris): cajas cerradas con
   voucher de cierre imprimible y detalle de movimientos ───────── */
interface ReportRow {
  id: number; register_name: string; user_name: string | null;
  closed_by_name: string | null; opened_at: string; closed_at: string;
  opening_amount: string; registered_total: string; cash_total: string;
  counted_cash: string | null; difference: string | null; note: string | null;
}

function ReportTab() {
  const toast = useToast();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [detail, setDetail] = useState<ReportRow | null>(null);
  const { slice, bar } = usePagination(rows);

  useEffect(() => {
    api<ReportRow[]>("/api/cash/report").then(setRows).catch(() => {});
  }, []);

  if (detail) {
    return <ReportDetail row={detail} onBack={() => setDetail(null)} />;
  }

  const accumulated = rows.reduce((s, r) => s + Number(r.registered_total), 0);

  function exportCsv() {
    const headers = ["Nombre de la caja", "Usuario de apertura", "Fecha de apertura",
      "Usuario de cierre", "Fecha de cierre", "Monto de apertura", "Registro total",
      "Efectivo contado en caja", "Diferencia de cierre", "Nota"];
    const lines = rows.map((r) => [
      r.register_name, r.user_name ?? "", fmtDateTime(r.opened_at, ""),
      r.closed_by_name ?? "", fmtDateTime(r.closed_at, ""),
      r.opening_amount, r.registered_total, r.counted_cash ?? "", r.difference ?? "",
      r.note ?? "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
    const blob = new Blob(["﻿" + [headers.join(";"), ...lines].join("\r\n")],
      { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "reporte_de_cajas.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Voucher de cierre: misma tirilla del informe de caja (endpoint CAJA). */
  async function printVoucher(r: ReportRow) {
    try {
      const summary = await api<Summary>(`/api/cash/sessions/${r.id}/summary`);
      await printToEndpoint("CAJA",
        buildCierreDoc(summary, r.counted_cash == null ? null : Number(r.counted_cash)));
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message
        : err instanceof Error ? err.message : "No fue posible obtener el voucher.");
    }
  }

  return (
    <>
      <div className="mb-4 flex justify-center">
        <Button variant="ghost" onClick={exportCsv}>
          <Download size={15} className="-mt-0.5 mr-1 inline" /> Exportar
        </Button>
      </div>

      <Table
        headers={["Nombre de la caja", "Usuario de apertura", "Fecha de apertura",
          "Usuario de cierre", "Fecha de cierre", "Monto de apertura", "Registro total",
          "Efectivo contado en caja", "Diferencia de cierre", "Voucher cierre", "Detalles"]}
        empty={rows.length === 0}
      >
        {slice.map((r) => {
          const diff = r.difference == null ? null : Number(r.difference);
          return (
            <tr key={r.id} className="hover:bg-bg-tertiary/40">
              <td className="px-4 py-2 font-medium">{r.register_name}</td>
              <td className="px-4 py-2">{r.user_name ?? "—"}</td>
              <td className="px-4 py-2 text-xs">{fmtDateTime(r.opened_at)}</td>
              <td className="px-4 py-2">{r.closed_by_name ?? "—"}</td>
              <td className="px-4 py-2 text-xs">{fmtDateTime(r.closed_at)}</td>
              <td className="px-4 py-2">{cop.format(Number(r.opening_amount))}</td>
              <td className="px-4 py-2 font-semibold">{cop.format(Number(r.registered_total))}</td>
              <td className="px-4 py-2">{r.counted_cash == null ? "—" : cop.format(Number(r.counted_cash))}</td>
              <td className={`px-4 py-2 font-medium ${diff == null ? "" : diff >= 0 ? "text-accent-emerald" : "text-accent-rose"}`}>
                {diff == null ? "—" : cop.format(diff)}
              </td>
              <td className="px-4 py-2 text-center">
                <button onClick={() => printVoucher(r)} title="Voucher cierre"
                  aria-label={`Voucher de cierre de ${r.register_name}`}
                  className="rounded-lg p-1.5 text-text-muted transition hover:bg-bg-tertiary hover:text-accent-blue">
                  <Printer size={16} />
                </button>
              </td>
              <td className="px-4 py-2 text-center">
                <button onClick={() => setDetail(r)} title="Detalles"
                  aria-label={`Detalle de ${r.register_name}`}
                  className="rounded-lg p-1.5 text-text-muted transition hover:bg-bg-tertiary hover:text-accent-blue">
                  <FileText size={16} />
                </button>
              </td>
            </tr>
          );
        })}
        {rows.length > 0 && (
          <tr className="bg-bg-tertiary/60 font-semibold">
            <td colSpan={6} className="px-4 py-2">Total Acumulado -</td>
            <td className="px-4 py-2">{cop.format(accumulated)}</td>
            <td colSpan={4} />
          </tr>
        )}
      </Table>

      {bar}
    </>
  );
}

/* ───────── Reporte de cajas detallado (Polaris): movimientos de la
   sesión — ventas por método + entradas/salidas manuales ───────── */
interface Movement {
  register_name: string; type: string; reason: string;
  created_by: string | null; created_at: string; amount: string;
}

function ReportDetail({ row, onBack }: { row: ReportRow; onBack: () => void }) {
  const [moves, setMoves] = useState<Movement[]>([]);
  const [search, setSearch] = useState("");

  const filtered = moves.filter((m) =>
    [m.reason, m.created_by, m.type].join(" ").toLowerCase()
      .includes(search.toLowerCase()));
  const { slice, bar, resetPage } = usePagination(filtered);

  useEffect(() => {
    api<Movement[]>(`/api/cash/sessions/${row.id}/movements`).then(setMoves).catch(() => {});
  }, [row.id]);

  return (
    <div className="fade-in-up">
      <h2 className="mb-4 text-lg font-bold">Reporte de cajas detallado</h2>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-64">
          <Input placeholder="Búsqueda Rápida" value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }} className="!pr-9" />
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
        </div>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={15} className="-mt-0.5 mr-1 inline" /> Volver
        </Button>
      </div>

      <Table
        headers={["Nombre de la caja", "Tipo de movimiento", "Razón", "Creado por",
          "Fecha de creación", "Monto"]}
        empty={slice.length === 0}
      >
        {slice.map((m, idx) => (
          <tr key={idx} className="hover:bg-bg-tertiary/40">
            <td className="px-4 py-2 font-medium">{m.register_name}</td>
            <td className="px-4 py-2">
              <Badge color={m.type === "ENTRADA" ? "emerald" : "rose"}>{m.type}</Badge>
            </td>
            <td className="px-4 py-2">{m.reason}</td>
            <td className="px-4 py-2">{m.created_by ?? "—"}</td>
            <td className="px-4 py-2 text-xs">{fmtDateTime(m.created_at)}</td>
            <td className="px-4 py-2 text-right">{cop.format(Number(m.amount))}</td>
          </tr>
        ))}
        {moves.length > 0 && (
          <tr className="bg-bg-tertiary/60 font-semibold">
            <td colSpan={5} className="px-4 py-2">Total efectivo contado</td>
            <td className="px-4 py-2 text-right">
              {cop.format(Number(row.counted_cash ?? row.cash_total))}
            </td>
          </tr>
        )}
      </Table>

      {bar}
    </div>
  );
}
