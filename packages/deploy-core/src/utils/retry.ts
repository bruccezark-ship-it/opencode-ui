export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  retryable?: (error: unknown) => boolean;
}

const DEFAULT_RETRYABLE = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Network') ||
    message.includes('timeout') ||
    message.includes('Timeout') ||
    message.includes('InternalError') ||
    message.includes('RequestLimitExceeded') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT')
  );
};

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1000, retryable = DEFAULT_RETRYABLE } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !retryable(error)) {
        throw error;
      }
      await sleep(baseDelay * Math.pow(2, attempt - 1));
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
