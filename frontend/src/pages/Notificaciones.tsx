/**
 * Notificaciones — manual §1.6.7: productos Listo/Cancelado desde el
 * Monitor de Cocina, con estado visualizado, quién cambió el estado y
 * quién la vio. Tocar la notificación la marca como vista.
 */
import { useCallback, useEffect, useState } from "react";
import { api, subscribeEvents } from "../lib/api";
import { Badge, PageHeader, Table, usePagination, useToast } from "../components/ui";

interface Notification {
  id: number; status: string; is_viewed: boolean; created_at: string;
  product_name: string | null; order_number: string | null;
  table_number: number | null; created_by_name: string | null;
  viewed_by_name: string | null;
}

export default function Notificaciones() {
  const toast = useToast();
  const [rows, setRows] = useState<Notification[]>([]);

  const load = useCallback(() => {
    api<Notification[]>("/api/kitchen/notifications").then(setRows).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    return subscribeEvents((e) => {
      if (e.table === "notifications") load();
    });
  }, [load]);

  const { slice, bar } = usePagination(rows);

  async function view(n: Notification) {
    if (n.is_viewed) return;
    await api(`/api/kitchen/notifications/${n.id}/view`, { method: "POST" });
    toast("success", "Notificación marcada como vista");
    load();
  }

  return (
    <div className="fade-in-up">
      <PageHeader title="Notificaciones"
        subtitle="Productos marcados Listo o Cancelado desde el Monitor de Cocina" />
      <Table headers={["Producto", "Orden", "Mesa", "Estado", "Visualizada", "Creada por", "Vista por", "Fecha"]}
        empty={rows.length === 0}>
        {slice.map((n) => (
          <tr key={n.id} onClick={() => view(n)}
            className={`cursor-pointer transition hover:bg-bg-tertiary/40 ${!n.is_viewed ? "bg-accent-blue/5" : ""}`}>
            <td className="px-4 py-2 font-medium">{n.product_name ?? "—"}</td>
            <td className="px-4 py-2">#{n.order_number ?? "—"}</td>
            <td className="px-4 py-2">{n.table_number ? `Mesa ${n.table_number}` : "—"}</td>
            <td className="px-4 py-2">
              <Badge color={n.status === "Listo" ? "emerald" : "rose"}>{n.status}</Badge>
            </td>
            <td className="px-4 py-2">
              <Badge color={n.is_viewed ? "gray" : "blue"}>
                {n.is_viewed ? "Sí visualizado" : "No visualizado"}
              </Badge>
            </td>
            <td className="px-4 py-2">{n.created_by_name ?? "—"}</td>
            <td className="px-4 py-2">{n.viewed_by_name ?? "—"}</td>
            <td className="px-4 py-2 text-xs">{new Date(n.created_at).toLocaleString("es-CO")}</td>
          </tr>
        ))}
      </Table>

      {bar}
    </div>
  );
}
