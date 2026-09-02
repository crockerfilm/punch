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
