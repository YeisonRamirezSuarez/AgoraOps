/**
 * Envío de correo (recuperación de contraseña).
 *  - Si hay SMTP configurado (SMTP_HOST/USER/PASS), envía vía nodemailer.
 *  - Si NO hay SMTP, cae a "modo dev": registra el enlace en consola y NO
 *    falla, para que el flujo sea probable en local/staging sin servidor SMTP.
 * El correo nunca revela datos sensibles; el enlace lleva el token de un solo
 * uso que vence en 1 hora.
 */
import nodemailer from "nodemailer";
import { config } from "../config.js";

const smtpReady = Boolean(config.mail.host && config.mail.user && config.mail.pass);

const transporter = smtpReady
  ? nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure, // true => 465 (SSL); false => 587 (STARTTLS)
      auth: { user: config.mail.user, pass: config.mail.pass },
    })
  : null;

function resetEmailHtml(fullName: string, resetUrl: string): string {
  return `
  <div style="margin:0;padding:24px;background:#f6f7f9;font-family:'Segoe UI',Arial,sans-serif;color:#22303f">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6eaef">
      <div style="background:linear-gradient(90deg,#2ec7fa 0%,#0d77d3 100%);padding:24px;text-align:center">
        <span style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.01em">AgoraOps</span>
      </div>
      <div style="padding:28px 28px 32px">
        <h1 style="margin:0 0 12px;font-size:18px">Restablecer tu contraseña</h1>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#42505f">
          Hola ${fullName || ""}, recibimos una solicitud para restablecer la contraseña de tu cuenta AgoraOps.
        </p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#42505f">
          Pulsa el botón para crear una nueva contraseña. El enlace vence en 1 hora.
        </p>
        <p style="text-align:center;margin:0 0 22px">
          <a href="${resetUrl}" style="display:inline-block;background:#0d77d3;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:10px">
            Restablecer contraseña
          </a>
        </p>
        <p style="margin:0 0 6px;font-size:12px;color:#7f8c8d">Si el botón no funciona, copia y pega este enlace:</p>
        <p style="margin:0 0 18px;font-size:12px;word-break:break-all"><a href="${resetUrl}" style="color:#0d77d3">${resetUrl}</a></p>
        <p style="margin:0;font-size:12px;color:#7f8c8d">
          Si no solicitaste este cambio, puedes ignorar este correo: tu contraseña no se modificará.
        </p>
      </div>
    </div>
  </div>`;
}

export async function sendPasswordResetEmail(
  to: string,
  fullName: string,
  resetUrl: string,
): Promise<void> {
  if (!transporter) {
    // Modo dev: sin SMTP, deja el enlace en el log del servidor.
    console.log(
      `[mailer] SMTP no configurado. Enlace de restablecimiento para ${to}:\n  ${resetUrl}`,
    );
    return;
  }
  await transporter.sendMail({
    from: config.mail.from,
    to,
    subject: "Restablecer tu contraseña — AgoraOps",
    html: resetEmailHtml(fullName, resetUrl),
    text:
      `Hola ${fullName || ""}, para restablecer tu contraseña de AgoraOps abre este enlace ` +
      `(vence en 1 hora):\n${resetUrl}\n\nSi no lo solicitaste, ignora este correo.`,
  });
}

/* ─────────────────── Correo de apertura del establecimiento ─────────────────── */

export interface TenantWelcomeEmail {
  to: string;
  /** Nombre del administrador del establecimiento. */
  fullName: string;
  /** Nombre comercial del negocio. */
  businessName: string;
  username: string;
  tempPassword: string;
  /** Enlace de ingreso al frontend (login). */
  loginUrl: string;
  /** Logo de la empresa AgoraOps (URL pública, PNG). */
  brandLogoUrl: string;
  /** Logo del establecimiento, si se cargó al crearlo. */
  tenantLogoUrl?: string | null;
}

