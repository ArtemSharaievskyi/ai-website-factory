export type RuntimeCloseHandle = {
  close(): Promise<void>;
};

export async function withRuntimeLifecycle<T>(
  runtime: RuntimeCloseHandle,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } finally {
    await runtime.close();
  }
}
