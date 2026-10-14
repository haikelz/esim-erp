import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const ROOT = resolve(import.meta.dir, "..");
const PROJECT = "esim-erp-local";
const OWNER_EMAIL = "n8n-owner@esim-erp.demo.invalid";
const N8N_ORIGIN = "http://127.0.0.1:5679";
const COMPOSE = ["docker", "compose", "--project-name", PROJECT];
const WORKFLOWS = [
  { file: "order-events.json", id: "erp-local-order-events" },
  { file: "finance-position.json", id: "erp-local-finance-position" },
] as const;

type Credential = {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
};

type Workflow = {
  id: string;
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
};

type OwnedRecord = {
  id: string;
  identityMatches: boolean;
  projectIds: string[];
};

type WorkflowState = OwnedRecord & {
  definitionMatches: boolean;
  active: boolean;
  published: boolean;
};

type LocalState = {
  userCount: number;
  projectCount: number;
  credentialCount: number;
  workflowCount: number;
  owner: {
    id: string;
    emailMatches: boolean;
    unclaimed: boolean;
    disabled: boolean;
    mfaEnabled: boolean;
    projectIds: string[];
  };
  credentials: OwnedRecord[];
  workflows: WorkflowState[];
};

class LocalImportError extends Error {}

function requireLocal(condition: unknown, message: string): asserts condition {
  if (!condition) throw new LocalImportError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isOwnedRecord(value: unknown): value is OwnedRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.identityMatches === "boolean" &&
    isStringArray(value.projectIds)
  );
}

