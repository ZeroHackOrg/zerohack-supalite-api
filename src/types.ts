/** Shared runtime types for the SupaLite-compatible API. */

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonScalar[] | { [k: string]: JsonValue };

export interface DbRow {
  [column: string]: unknown;
}

export interface RunResult {
  changes: number;
  lastInsertRowid?: number | bigint | null;
}

export const POSTGREST_VERSION = "12.2.8 (zerohack-supalite)";

export const API_VERSION = "0.1.0";

/* Astral / structured error thrown across the request path — serialized to
   a PostgREST-style JSON body in the error middleware. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(status: number, code: string, message: string, details: string | null = null, hint: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.hint = hint;
  }

  toBody(): ApiErrorBody {
    return { code: this.code, message: this.message, details: this.details, hint: this.hint };
  }

  static badRequest(code: string, message: string, details: string | null = null, hint: string | null = null): ApiError {
    return new ApiError(400, code, message, details, hint);
  }
  static unauthorized(code: string, message: string, details: string | null = null, hint: string | null = null): ApiError {
    return new ApiError(401, code, message, details, hint);
  }
  static forbidden(code: string, message: string, details: string | null = null, hint: string | null = null): ApiError {
    return new ApiError(403, code, message, details, hint);
  }
  static notFound(code: string, message: string, details: string | null = null, hint: string | null = null): ApiError {
    return new ApiError(404, code, message, details, hint);
  }
  static conflict(code: string, message: string, details: string | null = null, hint: string | null = null): ApiError {
    return new ApiError(409, code, message, details, hint);
  }
  static server(code: string, message: string, details: string | null = null, hint: string | null = null): ApiError {
    return new ApiError(500, code, message, details, hint);
  }
}