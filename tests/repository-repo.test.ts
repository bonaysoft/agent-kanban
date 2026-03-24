// @vitest-environment node

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, seedUser, setupMiniflare } from "./helpers/db";

const env = createTestEnv();
let mf: Miniflare;

beforeAll(async () => {
  ({ mf, db: env.DB } = await setupMiniflare());
  await seedUser(env.DB, "repo-test-user", "repo@test.com");
  await seedUser(env.DB, "repo-test-user-2", "repo2@test.com");
});

afterAll(async () => {
  await mf.dispose();
});

describe("normalizeGitUrl", () => {
  it("normalizes SSH URL to HTTPS", async () => {
    const { normalizeGitUrl } = await import("../apps/web/functions/api/repositoryRepo");
    expect(normalizeGitUrl("git@github.com:org/repo.git")).toBe("https://github.com/org/repo");
  });

  it("strips .git from HTTPS URL", async () => {
    const { normalizeGitUrl } = await import("../apps/web/functions/api/repositoryRepo");
    expect(normalizeGitUrl("https://github.com/org/repo.git")).toBe("https://github.com/org/repo");
  });

  it("keeps clean HTTPS URL as-is", async () => {
    const { normalizeGitUrl } = await import("../apps/web/functions/api/repositoryRepo");
    expect(normalizeGitUrl("https://github.com/org/repo")).toBe("https://github.com/org/repo");
  });

  it("passes through URL with trailing slash as-is", async () => {
    const { normalizeGitUrl } = await import("../apps/web/functions/api/repositoryRepo");
    expect(normalizeGitUrl("https://github.com/org/repo/")).toBe("https://github.com/org/repo/");
  });
});

describe("repositoryRepo", () => {
  it("createRepository creates a repo", async () => {
    const { createRepository } = await import("../apps/web/functions/api/repositoryRepo");
    const repo = await createRepository(env.DB, "repo-test-user", { name: "my-repo", url: "https://github.com/org/my-repo" });
    expect(repo.name).toBe("my-repo");
    expect(repo.url).toBe("https://github.com/org/my-repo");
  });

  it("listRepositories returns repos for owner", async () => {
    const { listRepositories } = await import("../apps/web/functions/api/repositoryRepo");
    const repos = await listRepositories(env.DB, "repo-test-user");
    expect(repos.length).toBeGreaterThanOrEqual(1);
  });

  it("listRepositories filters by URL", async () => {
    const { listRepositories } = await import("../apps/web/functions/api/repositoryRepo");
    const repos = await listRepositories(env.DB, "repo-test-user", { url: "https://github.com/org/my-repo" });
    expect(repos.length).toBe(1);
    expect(repos[0].url).toBe("https://github.com/org/my-repo");
  });

  it("listRepositories URL filter normalizes input", async () => {
    const { listRepositories } = await import("../apps/web/functions/api/repositoryRepo");
    const repos = await listRepositories(env.DB, "repo-test-user", { url: "git@github.com:org/my-repo.git" });
    expect(repos.length).toBe(1);
  });

  it("listRepositories returns empty for unknown URL", async () => {
    const { listRepositories } = await import("../apps/web/functions/api/repositoryRepo");
    const repos = await listRepositories(env.DB, "repo-test-user", { url: "https://github.com/org/nonexistent" });
    expect(repos.length).toBe(0);
  });

  it("deleteRepository removes a repo", async () => {
    const { createRepository, deleteRepository, listRepositories } = await import("../apps/web/functions/api/repositoryRepo");
    const repo = await createRepository(env.DB, "repo-test-user", { name: "del-repo", url: "https://github.com/org/del-repo" });
    const deleted = await deleteRepository(env.DB, repo.id);
    expect(deleted).toBe(true);
    const repos = await listRepositories(env.DB, "repo-test-user", { url: "https://github.com/org/del-repo" });
    expect(repos.length).toBe(0);
  });

  it("deleteRepository returns false for unknown repo", async () => {
    const { deleteRepository } = await import("../apps/web/functions/api/repositoryRepo");
    const deleted = await deleteRepository(env.DB, "nonexistent");
    expect(deleted).toBe(false);
  });

  it("findOrCreateRepository creates if not found", async () => {
    const { findOrCreateRepository } = await import("../apps/web/functions/api/repositoryRepo");
    const repo = await findOrCreateRepository(env.DB, "repo-test-user", { name: "find-create", url: "https://github.com/org/find-create" });
    expect(repo.name).toBe("find-create");
  });

  it("findOrCreateRepository returns existing if found", async () => {
    const { findOrCreateRepository } = await import("../apps/web/functions/api/repositoryRepo");
    const first = await findOrCreateRepository(env.DB, "repo-test-user", { name: "find-create-dup", url: "https://github.com/org/find-create-dup" });
    const second = await findOrCreateRepository(env.DB, "repo-test-user", {
      name: "find-create-dup-2",
      url: "https://github.com/org/find-create-dup",
    });
    expect(second.id).toBe(first.id);
  });

  it("repos are scoped to owner", async () => {
    const { listRepositories } = await import("../apps/web/functions/api/repositoryRepo");
    const repos = await listRepositories(env.DB, "repo-test-user-2");
    expect(repos.length).toBe(0);
  });
});
