/**
 * Descargar servicio de impresión (Gestión de cajas §1.8.5) — réplica de
 * Polaris (blank_descarga_servicios): lista los instaladores disponibles en
 * el servidor con su metadata (nombre, tamaño, tipo, fecha) y permite
 * descargarlos. Arriba: número de archivos, espacio total usado y Actualizar.
 * El servicio descargado es el AgoraOps Print Service (ver print-service/).
 */
import { useCallback, useEffect, useState } from "react";
import { Download, FileArchive, Inbox, RefreshCw } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Button, fmtDateTime, Loader, useToast } from "./ui";

interface InstallerFile {
  name: string;
  size: number;
  type: string;
  date: string;
  url: string;
}
interface Listing {
  files: InstallerFile[];
  count: number;
  totalSize: number;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

export function DownloadPrintService() {
  const toast = useToast();
  const [data, setData] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api<Listing>("/api/cash/print-service")
      .then(setData)
      .catch((e) => toast("error", e instanceof ApiError ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, [toast]);
  useEffect(load, [load]);

  return (
    <div className="fade-in-up">
      {/* Stats + Actualizar */}
      <div className="glass mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl px-6 py-4">
        <div className="flex gap-10">
          <div className="text-center">
            <p className="text-2xl font-bold text-accent-blue">{data?.count ?? 0}</p>
            <p className="text-xs text-text-muted">Archivos disponibles</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-accent-blue">{fmtSize(data?.totalSize ?? 0)}</p>
            <p className="text-xs text-text-muted">Espacio total usado</p>
          </div>
        </div>
        <Button variant="ghost" onClick={load}>
          <RefreshCw size={15} className="-mt-0.5 mr-1.5 inline" /> Actualizar
        </Button>
      </div>

      {loading ? (
        <Loader label="Cargando archivos" />
      ) : (data?.files.length ?? 0) === 0 ? (
        <div className="glass grid place-items-center rounded-2xl py-14 text-text-muted">
          <Inbox size={32} className="mb-2 opacity-60" />
          <p className="text-sm">No hay registros para mostrar</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {data!.files.map((f) => (
            <div key={f.name} className="glass flex flex-col items-center rounded-2xl p-5 text-center">
              <FileArchive size={40} className="mb-2 text-accent-orange" />
              <p className="mb-3 break-all text-sm font-semibold">{f.name}</p>
              <dl className="mb-4 w-full space-y-1 text-xs text-text-secondary">
                <div className="flex justify-between"><dt>Tamaño:</dt><dd className="font-medium">{fmtSize(f.size)}</dd></div>
                <div className="flex justify-between"><dt>Tipo:</dt><dd className="font-medium">{f.type}</dd></div>
                <div className="flex justify-between"><dt>Fecha:</dt><dd className="font-medium">{fmtDateTime(f.date)}</dd></div>
              </dl>
              <a href={f.url} download target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-accent-blue px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
                <Download size={15} /> Descargar
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
