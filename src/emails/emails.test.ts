import { describe, expect, it } from "vitest";
import { resetPasswordTemplate } from "./resetPassword";
import { verifyEmailTemplate } from "./verifyEmail";

describe("verifyEmailTemplate", () => {
  const mail = verifyEmailTemplate({
    name: "Tony Teste",
    link: "http://localhost:5173/confirmar-email?token=abc123",
    code: "048213",
  });

  it("coloca o código no assunto, no texto e em destaque no HTML", () => {
    expect(mail.subject).toBe("048213 é o seu código do Clutch");
    expect(mail.text).toContain("048213");
    expect(mail.html).toContain(">048213</p>");
  });

  it("inclui o link de confirmação nas duas versões", () => {
    expect(mail.text).toContain("http://localhost:5173/confirmar-email?token=abc123");
    expect(mail.html).toContain('href="http://localhost:5173/confirmar-email?token=abc123"');
  });

  it("chama a pessoa pelo primeiro nome", () => {
    expect(mail.text).toContain("Falta pouco, Tony!");
    expect(mail.html).toContain("Falta pouco, Tony!");
  });

  it("neutraliza HTML colocado no nome, para ninguém injetar código no email", () => {
    const evil = verifyEmailTemplate({ name: "<script>alert(1)</script>", link: "http://x", code: "000000" });
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).toContain("&lt;script&gt;");
  });
});

describe("resetPasswordTemplate", () => {
  const mail = resetPasswordTemplate({
    name: "Leticia Teste",
    link: "http://localhost:5173/redefinir-senha?token=xyz",
  });

  it("tem assunto e link de redefinição", () => {
    expect(mail.subject).toBe("Redefinir sua senha do Clutch");
    expect(mail.text).toContain("http://localhost:5173/redefinir-senha?token=xyz");
    expect(mail.html).toContain('href="http://localhost:5173/redefinir-senha?token=xyz"');
  });

  it("avisa a validade do link e o que fazer se não foi a pessoa que pediu", () => {
    expect(mail.text).toContain("1 hora");
    expect(mail.text).toContain("sua senha continua a mesma");
  });

  it("escapa caracteres especiais do link no HTML", () => {
    const withAmp = resetPasswordTemplate({ name: "Ana", link: "http://x/?a=1&b=2" });
    expect(withAmp.html).toContain("http://x/?a=1&amp;b=2");
    expect(withAmp.text).toContain("http://x/?a=1&b=2");
  });
});
