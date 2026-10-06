/** Stop the local loop promptly even if a provider ignores AbortSignal. */
export function completeUntilAborted(provider, request, method = 'complete') {
  const { signal } = request;
  if (!signal) return provider[method](request);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Aborted'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return provider[method](request);
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
