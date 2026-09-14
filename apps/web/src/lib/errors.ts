/**
 * Errors that are safe to show a user, carrying the status the route should
 * return. Anything not an ApiError becomes a generic 500 — internal detail
 * never reaches a response body.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    override readonly message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, code = 'bad_request'): ApiError =>
  new ApiError(400, message, code);

export const unauthorized = (message: string, code = 'unauthorized'): ApiError =>
  new ApiError(401, message, code);

export const forbidden = (message: string, code = 'forbidden'): ApiError =>
  new ApiError(403, message, code);

/**
 * PS-15-adjacent: a missing event and a wrong token are the same answer, so a
 * caller cannot probe for which tokens exist.
 */
export const notFound = (message = 'Not found', code = 'not_found'): ApiError =>
  new ApiError(404, message, code);

export const conflict = (message: string, code = 'conflict'): ApiError =>
  new ApiError(409, message, code);

export const tooManyRequests = (
  message: string,
  code = 'rate_limited',
): ApiError => new ApiError(429, message, code);