/** Escapa texto para insertarlo de forma segura en el HTML del correo. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SETUP_STEPS: [string, string][] = [
  ["Ingresa con tus credenciales", "Usa el usuario y la contraseña temporal de abajo; el sistema te pedirá cambiarla en tu primer ingreso."],
  ["Completa los datos del negocio", "En Configuración → Restaurante: logo, dirección, NIT/RUC e impuestos."],
  ["Revisa métodos de pago y caja", "Confirma los métodos de pago y la caja en Configuración."],
  ["Crea tu carta", "Registra categorías y productos en la sección Productos."],
  ["Organiza sala y mesas", "Ajusta tu sala y el número de mesas en Mesas."],
  ["Suma a tu equipo", "Crea los usuarios de meseros y cocina en Seguridad → Usuarios (el usuario se genera automáticamente)."],
];

function welcomeEmailHtml(d: TenantWelcomeEmail): string {
  const steps = SETUP_STEPS.map(
    ([title, body], i) => `
      <tr>
        <td style="padding:0 0 14px;vertical-align:top;width:34px">
          <div style="width:26px;height:26px;border-radius:50%;background:#0d77d3;color:#fff;font-weight:800;font-size:13px;text-align:center;line-height:26px">${i + 1}</div>
        </td>
        <td style="padding:0 0 14px;vertical-align:top">
          <p style="margin:0;font-size:14px;font-weight:700;color:#22303f">${esc(title)}</p>
          <p style="margin:2px 0 0;font-size:13px;line-height:1.5;color:#5b6770">${esc(body)}</p>
        </td>
      </tr>`,
  ).join("");

  const tenantLogo = d.tenantLogoUrl
    ? `<img src="${esc(d.tenantLogoUrl)}" alt="${esc(d.businessName)}" style="max-height:64px;max-width:200px;border-radius:10px;margin:0 auto 6px;display:block" />`
    : "";

  const cred = (label: string, value: string) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #eef1f4">
        <span style="font-size:12px;color:#7f8c8d">${esc(label)}</span><br/>
        <span style="font-size:15px;font-weight:700;font-family:'Courier New',monospace;color:#22303f">${esc(value)}</span>
      </td>
    </tr>`;

  return `
  <div style="margin:0;padding:24px;background:#f6f7f9;font-family:'Segoe UI',Arial,sans-serif;color:#22303f">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6eaef">
      <div style="background:linear-gradient(90deg,#2ec7fa 0%,#0d77d3 100%);padding:22px 24px;text-align:center">
        <img src="${esc(d.brandLogoUrl)}" alt="AgoraOps" width="40" height="40" style="display:inline-block;vertical-align:middle;border-radius:9px;background:#fff" />
        <span style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.01em;vertical-align:middle;margin-left:10px">AgoraOps</span>
      </div>
      <div style="padding:28px 28px 32px">
        ${tenantLogo}
        <h1 style="margin:0 0 6px;font-size:20px;text-align:center">¡Tu establecimiento está listo! 🎉</h1>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#42505f;text-align:center">
          Hola ${esc(d.fullName)}, <strong>${esc(d.businessName)}</strong> ya quedó creado en AgoraOps.
          Sigue estos pasos para ponerlo a punto.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 4px">
          ${steps}
        </table>

        <p style="margin:8px 0 10px;font-size:13px;font-weight:700;color:#22303f">Tus credenciales de acceso</p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #eef1f4;border-radius:12px;overflow:hidden;margin:0 0 8px">
          ${cred("Usuario", d.username)}
          ${cred("Contraseña temporal", d.tempPassword)}
          ${cred("Correo", d.to)}
        </table>
        <p style="margin:0 0 22px;font-size:12px;color:#7f8c8d">
          Por seguridad, el sistema te pedirá cambiar la contraseña en tu primer ingreso.
        </p>

        <p style="text-align:center;margin:0 0 22px">
          <a href="${esc(d.loginUrl)}" style="display:inline-block;background:#0d77d3;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:10px">
            Ingresar a AgoraOps
          </a>
        </p>
        <p style="margin:0 0 4px;font-size:12px;color:#7f8c8d">Si el botón no funciona, copia y pega este enlace:</p>
        <p style="margin:0;font-size:12px;word-break:break-all"><a href="${esc(d.loginUrl)}" style="color:#0d77d3">${esc(d.loginUrl)}</a></p>
      </div>
    </div>
  </div>`;
}

/**
 * Envía el correo de apertura del establecimiento al administrador, con el
 * paso a paso de configuración, el enlace al frontend, las credenciales y los
 * logos (AgoraOps + el del negocio si se cargó). Sin SMTP cae a modo dev (log).
 */
export async function sendTenantWelcomeEmail(d: TenantWelcomeEmail): Promise<void> {
  if (!transporter) {
    console.log(
      `[mailer] SMTP no configurado. Bienvenida para ${d.to} (usuario: ${d.username}, clave: ${d.tempPassword}, login: ${d.loginUrl})`,
    );
    return;
  }
  await transporter.sendMail({
    from: config.mail.from,
    to: d.to,
    subject: `¡Bienvenido a AgoraOps! — ${d.businessName}`,
    html: welcomeEmailHtml(d),
    text:
      `Hola ${d.fullName}, tu establecimiento "${d.businessName}" ya está creado en AgoraOps.\n\n` +
      `Credenciales de acceso:\n  Usuario: ${d.username}\n  Contraseña temporal: ${d.tempPassword}\n  Correo: ${d.to}\n` +
      `(Deberás cambiar la contraseña en tu primer ingreso.)\n\n` +
      `Ingresa aquí: ${d.loginUrl}\n\n` +
      `Primeros pasos:\n` +
      SETUP_STEPS.map(([t, b], i) => `  ${i + 1}. ${t}: ${b}`).join("\n"),
  });
}
