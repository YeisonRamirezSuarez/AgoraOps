/**
 * Envío del buffer ESC/POS a la impresora según el tipo de conexión:
 *  - RED:        socket TCP crudo a ip:puerto (raw 9100).
 *  - USB / BLUETOOTH: impresora instalada en Windows → se envía RAW al
 *    spooler vía winspool (P/Invoke en PowerShell, sin módulos nativos,
 *    para que el .exe empaquetado con pkg funcione sin compilar nada).
 *    En macOS/Linux se usa `lp -o raw`.
 *
 * Nota Bluetooth: si la impresora BT está emparejada e instalada como
 * impresora de Windows, entra por la ruta USB/spooler. Si solo expone un
 * puerto COM serial, queda pendiente (TODO) para una versión posterior.
 */
"use strict";

const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");

/** Imprime por red (raw 9100). */
function printNetwork(ip, port, buffer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(8000);
    socket.once("error", reject);
    socket.once("timeout", () => { socket.destroy(); reject(new Error("Tiempo de espera agotado con la impresora de red")); });
    socket.connect(port || 9100, ip, () => {
      socket.write(buffer, () => socket.end(() => resolve()));
    });
  });
}

/** Envía RAW al spooler de Windows (winspool WritePrinter) vía PowerShell. */
function printWindowsRaw(printerName, buffer) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `agoraops_print_${Date.now()}.bin`);
    fs.writeFileSync(tmp, buffer);
    // P/Invoke a winspool.drv: OpenPrinter → StartDocPrinter (RAW) → WritePrinter.
    const ps = `
$ErrorActionPreference='Stop'
$sig=@'
using System;using System.IO;using System.Runtime.InteropServices;
public class RawPrinter{
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
 public struct DOCINFO{[MarshalAs(UnmanagedType.LPWStr)]public string pDocName;[MarshalAs(UnmanagedType.LPWStr)]public string pOutputFile;[MarshalAs(UnmanagedType.LPWStr)]public string pDataType;}
 [DllImport("winspool.Drv",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool OpenPrinter(string p,out IntPtr h,IntPtr d);
 [DllImport("winspool.Drv",SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
 [DllImport("winspool.Drv",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool StartDocPrinter(IntPtr h,int l,ref DOCINFO di);
 [DllImport("winspool.Drv",SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
 [DllImport("winspool.Drv",SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
 [DllImport("winspool.Drv",SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
 [DllImport("winspool.Drv",SetLastError=true)] public static extern bool WritePrinter(IntPtr h,byte[] b,int n,out int w);
 public static void Send(string printer,string file){
  byte[] bytes=File.ReadAllBytes(file);IntPtr hp;
  if(!OpenPrinter(printer,out hp,IntPtr.Zero)) throw new Exception("OpenPrinter falló");
  try{ DOCINFO di=new DOCINFO();di.pDocName="AgoraOps";di.pDataType="RAW";
   if(!StartDocPrinter(hp,1,ref di)) throw new Exception("StartDocPrinter falló");
   StartPagePrinter(hp);int w;WritePrinter(hp,bytes,bytes.Length,out w);EndPagePrinter(hp);EndDocPrinter(hp);
  } finally { ClosePrinter(hp); }
 }
}
'@
Add-Type -TypeDefinition $sig
[RawPrinter]::Send(${JSON.stringify(printerName)}, ${JSON.stringify(tmp)})
`;
    execFile("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { timeout: 15000, windowsHide: true },
      (err, _stdout, stderr) => {
        fs.unlink(tmp, () => {});
        if (err) reject(new Error(stderr || err.message)); else resolve();
      });
  });
}

/** Imprime RAW por CUPS (macOS/Linux). */
function printUnixRaw(printerName, buffer) {
  return new Promise((resolve, reject) => {
    const child = execFile("lp", ["-d", printerName, "-o", "raw"],
      { timeout: 15000 }, (err, _o, stderr) => err ? reject(new Error(stderr || err.message)) : resolve());
    child.stdin.end(buffer);
  });
}

/**
 * Despacha el trabajo según el tipo de conexión.
 * @param {{connectionType:string, printerName?:string, ip?:string, port?:number}} target
 * @param {Buffer} buffer
 */
async function sendToPrinter(target, buffer) {
  const type = String(target.connectionType || "").toUpperCase();
  if (type === "RED" || type === "ETHERNET" || type === "NETWORK") {
    if (!target.ip) throw new Error("Falta la IP de la impresora de red");
    return printNetwork(target.ip, target.port, buffer);
  }
  // USB / BLUETOOTH (impresora instalada en el SO)
  if (!target.printerName) throw new Error("Falta el nombre de la impresora");
  return process.platform === "win32"
    ? printWindowsRaw(target.printerName, buffer)
    : printUnixRaw(target.printerName, buffer);
}

module.exports = { sendToPrinter };
