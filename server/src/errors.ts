export class ApiError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const invalidInput = (message = "Confira os dados informados.") => new ApiError(400, "INVALID_INPUT", message);
export const unauthenticated = () => new ApiError(401, "UNAUTHENTICATED", "Entre com uma sessão válida para continuar.");
export const forbidden = () => new ApiError(403, "FORBIDDEN", "Esta operação não está autorizada.");
export const notFound = () => new ApiError(404, "NOT_FOUND", "O recurso solicitado não foi encontrado.");
export const conflict = () => new ApiError(409, "VERSION_CONFLICT", "O registro foi alterado. Recarregue os dados antes de salvar.");
export const unavailable = () => new ApiError(503, "SERVICE_UNAVAILABLE", "O serviço está indisponível. Tente novamente.");
