import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

export const REPO_ROOT = path.resolve(__dirname, '../..');

export type BundleManifest = {
  schema_version: string;
  bundle: {
    id: string;
    name: string;
    version: string;
    role: string;
    license?: string;
    description?: string;
    author?: string;
  };
  requires?: {
    speckit_version?: string;
    tools?: string[];
    mcp?: string[];
  };
  provides?: {
    workflows?: Array<{ id: string; version: string }>;
  };
};

/**
 * bundle.yml is the single source of truth for the release version. Everything
 * else (package.json, workflow.yml, installer registry, release artifact name)
 * must agree with it, so bumping a release is a one-file change.
 */
export function readBundleManifest(): BundleManifest {
  const manifestPath = path.join(REPO_ROOT, 'bundle.yml');
  return yaml.parse(fs.readFileSync(manifestPath, 'utf8')) as BundleManifest;
}

export function getBundleVersion(): string {
  return readBundleManifest().bundle.version;
}

export function readWorkflowDefinition(): any {
  const workflowPath = path.join(REPO_ROOT, 'workflows/viteplus-stitch/workflow.yml');
  return yaml.parse(fs.readFileSync(workflowPath, 'utf8'));
}

/** Release artifact produced by `specify bundle build`. */
export function getBundleArtifactName(): string {
  const manifest = readBundleManifest();
  return `${manifest.bundle.id}-${manifest.bundle.version}.zip`;
}
