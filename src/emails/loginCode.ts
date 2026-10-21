// Email com o código de 6 dígitos pedido a cada login (depois que a senha confere).
// Mesmo visual do email de confirmação de conta.

type LoginCodeData = { name: string; code: string };

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function loginCodeTemplate({ name, code }: LoginCodeData) {
  const firstName = escapeHtml(name.split(" ")[0]);

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
                <h1 style="margin:0 0 12px;font-size:22px;">Oi, ${firstName}!</h1>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#444444;">
                  Alguém acabou de entrar na sua conta do Clutch com a senha certa. Para terminar o login, digite este código:
                </p>
                <p style="margin:0 0 8px;padding:16px;border-radius:12px;background:#e9e3d6;text-align:center;font-family:'Courier New',monospace;font-size:34px;font-weight:bold;letter-spacing:10px;color:#1d1d1e;">${code}</p>
                <p style="margin:0 0 20px;font-size:12px;color:#777777;text-align:center;">O código vale por 10 minutos.</p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#a31e21;">
                  <strong>Não foi você?</strong> Não passe este código para ninguém e troque sua senha em "Esqueci minha senha".
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `Oi, ${name.split(" ")[0]}!

Seu código para entrar no Clutch: ${code}
(vale por 10 minutos)

Não foi você? Não passe este código para ninguém e troque sua senha em "Esqueci minha senha".`;

  return { subject: `${code} é o seu código para entrar no Clutch`, html, text };
}
