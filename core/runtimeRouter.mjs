export function createRuntimeRouter(handlers = {}) {
  return function routeRuntimeMessage(message, sender) {
    if (!message || !message.type) return undefined;
    const handler = handlers[message.type];
    if (typeof handler !== 'function') return undefined;
    return handler(message, sender);
  };
}

export function registerRuntimeRouter(runtime, handlers = {}) {
  const router = createRuntimeRouter(handlers);
  runtime.onMessage.addListener(router);
  return router;
}
