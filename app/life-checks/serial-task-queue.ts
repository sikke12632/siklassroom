export function createSerialTaskQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const operation = tail.then(task);
      tail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  };
}
