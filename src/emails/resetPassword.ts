// Email de "esqueci minha senha", no mesmo visual do email de confirmação de conta.

type ResetPasswordData = { name: string; link: string };

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function resetPasswordTemplate({ name, link }: ResetPasswordData) {
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
                <h1 style="margin:0 0 12px;font-size:22px;">Vamos criar uma senha nova, ${firstName}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#444444;">
                  Recebemos um pedido para redefinir a senha da sua conta no Clutch. Clique no botão para escolher uma nova:
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="border-radius:999px;background:#a31e21;">
                      <a href="${safeLink}" style="display:block;padding:14px 24px;font-size:14px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#f9f7f5;text-decoration:none;">Criar nova senha</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#777777;">
                  O link vale por 1 hora e só funciona uma vez. Se o botão não funcionar, copie e cole este endereço no navegador:<br />
                  <a href="${safeLink}" style="color:#620a1a;word-break:break-all;">${safeLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:20px;font-size:12px;color:#777777;">
                Se não foi você que pediu, ignore este email: sua senha continua a mesma.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `Vamos criar uma senha nova, ${name.split(" ")[0]}

Recebemos um pedido para redefinir a senha da sua conta no Clutch.
Abra este link para escolher uma nova (vale por 1 hora e só funciona uma vez):
${link}

Se não foi você que pediu, ignore este email: sua senha continua a mesma.`;

  return { subject: "Redefinir sua senha do Clutch", html, text };
}
