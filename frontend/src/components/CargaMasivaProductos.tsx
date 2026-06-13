/**
 * Carga masiva de productos por Excel (§1.10.2) — réplica del módulo de
 * Polaris. El navegador lee el XLS/XLSX (SheetJS), envía las filas como JSON
 * a POST /api/products/bulk y muestra el reporte por fila. La plantilla se
 * genera en el cliente con los mismos encabezados que usa Polaris.
 */
import { useRef, useState } from "react";
import {
  AlertCircle, CheckCircle2, Download, FileSpreadsheet, UploadCloud, X,
} from "lucide-react";
import * as XLSX from "xlsx";
import { api, ApiError } from "../lib/api";
import { Button, Select, useToast } from "./ui";

// Encabezados exactos de la plantilla de Polaris (Carga_masiva_productos.xlsx).
const HEADERS = [
  "Categoría", "NombreProducto", "PrecioVenta", "Cocina", "Estado", "Descripción",
  "Inventariable", "CantidadInicial", "CantidadMinima",
  "NombreImpuesto1", "ValorImpuesto1", "NombreImpuesto2", "ValorImpuesto2",
  "NombreImpuesto3", "ValorImpuesto3",
];

interface BulkResult {
  operation: string; total: number; created: number; updated: number;
  skipped: number; errors: { row: number; name: string; message: string }[];
}

export function CargaMasivaProductos() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [operation, setOperation] = useState<"create" | "update">("create");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  function descargarPlantilla() {
    const ws = XLSX.utils.aoa_to_sheet([HEADERS]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
    XLSX.writeFile(wb, "Carga_masiva_productos.xlsx");
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) {
      toast("error", "Solo se permiten archivos con extensión XLS o XLSX.");
      return;
    }
    setFile(f);
    setResult(null);
  }

  async function aceptar() {
    if (!file) { toast("error", "Adjunte un archivo primero."); return; }
    setProcessing(true);
    setResult(null);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (rows.length === 0) {
        toast("error", "El archivo no tiene filas con datos.");
        return;
      }
      const res = await api<BulkResult>("/api/products/bulk", {
        method: "POST", body: { operation, rows },
      });
      setResult(res);
      const okCount = res.created + res.updated;
      if (res.errors.length === 0) {
        toast("success", `Carga completada: ${okCount} producto(s) procesado(s).`);
      } else {
        toast("warning", `Procesados ${okCount}, con ${res.errors.length} error(es). Revise el detalle.`);
      }
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No se pudo procesar el archivo.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="fade-in-up max-w-3xl space-y-5">
      {/* Tarjeta de carga */}
      <div className="glass rounded-2xl p-6">
        <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
          <p className="text-sm font-semibold leading-snug">
            Solo se permiten archivos con extensión <span className="text-accent-blue">XLS, XLSX</span>
          </p>
          <div className="space-y-3">
            <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])} />
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <UploadCloud size={15} className="-mt-0.5 mr-1 inline" /> Cargar…
            </Button>

            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              className="grid cursor-pointer place-items-center rounded-xl border border-dashed border-border-medium py-8 text-center text-text-muted transition hover:bg-bg-tertiary/50">
              {file ? (
                <span className="flex items-center gap-2 text-text-primary">
                  <FileSpreadsheet size={18} className="text-accent-emerald" /> {file.name}
                  <button type="button" aria-label="Quitar archivo"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFile(null); setResult(null); }}
                    className="rounded p-0.5 hover:text-accent-rose"><X size={15} /></button>
                </span>
              ) : (
                <span className="flex flex-col items-center gap-1">
                  <UploadCloud size={24} />
                  Arrastre un archivo aquí
                </span>
              )}
            </label>
          </div>

          <p className="self-center text-sm font-semibold">Operación</p>
          <Select value={operation} onChange={(e) => setOperation(e.target.value as "create" | "update")}
            className="sm:!w-64">
            <option value="create">CREAR PRODUCTOS</option>
            <option value="update">ACTUALIZAR PRODUCTOS</option>
          </Select>
        </div>

        <div className="mt-6 flex justify-center">
          <Button onClick={aceptar} disabled={processing || !file}>
            <CheckCircle2 size={16} className="-mt-0.5 mr-1 inline" />
            {processing ? "Procesando…" : "Aceptar"}
          </Button>
        </div>

        <p className="mt-4 text-center text-sm text-text-secondary">
          Por favor descargue{" "}
          <button onClick={descargarPlantilla}
            className="font-semibold text-accent-blue underline-offset-2 hover:underline">
            <Download size={13} className="-mt-0.5 mr-0.5 inline" />AQUÍ
          </button>{" "}
          el formato en Excel para registrar la información de los productos.
        </p>
      </div>

      {/* Ayuda de formato */}
      <div className="rounded-xl border border-border-subtle bg-bg-tertiary/40 px-4 py-3 text-xs text-text-secondary">
        <p className="mb-1 font-semibold text-text-primary">Notas del formato</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li><b>Cocina</b>, <b>Estado</b>, <b>Inventariable</b>: use <i>Sí / No</i> (también valen SI, S, 1, X, Activo). Si <b>Estado</b> va vacío se asume <b>Activo</b>.</li>
          <li><b>Actualizar</b> empareja el producto por <b>NombreProducto</b> dentro de su <b>Categoría</b>.</li>
          <li>Si la <b>Categoría</b> no existe, se crea automáticamente.</li>
          <li><b>CantidadInicial</b> y <b>CantidadMinima</b> crean el consumible de inventario cuando <b>Inventariable = Sí</b>.</li>
          <li>Las columnas de <b>Impuestos</b> se mantienen en la plantilla pero por ahora no se procesan.</li>
        </ul>
      </div>

      {/* Resultado */}
      {result && (
        <div className="glass rounded-2xl p-5">
          <h3 className="mb-3 font-bold">Resultado de la carga</h3>
          <div className="mb-4 flex flex-wrap gap-2 text-sm">
            <span className="rounded-lg bg-accent-emerald/15 px-3 py-1 font-medium text-accent-emerald">
              {result.operation === "update" ? "Actualizados" : "Creados"}: {result.created + result.updated}
            </span>
            {result.skipped > 0 && (
              <span className="rounded-lg bg-bg-tertiary px-3 py-1 text-text-secondary">
                Filas vacías omitidas: {result.skipped}
              </span>
            )}
            <span className={`rounded-lg px-3 py-1 font-medium ${
              result.errors.length ? "bg-accent-rose/15 text-accent-rose" : "bg-bg-tertiary text-text-secondary"
            }`}>
              Errores: {result.errors.length}
            </span>
          </div>

          {result.errors.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-accent-emerald">
              <CheckCircle2 size={16} /> Todas las filas se procesaron correctamente.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border-subtle">
              <table className="w-full text-sm">
                <thead className="bg-bg-tertiary/60 text-left text-xs uppercase tracking-wide text-text-secondary">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Fila</th>
                    <th className="px-4 py-2.5 font-medium">Producto</th>
                    <th className="px-4 py-2.5 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle/60">
                  {result.errors.map((er, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-text-muted">{er.row}</td>
                      <td className="px-4 py-2 font-medium">{er.name}</td>
                      <td className="px-4 py-2 text-accent-rose">
                        <AlertCircle size={13} className="-mt-0.5 mr-1 inline" />{er.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
