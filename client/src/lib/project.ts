import type { Project } from './types';

const KEY = 'punch:project';
const listeners = new Set<() => void>();
let dirty = false;

export function markDirty() {
  dirty = true;
  listeners.forEach(l => l());
}

export function markClean() {
  dirty = false;
  listeners.forEach(l => l());
}

export function isDirty() {
  return dirty;
}

export function onDirtyChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function saveProject(p: Project) {
  localStorage.setItem(KEY, JSON.stringify(p));
  markClean();
}

export function loadProject(): Project | null {
  const raw = localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}

// Warn on tab close / reload while there are unsaved changes.
window.addEventListener('beforeunload', (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = '';
});

// beforeunload doesn't reliably fire for trackpad swipe / mouse "back"
// gesture navigation in some browsers (notably Safari), since that's
// history navigation rather than a real page unload. Intercept it via
// a dummy history entry so we can show our own confirm before letting
// the gesture actually leave the app.
let allowHistoryLeave = false;
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => {
  if (allowHistoryLeave || !dirty) return;
  history.pushState(null, '', location.href);
  if (confirm('You have unsaved changes. Leave this page anyway?')) {
    allowHistoryLeave = true;
    history.back();
  }
});