function parseState(value: unknown): LocalState {
  requireLocal(isRecord(value), "Could not inspect the local n8n database.");
  const owner = value.owner;
  requireLocal(
    ["userCount", "projectCount", "credentialCount", "workflowCount"].every(
      (key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0,
    ) &&
      isRecord(owner) &&
      typeof owner.id === "string" &&
      ["emailMatches", "unclaimed", "disabled", "mfaEnabled"].every(
        (key) => typeof owner[key] === "boolean",
      ) &&
      isStringArray(owner.projectIds) &&
      Array.isArray(value.credentials) &&
      value.credentials.every(isOwnedRecord) &&
      Array.isArray(value.workflows) &&
      value.workflows.every(
        (workflow) =>
          isRecord(workflow) &&
          typeof workflow.definitionMatches === "boolean" &&
          typeof workflow.active === "boolean" &&
          typeof workflow.published === "boolean" &&
          isOwnedRecord(workflow),
      ),
    "n8n metadata is incompatible. This importer requires the Compose n8n 2.43.4 SQLite configuration; inspect it without resetting the volume.",
  );

  // All fields crossing the subprocess boundary were validated above.
  return value as LocalState;
}

async function run(command: string[], failure: string, input = "") {
  try {
    const child = Bun.spawn(command, {
      cwd: ROOT,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    });
    child.stdin.write(input);
    child.stdin.end();

    // CLI diagnostics may include credentials. Capture them, never forward them.
    const [stdout, , exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    requireLocal(exitCode === 0, failure);

    return stdout.trim();
  } catch {
    throw new LocalImportError(failure);
  }
}

async function privateJson(path: string): Promise<unknown> {
  const filename = resolve(ROOT, path);
  const metadata = await stat(filename).catch(() => undefined);
  requireLocal(
    metadata !== undefined,
    `Missing ${path}. Run bun run setup:local first; restore incomplete configuration rather than overwriting secrets.`,
  );
  requireLocal(
    metadata.isFile() && (metadata.mode & 0o077) === 0,
    `${path} must be a private regular file. Run chmod 600 ${path}, then retry.`,
  );

  try {
    return await Bun.file(filename).json();
  } catch {
    throw new LocalImportError(
      `Invalid JSON in ${path}; restore the private local setup file.`,
    );
  }
}

async function localRequest(path: string, body?: Record<string, unknown>) {
  try {
    const response = await fetch(`${N8N_ORIGIN}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    requireLocal(
      response.ok,
      `n8n ${path} returned HTTP ${response.status}. Inspect the local owner/configuration in n8n; no reset or credential overwrite was attempted.`,
    );
    const result: unknown = await response.json();
    requireLocal(
      isRecord(result) && isRecord(result.data),
      `Unexpected response from local n8n ${path}.`,
    );

    return result.data;
  } catch (error) {
    if (error instanceof LocalImportError) throw error;
    throw new LocalImportError(
      `Cannot confirm n8n ${path}. Check localhost:5679 and rerun to inspect state before retrying any setup; the previous request may have completed.`,
    );
  }
}

// Read-only inspection: neither ownership nor n8n data is changed with SQL.
const INSPECT_STATE = `
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { isDeepStrictEqual } = require('node:util');
const expected = JSON.parse(fs.readFileSync(0, 'utf8'));
const db = new DatabaseSync('/home/node/.n8n/database.sqlite', { readOnly: true });
try {
  const owners = db.prepare("SELECT id, email, password IS NULL AS unclaimedPassword, disabled, mfaEnabled FROM user WHERE roleSlug = 'global:owner'").all();
  if (owners.length !== 1) throw new Error('Unexpected owner count');
  const owner = owners[0];
  const projectIds = db.prepare("SELECT p.id FROM project p JOIN project_relation r ON r.projectId = p.id WHERE p.type = 'personal' AND r.userId = ? AND r.role = 'project:personalOwner'").all(owner.id).map(row => row.id);
  const credentials = expected.credentials.flatMap(credential => {
    const row = db.prepare('SELECT id, name, type, usageScope FROM credentials_entity WHERE id = ?').get(credential.id);
    if (!row) return [];
    return [{ id: row.id, identityMatches: row.name === credential.name && row.type === credential.type && row.usageScope === 'project', projectIds: db.prepare("SELECT projectId FROM shared_credentials WHERE credentialsId = ? AND role = 'credential:owner'").all(row.id).map(share => share.projectId) }];
  });
  const workflows = expected.workflows.flatMap(workflow => {
    const row = db.prepare('SELECT id, name, nodes, connections, settings, active, activeVersionId, versionId FROM workflow_entity WHERE id = ?').get(workflow.id);
    if (!row) return [];
    return [{ id: row.id, identityMatches: row.name === workflow.name, definitionMatches: ['nodes', 'connections', 'settings'].every(key => isDeepStrictEqual(JSON.parse(row[key]), workflow[key])), active: Boolean(row.active), published: Boolean(row.activeVersionId) && row.activeVersionId === row.versionId, projectIds: db.prepare("SELECT projectId FROM shared_workflow WHERE workflowId = ? AND role = 'workflow:owner'").all(row.id).map(share => share.projectId) }];
  });
  const count = table => db.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count;
  process.stdout.write(JSON.stringify({ userCount: count('user'), projectCount: count('project'), credentialCount: count('credentials_entity'), workflowCount: count('workflow_entity'), owner: { id: owner.id, emailMatches: owner.email === expected.ownerEmail, unclaimed: owner.email === null && Boolean(owner.unclaimedPassword), disabled: Boolean(owner.disabled), mfaEnabled: Boolean(owner.mfaEnabled), projectIds }, credentials, workflows }));
} finally { db.close(); }
`;

const IMPORT_CREDENTIALS = `
set -eu
umask 077
temp=$(mktemp -d /tmp/esim-erp-credential-import.XXXXXX)
trap 'rm -rf "$temp"' EXIT
cat > "$temp/credentials.json"
n8n import:credentials --input="$temp/credentials.json" --projectId="$1"
`;

const CHECK_CREDENTIALS = `
set -eu
umask 077
temp=$(mktemp -d /tmp/esim-erp-credential-check.XXXXXX)
trap 'rm -rf "$temp"' EXIT
cat > "$temp/expected.json"
for id in "$@"; do
  n8n export:credentials --id="$id" --decrypted --output="$temp/$id.json" > "$temp/export.log" 2>&1
done
node - "$temp" "$@" <<'NODE'
const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const [directory, ...ids] = process.argv.slice(2);
const expected = JSON.parse(fs.readFileSync(directory + '/expected.json', 'utf8'));
for (const id of ids) {
  const saved = JSON.parse(fs.readFileSync(directory + '/' + id + '.json', 'utf8'));
  const credential = expected.find(entry => entry.id === id);
  if (saved.length !== 1 || saved[0].id !== id || saved[0].type !== credential.type || saved[0].name !== credential.name || !isDeepStrictEqual(saved[0].data, credential.data)) process.exit(1);
}
NODE
`;

async function waitForN8n() {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${N8N_ORIGIN}/healthz/readiness`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      // A brief connection refusal is expected while this local service restarts.
    }
    await Bun.sleep(1000);
  }
  throw new LocalImportError(
    "n8n did not become ready after restart. Inspect docker compose logs n8n privately; do not reset its volume. Workflows may already be published.",
  );
}

async function main() {
  const args = process.argv.slice(2);
  requireLocal(
    args.length === 0 || (args.length === 1 && args[0] === "--import-only"),
    "Usage: bun scripts/import-automation.ts [--import-only]. Local Compose only; default publishes both schedules and restarts only n8n to load them.",
  );
  const importOnly = args.includes("--import-only");
  const localConfig = await privateJson(".amp/in/local-config.json");
  requireLocal(
    isRecord(localConfig) &&
      typeof localConfig.automationToken === "string" &&
      /^[a-f0-9]{64}$/.test(localConfig.automationToken),
    "The private local configuration lacks a valid generated automation token. Restore the matching setup files; do not generate replacement credentials over this stack.",
  );
  const credentials: Credential[] = [
    {
      id: "erp-local-api",
      name: "ERP local API",
      type: "httpHeaderAuth",
      data: {
        name: "Authorization",
        value: `Bearer ${localConfig.automationToken}`,
      },
    },
    {
      id: "erp-local-mail",
      name: "ERP local Mailpit",
      type: "smtp",
      data: {
        host: "mailpit",
        port: 1025,
        secure: false,
        disableStartTls: true,
      },
    },
  ];
  const credentialInput = await privateJson(".amp/in/n8n/credentials.json");
  requireLocal(
    Array.isArray(credentialInput) &&
      credentialInput.length === credentials.length &&
      credentials.every((expected) =>
        credentialInput.some((credential) =>
          isDeepStrictEqual(credential, expected),
        ),
      ),
    "The private n8n credentials do not match local-config.json and the Mailpit-only setup. Restore the matching generated files; this importer never overwrites them.",
  );
  const workflows = await Promise.all(
    WORKFLOWS.map(async ({ file, id }): Promise<Workflow> => {
      const workflow: unknown = await Bun.file(
        resolve(ROOT, "automation/n8n", file),
      ).json();
      requireLocal(
        isRecord(workflow) &&
          workflow.id === id &&
          typeof workflow.name === "string" &&
          Array.isArray(workflow.nodes) &&
          isRecord(workflow.connections) &&
          isRecord(workflow.settings),
        `Invalid automation/n8n/${file}. Restore the importable workflow definition.`,
      );

      return workflow as Workflow;
    }),
  );

  const container = await run(
    [...COMPOSE, "ps", "--quiet", "n8n"],
    "Cannot locate local n8n. Run docker compose up -d postgres mailpit n8n first.",
  );
  requireLocal(
    /^[a-f0-9]{64}$/.test(container),
    "Expected one running n8n container in esim-erp-local; inspect docker compose ps.",
  );
  const inspection = await run(
    [
      "docker",
      "inspect",
      "--format",
      "{{json .Config.Labels}}\n{{json .NetworkSettings.Ports}}\n{{json .Config.Image}}\n{{json .State.Running}}",
      container,
    ],
    "Could not verify the local n8n container. Check Docker and this checkout's Compose configuration.",
  );
  const [labels, ports, image, running]: unknown[] = inspection
    .split("\n")
    .map((line) => JSON.parse(line));
  requireLocal(
    isRecord(labels) &&
      labels["com.docker.compose.project"] === PROJECT &&
      labels["com.docker.compose.project.working_dir"] === ROOT &&
      labels["com.docker.compose.service"] === "n8n" &&
      image === "docker.n8n.io/n8nio/n8n:2.43.4" &&
      running === true &&
      isRecord(ports) &&
      Array.isArray(ports["5678/tcp"]) &&
      ports["5678/tcp"].length === 1 &&
      isRecord(ports["5678/tcp"][0]) &&
      ports["5678/tcp"][0].HostIp === "127.0.0.1" &&
      ports["5678/tcp"][0].HostPort === "5679",
    "Refusing a different n8n stack, version, checkout, or non-loopback port. Use this checkout's unmodified local Compose configuration; no unrelated state was changed.",
  );
  const docker = ["docker", "exec", "-i", container];
  const inspectionInput = JSON.stringify({
    ownerEmail: OWNER_EMAIL,
    credentials: credentials.map(({ id, name, type }) => ({ id, name, type })),
    workflows,
  });
  async function inspectState() {
    const output = await run(
      [
        ...docker,
        "node",
        "--disable-warning=ExperimentalWarning",
        "-e",
        INSPECT_STATE,
      ],
      "Could not inspect n8n's owner/personal project. This importer supports only n8n 2.43.4 with its local SQLite volume. Inspect configuration without resetting it.",
      inspectionInput,
    );

    return parseState(JSON.parse(output));
  }
  async function checkCredentials(ids: string[]) {
    if (ids.length === 0) return;
    await run(
      [...docker, "sh", "-c", CHECK_CREDENTIALS, "credential-check", ...ids],
      "Existing n8n credentials conflict with the private local setup or cannot be decrypted. Preserve both sets; restore the original matching configuration or reconcile them in n8n manually. No existing credentials were overwritten.",
      JSON.stringify(credentialInput),
    );
  }
  let state = await inspectState();
  const projectId = state.owner.projectIds[0];
  requireLocal(
    projectId &&
      state.owner.projectIds.length === 1 &&
      !state.owner.disabled &&
      !state.owner.mfaEnabled,
    "Expected an enabled local synthetic owner with one personal project and no MFA. Inspect n8n ownership/configuration manually; this importer does not change existing accounts.",
  );
  requireLocal(
    state.owner.unclaimed || state.owner.emailMatches,
    "n8n already has a different owner. Import these definitions through that owner's n8n UI/personal project manually, or restore the original disposable local stack. This importer will not replace/reset an owner.",
  );
  requireLocal(
    [...state.credentials, ...state.workflows].every(
      (record) =>
        record.identityMatches &&
        record.projectIds.length === 1 &&
        record.projectIds[0] === projectId,
    ),
    "A reserved ERP credential/workflow ID belongs to different content or another project. Inspect those IDs in n8n and reconcile the conflict manually before importing; nothing is re-owned or overwritten.",
  );
  requireLocal(
    !importOnly ||
      state.workflows.every(
        (workflow) => !workflow.active || workflow.definitionMatches,
      ),
    "An already-published ERP workflow needs an update. Rerun without --import-only to import, publish and reload it together; --import-only does not deactivate existing schedules.",
  );
  await checkCredentials(state.credentials.map(({ id }) => id));

  await run(
    [
      ...docker,
      "node",
      "-e",
      `
const fs = require('node:fs');
const credentials = JSON.parse(fs.readFileSync(0, 'utf8'));
(async () => {
  const api = credentials.find(credential => credential.id === 'erp-local-api');
  const response = await fetch('http://host.docker.internal:3011/automation/events', { headers: { Authorization: api.data.value }, signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok || !Array.isArray((await response.json()).events)) process.exit(1);
})().catch(() => process.exit(1));
`,
    ],
    "The n8n container cannot authenticate to host.docker.internal:3011. Start Wrangler on a Docker-reachable address (for example --ip 0.0.0.0), restrict it to local access, and restore matching automation configuration if necessary.",
    JSON.stringify(credentialInput),
  );
  console.info(
    "Local n8n container-to-host API access and private configuration verified.",
  );

  const settings = await localRequest("/rest/settings");
  requireLocal(
    isRecord(settings.userManagement) &&
      settings.userManagement.authenticationMethod === "email" &&
      typeof settings.userManagement.showSetupOnFirstLoad === "boolean",
    "Unsupported n8n authentication/setup configuration. Use the existing owner's UI to import manually; do not reset n8n.",
  );
  const password = `Local1!${createHash("sha256")
    .update(`esim-erp-local:n8n-owner:${localConfig.automationToken}`)
    .digest("hex")
    .slice(0, 32)}`;
  if (settings.userManagement.showSetupOnFirstLoad) {
    requireLocal(
      state.owner.unclaimed &&
        state.userCount === 1 &&
        state.projectCount === 1 &&
        state.credentialCount === 0 &&
        state.workflowCount === 0,
      "n8n requests first-run setup but already contains configured users/content. Inspect the instance manually; this importer only claims an empty disposable local instance and never resets one.",
    );
    await localRequest("/rest/owner/setup", {
      email: OWNER_EMAIL,
      firstName: "Local",
      lastName: "Automation",
      password,
    });
    console.info(
      "Created the synthetic local n8n owner via the supported first-run setup endpoint; no credentials were printed.",
    );
  } else {
    requireLocal(
      state.owner.emailMatches && !state.owner.unclaimed,
      "n8n setup state conflicts with the expected local owner. Inspect it manually without resetting accounts.",
    );
  }
  const login = await localRequest("/rest/login", {
    emailOrLdapLoginId: OWNER_EMAIL,
    password,
  });
  requireLocal(
    login.id === state.owner.id,
    "Could not confirm the synthetic local owner. Restore matching private setup files or import manually using the existing owner; no passwords were changed.",
  );

  const missingCredentials = credentials.filter(
    (credential) => !state.credentials.some(({ id }) => id === credential.id),
  );
  if (missingCredentials.length > 0) {
    await run(
      [
        ...docker,
        "sh",
        "-c",
        IMPORT_CREDENTIALS,
        "credential-import",
        projectId,
      ],
      "Credential import did not complete. Inspect the local n8n state before rerunning; private CLI output was suppressed. No existing credentials are submitted for overwrite.",
      JSON.stringify(missingCredentials),
    );
    await checkCredentials(missingCredentials.map(({ id }) => id));
  }
  console.info(
    `Credentials verified; imported ${missingCredentials.length} missing credential(s), preserved existing credentials and host file permissions.`,
  );

  for (const { file, id } of WORKFLOWS) {
    const existing = state.workflows.find((workflow) => workflow.id === id);
    if (existing?.definitionMatches) continue;
    await run(
      [
        ...docker,
        "n8n",
        "import:workflow",
        `--input=/workflows/${file}`,
        `--projectId=${projectId}`,
      ],
      `Workflow ${id} import did not complete. Inspect local n8n before rerunning; imports can partially succeed, and existing credentials remain untouched.`,
    );
  }
  state = await inspectState();
  requireLocal(
    state.credentials.length === 2 &&
      state.workflows.length === 2 &&
      [...state.credentials, ...state.workflows].every(
        (record) =>
          record.identityMatches &&
          record.projectIds.length === 1 &&
          record.projectIds[0] === projectId,
      ) &&
      state.workflows.every((workflow) => workflow.definitionMatches),
    "Imported workflow/credential metadata did not match the definitions and personal project. Inspect n8n privately before rerunning; no business state was changed by this importer.",
  );
  if (importOnly) {
    console.info(
      "Both workflows imported. Publication/restart skipped; unchanged existing schedules are left untouched. Execute by ID to validate before publishing.",
    );
    return;
  }

  for (const workflow of state.workflows) {
    if (workflow.active && workflow.published) continue;
    await run(
      [...docker, "n8n", "publish:workflow", `--id=${workflow.id}`],
      `Could not confirm publication of ${workflow.id}. Inspect the local instance before rerunning; publication may have completed.`,
    );
  }
  state = await inspectState();
  requireLocal(
    state.workflows.every((workflow) => workflow.active && workflow.published),
    "n8n did not publish both current workflow versions. Inspect local workflow state before retrying.",
  );

  // Also reload on a rerun after publication succeeded but a prior restart failed.
  await run(
    [...COMPOSE, "restart", "n8n"],
    "The local n8n restart could not be confirmed. Check docker compose ps/logs privately; do not reset the volume.",
  );
  await waitForN8n();
  console.info(
    "Both current workflows published locally: events every minute; cumulative finance position at 08:00 Asia/Jakarta. No production support, external mail, payment or provisioning actions.",
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof LocalImportError
        ? error.message
        : "Local automation import failed. Check the workflow files and Docker/local setup privately before retrying; diagnostic output was suppressed to protect credentials.",
    );
    process.exitCode = 1;
  }
}
