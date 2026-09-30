// Email de confirmação de conta. HTML com estilos inline (é o que os clientes de email aceitam),
// seguindo a paleta do Clutch, e uma versão em texto puro para quem não carrega HTML.

type VerifyEmailData = { name: string; link: string };

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function verifyEmailTemplate({ name, link }: VerifyEmailData) {
  const firstName = escapeHtml(name.split(" ")[0]);
  const safeLink = escapeHtml(link);

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f9f7f5;font-family:Arial,Helvetica,sans-serif;color:#1d1d1e;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9f7f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
            <tr>
              <td align="center" style="padding-bottom:24px;font-family:Georgia,'Times New Roman',serif;font-size:40px;font-weight:900;letter-spacing:-1px;color:#1d1d1e;">
                clutch<span style="font-size:16px;">.</span>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border-radius:16px;padding:32px 28px;">
                <h1 style="margin:0 0 12px;font-size:22px;">Falta pouco, ${firstName}!</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#444444;">
                  Confirme seu email para ativar sua conta no Clutch e começar a achar spots e marcar sessões com a sua crew.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="border-radius:999px;background:#a31e21;">
                      <a href="${safeLink}" style="display:block;padding:14px 24px;font-size:14px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#f9f7f5;text-decoration:none;">Confirmar email</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#777777;">
                  O link vale por 24 horas. Se o botão não funcionar, copie e cole este endereço no navegador:<br />
                  <a href="${safeLink}" style="color:#620a1a;word-break:break-all;">${safeLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:20px;font-size:12px;color:#777777;">
                Se você não criou uma conta no Clutch, ignore este email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `Falta pouco, ${name.split(" ")[0]}!

Confirme seu email para ativar sua conta no Clutch:
${link}

O link vale por 24 horas. Se você não criou uma conta no Clutch, ignore este email.`;

  return { subject: "Confirme seu email no Clutch", html, text };
}
