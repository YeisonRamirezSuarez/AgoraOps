# AgoraOps Print Service

Servicio local de impresión para AgoraOps (POS). Se instala en el **PC de la caja**
y hace de puente entre la web app (navegador) y las **impresoras físicas**, porque el
navegador no puede hablar directo con impresoras USB/serial ni abrir el cajón monedero.

Réplica del contrato de Polaris (`PolarisFoodXprinterService`): corre en
**`http://localhost:9090`**.

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/health` | Estado del servicio. |
| GET  | `/printer/impresoras` | Impresoras detectadas en el equipo (puebla el desplegable de *Configuración de impresoras*). |
| POST | `/synchronize/restaurant` | Recibe y guarda la configuración del restaurante/impresoras. |
| POST | `/printer/print` | Imprime una tirilla ESC/POS. |
| POST | `/printer/open-drawer` | Abre el cajón monedero. |

### Cuerpo de `/printer/print`
```jsonc
{
  "connectionType": "USB" | "RED" | "BLUETOOTH",
  "printerName": "POS-80C",      // USB/Bluetooth (impresora instalada en el SO)
  "ip": "192.168.1.50",          // RED
  "port": 9100,                  // RED (por defecto 9100)
  "text": "Texto de la tirilla", // o…
  "raw": "<base64 ESC/POS>",     // …ESC/POS ya armado
  "openDrawer": true              // pulso al cajón al final
}
```

## Conexiones soportadas
- **USB**: impresora instalada en Windows; se envía RAW al spooler vía `winspool` (P/Invoke, sin módulos nativos).
- **Red (IP:9100)**: socket TCP crudo a la impresora.
- **Bluetooth**: si está emparejada e instalada como impresora de Windows, entra por la ruta USB. (Puerto COM serial: pendiente.)
- **Abrir cajón**: comando ESC/POS `ESC p 0` por el mismo canal de la impresora.

## Desarrollo
```bash
npm install
npm start          # corre en http://localhost:9090
```

## Empaquetar a .exe (Windows)
```bash
npm install
npm run build:win  # genera dist/AgoraOpsPrintService.exe (pkg)
```
El `.exe` resultante es lo que se comprime en ZIP y se sube a *Descargar servicio de impresión*.

## Notas
- macOS/Linux: el listado usa CUPS (`lpstat -e`) y la impresión RAW usa `lp -o raw`.
- Los navegadores modernos permiten que una página `https://` llame a `http://localhost`
  (excepción de *localhost* como origen seguro), por eso la web app puede consumir el servicio.
