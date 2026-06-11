/**
 * Configuración Restaurante — manual §1.7, con los submódulos del menú
 * de Polaris Food: salas, mesas, etapas de reserva (solo visual),
 * horarios, objetivos, prioridad del menú, métodos de pago (estado +
 * bancos), denominación de moneda, bancos y catálogo de impuestos.
 */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { CrudPage } from "../components/CrudPage";
import { EnConstruccion } from "../components/EnConstruccion";
import { useTabParam } from "../lib/useTab";
import { Badge, cop, PageHeader, Table, useToast } from "../components/ui";

const TABS = [
  "Sala del restaurante", "Mesas del restaurante", "Etapas de reserva",
  "Horarios", "Objetivos", "Prioridad del menú", "Métodos de pago",
  "Denominación de moneda", "Bancos para transferencia", "Catálogo de impuestos",
];

export default function Configuracion() {
  const [tab, setTab] = useTabParam(TABS);
  const [rooms, setRooms] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    api<{ id: number; name: string }[]>("/api/catalogs/rooms").then(setRooms).catch(() => {});
  }, [tab]);

  return (
    <div className="fade-in-up">
      <PageHeader title={tab} subtitle="Configuración restaurante" />

      {tab === "Sala del restaurante" && (
        <CrudPage title="sala" endpoint="/api/catalogs/rooms"
          fields={[
            { name: "name", label: "Nombre", required: true },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]} />
      )}

      {tab === "Mesas del restaurante" && (
        <CrudPage title="mesa" endpoint="/api/catalogs/tables"
          fields={[
            {
              name: "room_id", label: "Sala", type: "select", required: true,
              options: rooms.map((r) => ({ value: r.id, label: r.name })),
            },
            { name: "number", label: "Número", type: "number", required: true, immutable: true },
            { name: "seats", label: "Asientos", type: "number", required: true },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]} />
      )}

      {/* §1.7.3: catálogo únicamente visual, no permite acciones */}
      {tab === "Etapas de reserva" && (
        <div className="max-w-md">
          <p className="mb-3 text-sm text-text-muted">
            Etapas por las que puede pasar una reserva. Este submódulo es únicamente visual.
          </p>
          <Table headers={["Etapa"]} empty={false}>
            {["Reservado", "Confirmado", "Cancelado"].map((e) => (
              <tr key={e}>
                <td className="px-4 py-2.5">
                  <Badge color={e === "Reservado" ? "amber" : e === "Confirmado" ? "emerald" : "rose"}>
                    {e}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {tab === "Horarios" && (
        <EnConstruccion titulo="Horarios de trabajadores"
          nota="Calendario día/semana/mes con asignación de franjas a usuarios (manual §1.7.4) — Fase 3 del roadmap." />
      )}
      {tab === "Objetivos" && (
        <EnConstruccion titulo="Objetivos de ventas"
          nota="Metas diaria, semanal y mensual visibles en el Dashboard (manual §1.7.5) — Fase 3 del roadmap." />
      )}
      {tab === "Prioridad del menú" && (
        <EnConstruccion titulo="Prioridad del menú"
          nota="Categorías favoritas por día de la semana (manual §1.7.6) — Fase 3 del roadmap. El backend ya la respeta al servir el menú." />
      )}

      {tab === "Métodos de pago" && <PaymentMethodsTab />}

      {tab === "Denominación de moneda" && (
        <CrudPage title="denominación" endpoint="/api/catalogs/denominations"
          fields={[
            {
              name: "value", label: "Valor", type: "number", required: true,
              render: (r) => cop.format(Number(r.value)),
            },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]} />
      )}

      {tab === "Bancos para transferencia" && (
        <CrudPage title="banco" endpoint="/api/catalogs/banks"
          fields={[
            { name: "name", label: "Nombre", required: true },
            { name: "is_active", label: "Estado", type: "checkbox" },
          ]} />
      )}

      {tab === "Catálogo de impuestos" && (
        <EnConstruccion titulo="Catálogo de impuestos"
          nota="Submódulo nuevo (no documentado en el manual v18) — pendiente de definición de requisitos." />
      )}
    </div>
  );
}

/* ───────── Métodos de pago (§1.7.7): solo estado + bancos ───────── */
function PaymentMethodsTab() {
  const toast = useToast();
  const [methods, setMethods] = useState<{
    id: number; name: string; is_active: boolean; is_legacy: boolean; bank_ids: number[];
  }[]>([]);
  const [banks, setBanks] = useState<{ id: number; name: string }[]>([]);

  const load = useCallback(() => {
    api<typeof methods>("/api/settings/payment-methods").then(setMethods).catch(() => {});
    api<typeof banks>("/api/catalogs/banks").then(setBanks).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function save(m: (typeof methods)[number], changes: Partial<(typeof methods)[number]>) {
    try {
      await api(`/api/settings/payment-methods/${m.id}`, {
        method: "PUT",
        body: {
          is_active: changes.is_active ?? m.is_active,
          bank_ids: changes.bank_ids ?? m.bank_ids,
        },
      });
      toast("success", "Método de pago actualizado correctamente");
      load();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error al actualizar");
    }
  }

  return (
    <div className="max-w-2xl space-y-3">
      {methods.map((m) => (
        <div key={m.id} className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{m.name}</p>
              {m.is_legacy && <Badge color="gray">Fase 4 (no documentado en el manual)</Badge>}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={m.is_active}
                onChange={(e) => save(m, { is_active: e.target.checked })}
                className="h-4 w-4 accent-[hsl(217_91%_60%)]" />
              {m.is_active ? "Activo" : "Inactivo"}
            </label>
          </div>
          {m.name === "TRANSFERENCIA" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {banks.map((b) => {
                const assoc = m.bank_ids.includes(b.id);
                return (
                  <button key={b.id}
                    onClick={() => save(m, {
                      bank_ids: assoc
                        ? m.bank_ids.filter((x) => x !== b.id)
                        : [...m.bank_ids, b.id],
                    })}
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      assoc ? "bg-accent-blue/25 font-medium text-accent-blue"
                        : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
                    }`}>
                    {b.name}
                  </button>
                );
              })}
              {banks.length === 0 && (
                <p className="text-xs text-text-muted">
                  Cree bancos en la pestaña "Bancos para transferencia".
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
