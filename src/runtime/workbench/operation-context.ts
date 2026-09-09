import { AsyncLocalStorage } from "node:async_hooks";

export type WorkbenchOperationContext = {
  correlationId: string;
};

const operationContext = new AsyncLocalStorage<WorkbenchOperationContext>();

export function withWorkbenchOperationContext<T>(context: WorkbenchOperationContext, callback: () => Promise<T>) {
  return operationContext.run(context, callback);
}

export function currentWorkbenchOperationContext() {
  return operationContext.getStore();
}
