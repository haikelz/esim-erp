import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

process.umask(0o077);

function randomHex(bytes = 32) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
    "hex",
  );
}

async function ensurePrivateScratchExcluded() {
  const git = Bun.spawnSync([
    "git",
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "info/exclude",
  ]);
  if (git.exitCode !== 0)
    throw new Error(
      "Clone or initialize this Git repository before local setup.",
    );

  const path = git.stdout.toString().trim();
  const file = Bun.file(path);
  const existing = (await file.exists()) ? await file.text() : "";
  if (existing.split(/\r?\n/).includes("/.amp/in/")) return;

  await mkdir(dirname(path), { recursive: true });
  await Bun.write(
    path,
    `${existing}${existing.endsWith("\n") ? "" : "\n"}/.amp/in/\n`,
  );
}

await ensurePrivateScratchExcluded();

const targets = [
  ".env",
  "apps/api/.dev.vars",
  "apps/web/.env.local",
  ".amp/in/local-config.json",
  ".amp/in/local-login.txt",
  ".amp/in/n8n/credentials.json",
];
const existing = await Promise.all(
  targets.map((path) => Bun.file(path).exists()),
);
if (existing.some(Boolean)) {
  if (!existing.every(Boolean))
    throw new Error(
      "Local configuration is incomplete. Restore the missing files; setup does not overwrite existing secrets.",
    );

  console.info(
    "Local configuration already exists. Login instructions: .amp/in/local-login.txt",
  );
  process.exit(0);
}

const postgresPassword = randomHex();
const proxySecret = randomHex();
const encryptionKey = randomHex();
const automationToken = randomHex();
const demoPassword = randomHex(10);
const databaseUrl = `postgresql://esim_erp:${postgresPassword}@127.0.0.1:55440/esim_erp`;
const testDatabaseUrl = `postgresql://esim_erp:${postgresPassword}@127.0.0.1:55440/esim_erp_test`;
await mkdir(".amp/in/n8n", { recursive: true });
await mkdir(".amp/in/artifacts", { recursive: true });

await Bun.write(
  ".env",
  `APP_ENV=local\nPOSTGRES_PASSWORD=${postgresPassword}\nN8N_ENCRYPTION_KEY=${randomHex()}\nDATABASE_URL=${databaseUrl}\nTEST_DATABASE_URL=${testDatabaseUrl}\nESIM_ENCRYPTION_KEY=${encryptionKey}\nDEMO_PASSWORD=${demoPassword}\n`,
);
await Bun.write(
  "apps/api/.dev.vars",
  `APP_ENV=local\nWEB_ORIGIN=http://localhost:3010\nDATABASE_URL=${databaseUrl}\nERP_PROXY_SECRET=${proxySecret}\nESIM_ENCRYPTION_KEY=${encryptionKey}\nAUTOMATION_TOKEN=${automationToken}\nALLOW_DEMO_PAYMENTS=true\n`,
);
await Bun.write(
  "apps/web/.env.local",
  `API_ORIGIN=http://127.0.0.1:3011\nWEB_ORIGIN=http://localhost:3010\nERP_PROXY_SECRET=${proxySecret}\n`,
);
await Bun.write(
  ".amp/in/local-config.json",
  JSON.stringify(
    {
      databaseUrl,
      testDatabaseUrl,
      proxySecret,
      encryptionKey,
      automationToken,
      demoPassword,
    },
    null,
    2,
  ),
);
await Bun.write(
  ".amp/in/local-login.txt",
  `LOCAL DEMO ONLY — generated credentials, do not share or commit.\n\nURL: http://localhost:3010/auth/login\nPassword for all four synthetic accounts: ${demoPassword}\n\nadmin@demo.invalid — admin\nsales@demo.invalid — sales\noperations@demo.invalid — operations\nfinance@demo.invalid — finance\n`,
);
await Bun.write(
  ".amp/in/n8n/credentials.json",
  JSON.stringify(
    [
      {
        id: "erp-local-api",
        name: "ERP local API",
        type: "httpHeaderAuth",
        data: { name: "Authorization", value: `Bearer ${automationToken}` },
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
    ],
    null,
    2,
  ),
);

for (const path of targets) await chmod(path, 0o600);

console.info(
  "Local configuration created without Midtrans credentials. Login instructions: .amp/in/local-login.txt",
);
