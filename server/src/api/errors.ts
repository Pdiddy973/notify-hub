import type { ApiError } from '@notify-hub/shared';
import type { z } from 'zod';

// An error the admin API answers with its own status and message.
export class ApiProblem extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly issues?: ApiError['issues'],
  ) {
    super(message);
  }

  toJSON(): ApiError {
    return this.issues ? { error: this.message, issues: this.issues } : { error: this.message };
  }
}

// Validates a request part; failures become a 400 listing each field's problem.
export function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw new ApiProblem(
    400,
    'Check the highlighted fields',
    result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  );
}

export function fieldProblem(path: string, message: string): ApiProblem {
  return new ApiProblem(400, message, [{ path, message }]);
}
