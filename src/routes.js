// Route-level code splitting. The player pulls in Video.js, so it is loaded on
// demand through the router's `lazy` (navigation waits for the chunk, so a view
// transition never snapshots a loading fallback) and warmed up on card hover.
export const loadWatch = () => import("./watch/Watch");
export const loadNotFound = () => import("./shell/NotFound");

export const preloadWatch = () => {
  loadWatch();
};
