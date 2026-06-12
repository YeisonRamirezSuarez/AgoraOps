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
  ArrowLeft, CalendarCheck, Download, FileText, Info,
  LogIn, LogOut, Pencil, Plus, Printer, Save, Search,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { CrudPage } from "../components/CrudPage";
import { EnConstruccion } from "../components/EnConstruccion";
import { ParametersForm } from "../components/ParametersForm";
import { useTabParam } from "../lib/useTab";
import {
  Badge, Button, cop, FormRow, Input, MoneyInput, PageHeader, Select, Table,
  TextArea, usePagination, useToast,
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
      {tab === "Cajas" && (
        <CrudPage
          title="caja"
          endpoint="/api/catalogs/cash-registers"
          fields={[
            { name: "name", label: "Nombre", required: true, immutable: true },
            {
              name: "status", label: "Estado", type: "select", required: true,
              options: [{ value: "activa", label: "Activa" }, { value: "inactiva", label: "Inactiva" }],
            },
            { name: "note", label: "Nota" },
          ]}
        />
      )}
      {tab === "Reporte de cajas" && <ReportTab />}
      {tab === "Descargar servicio de impresión" && (
        <EnConstruccion titulo="Servicio de impresión"
          nota="Instalador local para impresoras USB/Ethernet (manual §1.8.5) — servicio print-service del roadmap." />
      )}
      {tab === "Configuración de impresoras" && (
        <CrudPage title="impresora" endpoint="/api/catalogs/printers"
          fields={[
            { name: "name", label: "Nombre de impresora", required: true, immutable: true },
            {
              name: "connection_type", label: "Tipo de conexión", type: "select", required: true,
              options: [{ value: "USB", label: "USB" }, { value: "ETHERNET", label: "ETHERNET" }],
            },
            // IP y Puerto solo cuando la conexión es ETHERNET (Polaris);
            // USB usa el nombre del dispositivo
            {
              name: "ip_address", label: "IP", required: true,
              visible: (d) => d.connection_type === "ETHERNET",
            },
            {
              name: "port", label: "Puerto", type: "number", required: true, inTable: false,
              visible: (d) => d.connection_type === "ETHERNET",
            },
            {
              name: "device_name", label: "Nombre del dispositivo (USB)",
              visible: (d) => d.connection_type === "USB",
            },
            { name: "location", label: "Ubicación", inTable: false },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]} />
      )}
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
      "Dinero de apertura", "Total", "Estado", "Fecha de creación"];
    const lines = filtered.map((r) => [
      r.name, r.user_name ?? "", r.responsible_name ?? "", r.opening_amount ?? "",
      r.current_total ?? "", "ABIERTO",
      r.opened_at ? new Date(r.opened_at).toLocaleString("es-CO") : "",
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
          "Dinero de apertura", "Total", "Estado", "Fecha de creación",
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
            <td className="px-4 py-2 text-xs">
              {r.opened_at ? new Date(r.opened_at).toLocaleString("es-CO") : "—"}
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
  const available = registers.filter((r) => r.register_status === "activa" && !r.session_id);

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
          <MoneyInput value={amount} onValueChange={setAmount} />
        </FormRow>
        <FormRow label="Estado">
          <Select value="ABIERTO" disabled>
            <option>ABIERTO</option>
          </Select>
        </FormRow>
        <FormRow label="Nota" required>
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} required />
        </FormRow>
      </div>
      <p className="mt-2 text-xs font-medium text-accent-rose">* Campos obligatorios</p>
      {available.length === 0 && (
        <p className="mt-2 text-sm text-accent-amber">
          No hay cajas disponibles para abrir (todas abiertas o inactivas).
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

/** Tirilla "REPORTE DE CIERRE DE CAJA" (formato Polaris). */
function buildCashReportHtml(summary: Summary, counted: number | null) {
  const s = summary.session;
  const b = summary.business;
  const t = summarizeCash(summary);
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const money = (n: number) => cop.format(n);
  const line = (l: string, v: string) =>
    `<tr><td>${esc(l)}</td><td class="r">${esc(v)}</td></tr>`;
  const now = new Date();
  return `<!doctype html><html><head><meta charset="utf-8"><title>Reporte de Cierre de Caja</title>
<style>
  body{font-family:'Courier New',monospace;font-size:12px;width:320px;margin:0 auto;padding:12px;color:#000}
  h1{font-size:13px;text-align:center;margin:0 0 6px}
  h2{font-size:12px;text-align:center;margin:6px 0 2px;border-top:1px solid #000;padding-top:4px}
  table{width:100%;border-collapse:collapse}
  td{padding:1px 0;vertical-align:top}
  .r{text-align:right}.b{font-weight:bold}
  p{margin:1px 0}
</style></head><body onload="window.print();window.onafterprint=()=>window.close()">
<h1>REPORTE DE CIERRE DE CAJA</h1>
<p><b>FECHA:</b> ${now.toLocaleDateString("es-CO")}</p>
<p><b>HORA:</b> ${now.toLocaleTimeString("es-CO")}</p>
<br>
<p><b>CAJA:</b> ${esc(s.register_name)}</p>
<p><b>RESPONSABLE:</b> ${esc(s.responsible_name ?? s.user_name ?? "—")}</p>
<p><b>F DE APERTURA:</b> ${new Date(s.opened_at).toLocaleString("es-CO")}</p>
<p><b>F DE CIERRE:</b> ${s.closed_at ? new Date(s.closed_at).toLocaleString("es-CO") : ""}</p>
<h2>ESTABLECIMIENTO</h2>
<p><b>NOMBRE:</b> ${esc(b?.business_name ?? "AgoraOps")}</p>
${b?.tax_id ? `<p><b>NIT:</b> ${esc(b.tax_id)}</p>` : ""}
${b?.address ? `<p><b>DIRECCIÓN:</b> ${esc(b.address)}</p>` : ""}
${b?.phone ? `<p><b>TELÉFONO:</b> ${esc(b.phone)}</p>` : ""}
<h2>CAJA</h2>
<table>
${line("Monto de apertura", money(t.opening))}
${line("Ventas totales", money(t.salesTotal))}
${line("Entradas", money(t.income))}
${line("Salidas", "- " + money(t.expense))}
<tr class="b"><td>TOTAL</td><td class="r">${money(t.grandTotal)}</td></tr>
</table>
<h2>PROPINAS POR MÉTODO DE PAGO</h2>
<table>
${summary.byMethod.map((m) => line(m.name, money(Number(m.tips)))).join("")}
</table>
<h2>NÚMERO DE TRANSACCIONES</h2>
<table>
${summary.byMethod.map((m) => line(m.name, String(m.tx_count))).join("")}
</table>
<h2>TOTALES</h2>
<table>
${summary.byMethod.map((m) => line(`Ventas ${m.name.toLowerCase()}`, money(Number(m.total)))).join("")}
${line("Propinas", money(t.tipsTotal))}
<tr class="b"><td>TOTAL</td><td class="r">${money(t.salesTotal)}</td></tr>
${line("Efectivo contado", money(counted ?? 0))}
</table>
<p style="text-align:center;margin-top:8px">Impreso por | AgoraOps</p>
</body></html>`;
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
    if (!note.trim()) {
      toast("error", "El campo Nota es obligatorio para cerrar la caja");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/cash/sessions/${row.session_id}/close`, {
        method: "POST",
        body: { countedCash: counted === "" ? null : Number(counted), note },
      });
      toast("success", "Caja cerrada correctamente");
      onBack();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "No se pudo cerrar la caja");
    } finally {
      setSaving(false);
    }
  }

  /** Informe de caja imprimible (formato tirilla, como Polaris). */
  function printReport() {
    if (!summary) return;
    const w = window.open("", "_blank", "width=420,height=640");
    if (!w) {
      toast("error", "No fue posible generar el informe.");
      return;
    }
    w.document.write(buildCashReportHtml(summary, counted === "" ? null : Number(counted)));
    w.document.close();
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
          <Button variant="ghost"
            onClick={() => toast("error", "Abrir la caja registradora estará disponible con el servicio de impresión local (§1.8.6).")}>
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
          <MoneyInput placeholder="0,00" value={counted}
            disabled={cashTotal <= 0}
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
        <TextArea rows={3} placeholder="ESCRIBE UNA NOTA..." value={note}
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
          <Button variant="ghost"
            onClick={() => toast("error", "Abrir la caja registradora estará disponible con el servicio de impresión local (§1.8.6).")}>
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
            <td className="px-4 py-2 text-xs">{new Date(t.created_at).toLocaleString("es-CO")}</td>
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
      r.register_name, r.user_name ?? "", new Date(r.opened_at).toLocaleString("es-CO"),
      r.closed_by_name ?? "", new Date(r.closed_at).toLocaleString("es-CO"),
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

  /** Voucher de cierre: misma tirilla del informe de caja. */
  async function printVoucher(r: ReportRow) {
    try {
      const summary = await api<Summary>(`/api/cash/sessions/${r.id}/summary`);
      const w = window.open("", "_blank", "width=420,height=640");
      if (!w) {
        toast("error", "No fue posible generar el voucher de cierre.");
        return;
      }
      w.document.write(buildCashReportHtml(
        summary, r.counted_cash == null ? null : Number(r.counted_cash)));
      w.document.close();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "No fue posible obtener el voucher.");
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
              <td className="px-4 py-2 text-xs">{new Date(r.opened_at).toLocaleString("es-CO")}</td>
              <td className="px-4 py-2">{r.closed_by_name ?? "—"}</td>
              <td className="px-4 py-2 text-xs">{new Date(r.closed_at).toLocaleString("es-CO")}</td>
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
            <td className="px-4 py-2 text-xs">{new Date(m.created_at).toLocaleString("es-CO")}</td>
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
