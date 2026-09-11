import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  handleProjectsDocs,
  isProjectsDocsPath,
  projectsDocsDir,
  resolveDocFile,
} from '../../../../apps/pwa/projects-docs.mjs';

// Fixture: a throwaway Hermes home with a project's docs dir.
function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'talaria-docs-'));
  mkdirSync(join(dir, 'projects', 'talaria', 'docs'), { recursive: true });
  return dir;
}

// Regression for the S1 "Creating a doc doesn't work" bug. The web/PWA
// GatewayDocsTransport calls PUT/GET/DELETE /api/v1/projects/<slug>/docs/<name>
// which serve.mjs (and the Vite dev proxy) forwarded to the Hermes gateway —
// no such route, so every operation 404'd and no file was created. These tests
// drive the shared server-side handler against a temp Hermes home and assert
// the exact contract the transport expects (204 on write/delete, doc list on
// GET, path-traversal rejection).

describe('projects-docs route matching', () => {
  it('matches the gateway-transport route and nothing else', () => {
    expect(isProjectsDocsPath('/api/v1/projects/talaria/docs')).toBe(true);
    expect(isProjectsDocsPath('/api/v1/projects/talaria/docs/new-doc.md')).toBe(
      true
    );
    expect(
      isProjectsDocsPath('/api/v1/projects/talaria/docs/plan/adr-1.md')
    ).toBe(true);
    // Gateway-only / other routes must NOT be intercepted (they still proxy).
    expect(isProjectsDocsPath('/api/v1/projects/talaria')).toBe(false);
    expect(isProjectsDocsPath('/api/v1/models')).toBe(false);
    expect(isProjectsDocsPath('/talaria-config')).toBe(false);
  });
});

describe('projects-docs write/read contract', () => {
  it('PUT creates the doc file and returns 204 (the failing create-doc step)', async () => {
    const home = makeHome();
    try {
      const res = await handleProjectsDocs(
        {
          body: { content: '' },
          method: 'PUT',
          pathname: '/api/v1/projects/talaria/docs/new-doc.md',
        },
        home
      );
      expect(res.status).toBe(204);
      const file = join(projectsDocsDir(home, 'talaria'), 'new-doc.md');
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe('');
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it('round-trips create → list → read → delete with content preserved', async () => {
    const home = makeHome();
    try {
      const content = '# Plan\n\nWrite a scraper.';
      const write = await handleProjectsDocs(
        {
          body: { content },
          method: 'PUT',
          pathname: '/api/v1/projects/talaria/docs/plan.md',
        },
        home
      );
      expect(write.status).toBe(204);

      const list = await handleProjectsDocs(
        { method: 'GET', pathname: '/api/v1/projects/talaria/docs' },
        home
      );
      expect(list.status).toBe(200);
      expect(list.body).toContainEqual({ name: 'plan.md', path: 'plan.md' });

      const read = await handleProjectsDocs(
        { method: 'GET', pathname: '/api/v1/projects/talaria/docs/plan.md' },
        home
      );
      expect(read.status).toBe(200);
      expect(read.body).toEqual({ content, name: 'plan.md', path: 'plan.md' });

      const del = await handleProjectsDocs(
        { method: 'DELETE', pathname: '/api/v1/projects/talaria/docs/plan.md' },
        home
      );
      expect(del.status).toBe(204);
      expect(
        existsSync(join(projectsDocsDir(home, 'talaria'), 'plan.md'))
      ).toBe(false);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});

describe('projects-docs list contract', () => {
  it('lists an empty set when the project has no docs dir yet (valid, no 404)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'talaria-docs-'));
    try {
      const res = await handleProjectsDocs(
        { method: 'GET', pathname: '/api/v1/projects/fresh/docs' },
        home
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it('only lists .md files (ignores non-markdown in the docs dir)', async () => {
    const home = makeHome();
    try {
      writeFileSync(
        join(projectsDocsDir(home, 'talaria'), 'notes.txt'),
        'nope'
      );
      const res = await handleProjectsDocs(
        { method: 'GET', pathname: '/api/v1/projects/talaria/docs' },
        home
      );
      expect(res.body).toEqual([]);
      expect(readdirSync(projectsDocsDir(home, 'talaria'))).toContain(
        'notes.txt'
      );
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});

describe('projects-docs security guards', () => {
  it('rejects path traversal in the doc path (cannot escape the docs dir)', async () => {
    const home = makeHome();
    try {
      const res = await handleProjectsDocs(
        {
          body: { content: 'x' },
          method: 'PUT',
          pathname: '/api/v1/projects/talaria/docs/../../evil.md',
        },
        home
      );
      expect(res.status).toBe(403);
      expect(existsSync(join(home, 'projects', 'talaria', 'evil.md'))).toBe(
        false
      );
      // A sibling project's doc is also unreachable.
      expect(resolveDocFile(home, 'talaria', '../other/pwned.md')).toBeNull();
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it('rejects an invalid slug and returns null for non-docs routes (fall through)', async () => {
    const home = makeHome();
    try {
      const badSlug = await handleProjectsDocs(
        { method: 'GET', pathname: '/api/v1/projects/..%2F..%2Fetc/docs' },
        home
      );
      expect(badSlug.status).toBe(403);
      expect(
        await handleProjectsDocs(
          { method: 'GET', pathname: '/api/v1/models' },
          home
        )
      ).toBeNull();
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});
