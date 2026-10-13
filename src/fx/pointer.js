/**
 * One shared, passive set of window pointer listeners for all effects (instead of every canvas
 * adding its own). Effects read `getPointer()` inside their frame loops, and may subscribe to
 * move/down notifications to wake up a sleeping loop.
 *
 * `active` is true while a mouse/pen hovers the page, or while a finger is down.
 */
const pointer = { x: -1e5, y: -1e5, active: false, type: "mouse", time: 0 };
const moveSubs = new Set();
const downSubs = new Set();
let attached = false;

function update(e) {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.type = e.pointerType || "mouse";
  pointer.time = performance.now();
}

function onMove(e) {
  update(e);
  pointer.active = true;
  for (const fn of moveSubs) fn(pointer, e);
}

function onDown(e) {
  update(e);
  pointer.active = true;
  for (const fn of downSubs) fn(pointer, e);
}

function onUp(e) {
  // Touch/pen-without-hover have no "hover" state: the pointer stops existing when lifted.
  if (e.pointerType !== "mouse") pointer.active = false;
}

function onOut(e) {
  if (!e.relatedTarget) pointer.active = false; // left the window
}

function onBlur() {
  pointer.active = false;
}

const opts = { passive: true };

function attach() {
  if (attached) return;
  attached = true;
  window.addEventListener("pointermove", onMove, opts);
  window.addEventListener("pointerdown", onDown, opts);
  window.addEventListener("pointerup", onUp, opts);
  window.addEventListener("pointercancel", onUp, opts);
  window.addEventListener("pointerout", onOut, opts);
  window.addEventListener("blur", onBlur);
}

function detach() {
  if (!attached || moveSubs.size || downSubs.size) return;
  attached = false;
  window.removeEventListener("pointermove", onMove, opts);
  window.removeEventListener("pointerdown", onDown, opts);
  window.removeEventListener("pointerup", onUp, opts);
  window.removeEventListener("pointercancel", onUp, opts);
  window.removeEventListener("pointerout", onOut, opts);
  window.removeEventListener("blur", onBlur);
  pointer.active = false;
}

/** Live pointer state (viewport/client coordinates). Do not mutate. */
export function getPointer() {
  return pointer;
}

/**
 * Subscribe to pointer activity. `move(pointer, event)` / `down(pointer, event)` are optional.
 * Even with no callbacks, subscribing keeps the shared listeners attached so `getPointer()` stays
 * fresh. Returns an unsubscribe function.
 */
export function subscribePointer({ move, down } = {}) {
  const token = () => {};
  moveSubs.add(move || token);
  if (down) downSubs.add(down);
  attach();
  return () => {
    moveSubs.delete(move || token);
    if (down) downSubs.delete(down);
    detach();
  };
}
