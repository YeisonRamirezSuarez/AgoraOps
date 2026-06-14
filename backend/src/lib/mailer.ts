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
