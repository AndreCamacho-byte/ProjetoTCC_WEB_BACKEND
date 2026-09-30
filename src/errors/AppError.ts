// Erro "esperado" da aplicação (ex.: usuário não encontrado, email já cadastrado).
// Lance com `throw new AppError("mensagem", 404)` dentro de services/controllers.
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}
