/**
 * Gestión de Cajas — manual §1.8.
 * Tabs: Apertura/Cierre (sesiones + entradas/salidas + cierre con
 * efectivo contado, diferencia verde/rojo y nota obligatoria §1.8.3),
 * Cajas (CRUD §1.8.2) y Reporte (§1.8.4: solo cajas ya cerradas).
 */
import { useCallback, useEffect, useState } from "react";
import { Lock, Unlock, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { CrudPage } from "../components/CrudPage";
import { EnConstruccion } from "../components/EnConstruccion";
import { ParametersForm } from "../components/ParametersForm";
import { useTabParam } from "../lib/useTab";
import {
  Badge, Button, cop, Field, Input, Modal, PageHeader, Select, Table,
  TextArea, useToast,
} from "../components/ui";

interface SessionRow {
  cash_register_id: number; name: string; register_status: string;
  session_id: number | null; status: string | null;
  opening_amount: string | null; opened_at: string | null; user_name: string | null;
}
interface Summary {
  session: { opening_amount: string };
  byMethod: { name: string; total: string }[];
  transactions: { id: number; type: string; reason: string; amount: string; user_name: string; created_at: string }[];
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
            { name: "name", label: "Nombre", required: true, immutable: true },
            {
              name: "connection_type", label: "Tipo de conexión", type: "select", required: true,
              options: [{ value: "USB", label: "USB" }, { value: "ETHERNET", label: "Ethernet" }],
            },
            { name: "device_name", label: "Nombre del dispositivo (USB)" },
            { name: "ip_address", label: "Dirección IP (Ethernet)" },
            { name: "port", label: "Puerto (Ethernet)", type: "number", inTable: false },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]} />
      )}
    </div>
  );
}

