// Typed application errors. The API layer maps these to HTTP responses; the
// service layer throws them. Keep codes stable — they may be referenced by the
// frontend.

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON(): { error: { code: string; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details?: unknown) {
    super('validation_failed', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('unauthorized', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    // Deliberately generic message — never reveal whether the email exists.
    super('invalid_credentials', 'Invalid email or password', 401);
    this.name = 'InvalidCredentialsError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'conflict') {
    super(code, message, 409);
    this.name = 'ConflictError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('forbidden', message, 403);
    this.name = 'ForbiddenError';
  }
}
