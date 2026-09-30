import { env } from "../config/env";

type Mail = {
  to: { email: string; name: string };
  subject: string;
  html: string;
  text: string;
};

// Envia um email pela API do Brevo (HTTPS). Sem BREVO_API_KEY configurada (ex.: no seu computador),
// o email não é enviado: o conteúdo em texto aparece no terminal, com o link para testar.
export async function sendMail(mail: Mail) {
  if (!env.BREVO_API_KEY) {
    console.log(`\n📧 [email simulado] Para: ${mail.to.email}\nAssunto: ${mail.subject}\n\n${mail.text}\n`);
    return;
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM_EMAIL, name: env.MAIL_FROM_NAME },
      to: [mail.to],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Brevo recusou o envio (${response.status}): ${await response.text()}`);
  }
}
