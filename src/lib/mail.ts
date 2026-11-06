import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";

type Mail = {
  to: { email: string; name: string };
  subject: string;
  html: string;
  text: string;
};

// Conexão com o servidor de email, criada só no primeiro envio
let transporter: Transporter | null = null;

function getTransporter() {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // Porta 465: a conexão já começa criptografada (TLS). Na 587 ela é criptografada logo depois.
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    // Não deixa a requisição presa se o servidor de email demorar
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

// Envia um email pelo SMTP do Gmail do projeto. O email sai da própria conta do Gmail, então os
// provedores não o marcam como suspeito (o Brevo, que enviava "em nome" de um @gmail.com, bloqueou a conta).
// Sem SMTP_USER/SMTP_PASS (ex.: no seu computador), o email não é enviado: o conteúdo aparece no terminal.
export async function sendMail(mail: Mail) {
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.log(`\n📧 [email simulado] Para: ${mail.to.email}\nAssunto: ${mail.subject}\n\n${mail.text}\n`);
    return;
  }

  await getTransporter().sendMail({
    from: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_EMAIL || env.SMTP_USER },
    to: { name: mail.to.name, address: mail.to.email },
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
}
