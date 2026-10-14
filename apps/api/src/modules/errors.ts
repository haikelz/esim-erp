export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