/* ───────── Apertura / Cierre (§1.8.3) ───────── */
function SessionsTab() {
  const toast = useToast();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [opening, setOpening] = useState<SessionRow | null>(null);
  const [closing, setClosing] = useState<SessionRow | null>(null);
  const [txSession, setTxSession] = useState<SessionRow | null>(null);

  const load = useCallback(() => {
    api<SessionRow[]>("/api/cash/sessions").then(setRows).catch(() => {});
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
        {rows.map((r) => (
          <div key={r.cash_register_id} className="glass rounded-2xl p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold">{r.name}</p>
              <Badge color={r.session_id ? "emerald" : "gray"}>
                {r.session_id ? "Abierta" : "Cerrada"}
              </Badge>
            </div>
            {r.session_id ? (
              <>
                <p className="text-xs text-text-secondary">
                  Apertura: {cop.format(Number(r.opening_amount))} · {r.user_name}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setTxSession(r)}>
                    Entradas / Salidas
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setClosing(r)}>
                    <Lock size={13} className="-mt-0.5 mr-1 inline" /> Cerrar
                  </Button>
                </div>
              </>
            ) : (
              <Button size="sm" className="mt-3 w-full"
                disabled={r.register_status !== "activa"}
                onClick={() => setOpening(r)}>
                <Unlock size={13} className="-mt-0.5 mr-1 inline" /> Abrir caja
              </Button>
            )}
          </div>
        ))}
      </div>

      <OpenModal target={opening} onClose={() => setOpening(null)} onDone={load} />
      <CloseModal target={closing} onClose={() => setClosing(null)} onDone={load} />
      <TransactionsModal target={txSession} onClose={() => setTxSession(null)} />
      {rows.length === 0 && (
        <p className="mt-6 text-center text-sm text-text-muted">
          Cree primero una caja en la pestaña "Cajas".
        </p>
      )}
    </>
  );

  function OpenModal({ target, onClose, onDone }: {
    target: SessionRow | null; onClose: () => void; onDone: () => void;
  }) {
    const [amount, setAmount] = useState("");
    if (!target) return null;
    async function open(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      try {
        await api("/api/cash/sessions", {
          method: "POST",
          body: { cashRegisterId: target!.cash_register_id, openingAmount: Number(amount) },
        });
        toast("success", "Caja abierta correctamente");
        onDone(); onClose();
      } catch (err) {
        toast("error", err instanceof ApiError ? err.message : "No se pudo abrir");
      }
    }
    return (
      <Modal open title={`Abrir ${target.name}`} onClose={onClose}>
        <form onSubmit={open} className="space-y-4">
          <Field label="Monto de apertura">
            <Input type="number" min={0} required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit">Abrir</Button>
          </div>
        </form>
      </Modal>
    );
  }

  function CloseModal({ target, onClose, onDone }: {
    target: SessionRow | null; onClose: () => void; onDone: () => void;
  }) {
    const [summary, setSummary] = useState<Summary | null>(null);
    const [counted, setCounted] = useState("");
    const [note, setNote] = useState("");

    useEffect(() => {
      if (!target?.session_id) return;
      setCounted(""); setNote("");
      api<Summary>(`/api/cash/sessions/${target.session_id}/summary`).then(setSummary);
    }, [target]);

    if (!target) return null;

    const opening = Number(summary?.session.opening_amount ?? 0);
    const income = summary?.transactions.filter((t) => t.type === "ENTRADA")
      .reduce((s, t) => s + Number(t.amount), 0) ?? 0;
    const expense = summary?.transactions.filter((t) => t.type === "SALIDA")
      .reduce((s, t) => s + Number(t.amount), 0) ?? 0;
    const cashSales = Number(summary?.byMethod.find((m) => m.name === "EFECTIVO")?.total ?? 0);
    const cashTotal = opening + cashSales + income - expense;
    const diff = counted === "" ? null : Number(counted) - cashTotal;

    async function close() {
      try {
        await api(`/api/cash/sessions/${target!.session_id}/close`, {
          method: "POST",
          body: { countedCash: counted === "" ? null : Number(counted), note },
        });
        toast("success", "Caja cerrada correctamente");
        onDone(); onClose();
      } catch (err) {
        toast("error", err instanceof ApiError ? err.message : "No se pudo cerrar");
      }
    }

    return (
      <Modal open title={`Cerrar ${target.name}`} onClose={onClose} wide>
        <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-bg-tertiary/60 p-3">
            <p className="mb-2 text-xs font-medium text-text-muted">Desglose por método</p>
            {summary?.byMethod.length === 0 && <p className="text-text-muted">Sin ventas</p>}
            {summary?.byMethod.map((m) => (
              <div key={m.name} className="flex justify-between">
                <span>{m.name}</span><span>{cop.format(Number(m.total))}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-bg-tertiary/60 p-3">
            <div className="flex justify-between"><span>Monto apertura</span><span>{cop.format(opening)}</span></div>
            <div className="flex justify-between"><span>Total entradas</span><span>{cop.format(income)}</span></div>
            <div className="flex justify-between"><span>Total salidas</span><span>{cop.format(expense)}</span></div>
            <div className="mt-1 flex justify-between border-t border-border-subtle pt-1 font-semibold">
              <span>Total en efectivo</span><span>{cop.format(cashTotal)}</span>
            </div>
          </div>
        </div>

        {/* Efectivo contado solo si total en efectivo > 0 (§1.8.3) */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Efectivo contado ${cashTotal <= 0 ? "(no aplica)" : ""}`}>
            <Input type="number" min={0} value={counted} disabled={cashTotal <= 0}
              onChange={(e) => setCounted(e.target.value)} />
          </Field>
          <div className="pt-6">
            {diff !== null && (
              <p className={`text-lg font-bold ${diff >= 0 ? "text-accent-emerald" : "text-accent-rose"}`}>
                Diferencia: {cop.format(diff)} {diff >= 0 ? "(ganancia)" : "(pérdida)"}
              </p>
            )}
          </div>
        </div>
        <Field label="Nota (obligatoria — detalle faltantes o sobrantes)">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} required />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={close}>Cerrar caja</Button>
        </div>
      </Modal>
    );
  }

  function TransactionsModal({ target, onClose }: { target: SessionRow | null; onClose: () => void }) {
    const [summary, setSummary] = useState<Summary | null>(null);
    const [type, setType] = useState<"ENTRADA" | "SALIDA">("ENTRADA");
    const [reason, setReason] = useState("");
    const [amount, setAmount] = useState("");

    const loadSummary = useCallback(() => {
      if (target?.session_id) {
        api<Summary>(`/api/cash/sessions/${target.session_id}/summary`).then(setSummary);
      }
    }, [target]);
    useEffect(loadSummary, [loadSummary]);

    if (!target) return null;

    async function register(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      try {
        await api(`/api/cash/sessions/${target!.session_id}/transactions`, {
          method: "POST", body: { type, reason, amount: Number(amount) },
        });
        toast("success", `${type === "ENTRADA" ? "Entrada" : "Salida"} registrada`);
        setReason(""); setAmount("");
        loadSummary();
      } catch (err) {
        toast("error", err instanceof ApiError ? err.message : "No se pudo registrar");
      }
    }

    return (
      <Modal open title={`Entradas y salidas — ${target.name}`} onClose={onClose} wide>
        <form onSubmit={register} className="mb-4 grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto]">
          <Select value={type} onChange={(e) => setType(e.target.value as "ENTRADA" | "SALIDA")}>
            <option value="ENTRADA">Entrada</option>
            <option value="SALIDA">Salida</option>
          </Select>
          <Input placeholder="Motivo" required value={reason} onChange={(e) => setReason(e.target.value)} />
          <Input type="number" min={1} placeholder="Monto" required value={amount}
            onChange={(e) => setAmount(e.target.value)} />
          <Button type="submit">Agregar</Button>
        </form>
        <Table headers={["Tipo", "Motivo", "Monto", "Usuario"]}
          empty={!summary || summary.transactions.length === 0}>
          {summary?.transactions.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-2">
                {t.type === "ENTRADA"
                  ? <span className="flex items-center gap-1 text-accent-emerald"><ArrowDownCircle size={14} /> Entrada</span>
                  : <span className="flex items-center gap-1 text-accent-rose"><ArrowUpCircle size={14} /> Salida</span>}
              </td>
              <td className="px-4 py-2">{t.reason}</td>
              <td className="px-4 py-2">{cop.format(Number(t.amount))}</td>
              <td className="px-4 py-2">{t.user_name}</td>
            </tr>
          ))}
        </Table>
      </Modal>
    );
  }
}

/* ───────── Reporte de cajas (§1.8.4) ───────── */
function ReportTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    api<Record<string, unknown>[]>("/api/cash/report").then(setRows).catch(() => {});
  }, []);
  return (
    <Table
      headers={["Caja", "Usuario", "Apertura", "Registrado", "Efectivo", "Contado", "Diferencia", "Nota", "Cierre"]}
      empty={rows.length === 0}
    >
      {rows.map((r) => {
        const diff = r.difference == null ? null : Number(r.difference);
        return (
          <tr key={String(r.id)}>
            <td className="px-4 py-2">{String(r.register_name)}</td>
            <td className="px-4 py-2">{String(r.user_name ?? "—")}</td>
            <td className="px-4 py-2">{cop.format(Number(r.opening_amount))}</td>
            <td className="px-4 py-2">{cop.format(Number(r.registered_total))}</td>
            <td className="px-4 py-2">{cop.format(Number(r.cash_total))}</td>
            <td className="px-4 py-2">{r.counted_cash == null ? "—" : cop.format(Number(r.counted_cash))}</td>
            <td className={`px-4 py-2 font-medium ${diff == null ? "" : diff >= 0 ? "text-accent-emerald" : "text-accent-rose"}`}>
              {diff == null ? "—" : cop.format(diff)}
            </td>
            <td className="max-w-40 truncate px-4 py-2">{String(r.note ?? "")}</td>
            <td className="px-4 py-2 text-xs">{new Date(String(r.closed_at)).toLocaleString("es-CO")}</td>
          </tr>
        );
      })}
    </Table>
  );
}
