import type { Chunk, StylePreset, Word } from './types';

export interface CloudProjectEntry {
  id: number;
  name: string;
  video_name: string | null;
  updated_at: string;
}

export interface CloudProjectFull extends CloudProjectEntry {
  duration: number | null;
  words: Word[];
  chunks: Chunk[];
  style: StylePreset;
}

export async function fetchCloudProjects(): Promise<CloudProjectEntry[]> {
  const r = await fetch('/api/projects');
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Cloud projects unavailable');
  const { projects } = await r.json();
  return projects;
}

export async function fetchCloudProject(id: number): Promise<CloudProjectFull> {
  const r = await fetch(`/api/projects/${id}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not load that project');
  const { project } = await r.json();
  return project;
}

export interface ProjectSavePayload {
  name: string;
  videoName: string;
  duration: number;
  words: Word[];
  chunks: Chunk[];
  style: StylePreset;
}

/** Creates a new cloud project if `id` is null, otherwise updates that one in place (used for autosave). */
export async function saveCloudProject(id: number | null, data: ProjectSavePayload): Promise<{ id: number; name: string; updated_at: string }> {
  const r = await fetch(id ? `/api/projects/${id}` : '/api/projects', {
    method: id ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not save to the cloud');
  const { saved } = await r.json();
  return saved;
}

export async function deleteCloudProject(id: number): Promise<void> {
  const r = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not delete');
}
