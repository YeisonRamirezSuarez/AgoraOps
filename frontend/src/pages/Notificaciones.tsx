/**
 * Notificaciones — réplica del grid de Polaris (grid_notifications,
 * verificado en QA 2026-06-12) con tema AgoraOps:
 *  - 8 columnas: Número de orden, Número de mesa, Nombre del producto,
 *    Estado (VISUALIZADO / NO VISUALIZADO), Registrado, Registrado por,
 *    Actualizado, Actualizado por (vacíos mientras no se visualice).
 *  - Búsqueda rápida sobre los mismos campos que Polaris: orden, mesa,
 *    producto, estado, usuarios y las fechas en su formato interno
 *    YYYY-MM-DD (Polaris no busca el dd/mm/yyyy que muestra).
 *  - Orden ascendente (las más antiguas primero) y paginación 10/20/50.
 *  - Diferencia acordada con Polaris: tocar una fila NO VISUALIZADA la
 *    marca como vista (en Polaris el grid es solo lectura y únicamente
 *    la campana marca).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api, subscribeEvents } from "../lib/api";
import { Input, PageHeader, Table, usePagination, useToast } from "../components/ui";

interface Notification {
  id: number;
  status: string;
  is_viewed: boolean;
  created_at: string; // YYYY-MM-DD HH:MM:SS (hora del negocio)
  viewed_at: string | null;
  product_name: string | null;
  order_number: string | null;
  table_number: number | null;
  created_by_name: string | null;
  viewed_by_name: string | null;
}

/** Polaris muestra dd/mm/yyyy hh:mm:ss pero busca sobre el ISO interno. */
const fmtDateTime = (iso: string | null) => {
  if (!iso) return "";
  const [date, time] = iso.split(" ");
  return `${date.split("-").reverse().join("/")} ${time}`;
};

export default function Notificaciones() {
  const toast = useToast();
  const [rows, setRows] = useState<Notification[]>([]);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    api<Notification[]>("/api/kitchen/notifications").then(setRows).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    return subscribeEvents((e) => {
      if (e.table === "notifications") load();
    });
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((n) => {
      const estado = n.is_viewed ? "VISUALIZADO" : "NO VISUALIZADO";
      return [
        n.order_number, n.table_number, n.product_name, estado,
        n.created_at, n.created_by_name, n.viewed_at, n.viewed_by_name,
      ].join(" ").toLowerCase().includes(q);
    });
  }, [rows, search]);

  const { slice, bar, resetPage } = usePagination(filtered);

  async function view(n: Notification) {
    if (n.is_viewed) return;
    await api(`/api/kitchen/notifications/${n.id}/view`, { method: "POST" });
    toast("success", "Notificación marcada como vista");
    load();
  }

  return (
    <div className="fade-in-up">
      <PageHeader title="Notificaciones" subtitle="Restaurante" />

      <div className="relative mb-4 max-w-xs">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <Input placeholder="Búsqueda Rápida" value={search} className="!pl-9"
          onChange={(e) => { setSearch(e.target.value); resetPage(); }} />
      </div>

      <Table
        headers={["Número de orden", "Número de mesa", "Nombre del producto",
          "Estado", "Registrado", "Registrado por", "Actualizado", "Actualizado por"]}
        empty={filtered.length === 0}>
        {slice.map((n) => (
          <tr key={n.id} onClick={() => view(n)}
            className={`transition hover:bg-bg-tertiary ${
              n.is_viewed ? "" : "cursor-pointer bg-accent-blue/5"
            }`}>
            <td className="px-4 py-2.5">{n.order_number ?? ""}</td>
            <td className="px-4 py-2.5">{n.table_number ?? ""}</td>
            <td className="px-4 py-2.5 font-medium">{n.product_name ?? ""}</td>
            <td className="px-4 py-2.5">
              <span className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-[10px] font-bold tracking-wide ${
                n.is_viewed
                  ? "bg-accent-emerald/15 text-accent-emerald"
                  : "bg-accent-amber/15 text-accent-amber"
              }`}>
                {n.is_viewed ? "VISUALIZADO" : "NO VISUALIZADO"}
              </span>
            </td>
            <td className="whitespace-nowrap px-4 py-2.5">{fmtDateTime(n.created_at)}</td>
            <td className="px-4 py-2.5">{n.created_by_name ?? ""}</td>
            <td className="whitespace-nowrap px-4 py-2.5">{fmtDateTime(n.viewed_at)}</td>
            <td className="px-4 py-2.5">{n.viewed_by_name ?? ""}</td>
          </tr>
        ))}
      </Table>
      {bar}
    </div>
  );
}
