// Skills installer client — `/api/skills/{caps,list,install}` on the backend.
// Mirrors the server-side allowlist (gstack, openmontage-video) and provides
// typed convenience helpers for the frontend.
//
// Usage:
//   const caps = await getSkillsCaps();
//   if (!caps.installed.git) { … ask user to install git first … }
//   const res = await installSkill('gstack');
//   const list = await listInstalledSkills();
//
// The backend clones into $BEATRICE_SKILLS_INSTALL_ROOT (defaults to
// $BEATRICE_WORKSPACE_DIR/skills). It does NOT execute the project's own
// post-clone setup scripts — the SKILL.md at `.opencode/skills/<slug>/`
// describes the post-clone steps (typically `./setup --host opencode` for
// gstack, `make setup` for openmontage-video).

import { getBackendUrl } from './whatsappClient';

export type SupportedSkillSlug = 'gstack' | 'openmontage-video';

export type SkillsCaps = {
  ok: boolean;
  installRoot: string;
  allowlist: string[];
  installed: {
    git: boolean;
    opencode: boolean;
    python3: boolean;
    ffmpeg: boolean;
    node: boolean;
  };
  ready: boolean; // true when git is installed (clone prerequisite)
};

export type InstalledSkill = {
  slug: string;
  path: string;
  installed: boolean;
  hasReadme: boolean;
};

export type InstallResult = {
  ok: boolean;
  slug: string;
  repo: string;
  installPath: string;
  stdoutTail: string;
  durationMs: number;
  nextSteps: string;
};

export type InstallFailure = {
  ok: false;
  error: string;
  allowlist?: string[];
};

async function post<TReq, TRes>(pathname: string, body?: TReq): Promise<TRes> {
  const url = `${getBackendUrl()}${pathname}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !(data && typeof data === 'object' && (data as any).ok === false)) {
    throw new Error(`POST ${pathname} failed: ${res.status} ${res.statusText}`);
  }
  return data as TRes;
}

async function get<TRes>(pathname: string): Promise<TRes> {
  const url = `${getBackendUrl()}${pathname}`;
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GET ${pathname} failed: ${res.status} ${res.statusText}`);
  return data as TRes;
}

export async function getSkillsCaps(): Promise<SkillsCaps> {
  return get<SkillsCaps>('/api/skills/caps');
}

export async function listInstalledSkills(): Promise<{ ok: boolean; root: string; items: InstalledSkill[] }> {
  return get<{ ok: boolean; root: string; items: InstalledSkill[] }>('/api/skills/list');
}

export async function installSkill(slug: SupportedSkillSlug): Promise<InstallResult | InstallFailure> {
  return post<{ slug: SupportedSkillSlug }, InstallResult | InstallFailure>('/api/skills/install', { slug });
}
