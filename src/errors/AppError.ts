// Erro "esperado" da aplicação (ex.: usuário não encontrado, email já cadastrado).
// Lance com `throw new AppError("mensagem", 404)` dentro de services/controllers.
// O `code` opcional deixa o frontend reagir a um erro específico (ex.: EMAIL_NOT_VERIFIED).
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
