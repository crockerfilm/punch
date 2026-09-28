import type { Chunk, StylePreset, Word } from './types';
import { fetchJson } from './http';

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
  const { projects } = await fetchJson<{ projects: CloudProjectEntry[] }>('/api/projects', undefined, 'Cloud projects unavailable');
  return projects;
}

export async function fetchCloudProject(id: number): Promise<CloudProjectFull> {
  const { project } = await fetchJson<{ project: CloudProjectFull }>(`/api/projects/${id}`, undefined, 'Could not load that project');
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
  const { saved } = await fetchJson<{ saved: { id: number; name: string; updated_at: string } }>(
    id ? `/api/projects/${id}` : '/api/projects',
    { method: id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) },
    'Could not save to the cloud',
  );
  return saved;
}

export async function deleteCloudProject(id: number): Promise<void> {
  await fetchJson(`/api/projects/${id}`, { method: 'DELETE' }, 'Could not delete');
}
