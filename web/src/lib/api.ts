import type { ApiError } from '@notify-hub/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: NonNullable<ApiError['issues']> = [],
  ) {
    super(message);
  }

  // Field path to message, for showing errors next to inputs.
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.issues.map((issue) => [issue.path, issue.message]));
  }
}

// Calls the admin API with the session cookie; failures throw ApiRequestError.
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as Partial<ApiError>;
  if (!response.ok) {
    throw new ApiRequestError(response.status, data.error ?? response.statusText, data.issues);
  }
  return data as T;
}

export function errorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  return error instanceof Error ? error.message : String(error);
}
