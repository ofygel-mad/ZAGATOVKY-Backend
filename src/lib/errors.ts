/** Ошибка с явным HTTP-статусом — всё остальное считается 500. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code = 'APP_ERROR',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Ресурс') => new AppError(404, `${what} не найден`, 'NOT_FOUND');
export const badRequest = (message: string) => new AppError(400, message, 'BAD_REQUEST');
export const unauthorized = (message = 'Требуется авторизация') =>
  new AppError(401, message, 'UNAUTHORIZED');
export const forbidden = (message = 'Недостаточно прав') => new AppError(403, message, 'FORBIDDEN');
export const conflict = (message: string) => new AppError(409, message, 'CONFLICT');
