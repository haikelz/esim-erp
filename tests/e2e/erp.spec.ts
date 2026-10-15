import { mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  auditPageSchema,
  dashboardSchema,
  orderInputSchema,
  orderSchema,
  staffAccessLinkSchema,
} from "../../packages/contracts/src/index";

const ROOT = process.cwd();
const configFile = resolve(ROOT, ".amp/in/local-config.json");
const privateConfig: unknown = JSON.parse(readFileSync(configFile, "utf8"));
if (
  (statSync(configFile).mode & 0o077) !== 0 ||
  typeof privateConfig !== "object" ||
  privateConfig === null ||
  !("demoPassword" in privateConfig) ||
  typeof privateConfig.demoPassword !== "string" ||
  privateConfig.demoPassword.length < 16
) {
  throw new Error(
    "Run the guarded local setup and seed before testing; credentials are never printed.",
  );
}
const password = privateConfig.demoPassword;
const artifacts = resolve(ROOT, ".amp/in/artifacts");
mkdirSync(artifacts, { recursive: true });

async function fillPassword(page: Page, label: string, secret: string) {
  // Keep credentials out of locator diagnostics and traces.
  await page.getByLabel(label, { exact: true }).evaluate((input, value) => {
    if (!(input instanceof HTMLInputElement))
      throw new Error("Password input is absent");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Native input setter is absent");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, secret);
}

async function login(
  page: Page,
  role: "admin" | "sales" | "operations" | "finance",
  identity = { email: `${role}@demo.invalid`, password },
) {
  await page.goto("/auth/login");
  await page.getByLabel("Email staf").fill(identity.email);
  await fillPassword(page, "Kata sandi", identity.password);
  await page.getByRole("button", { exact: true, name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("heading", { name: "Ringkasan operasional" }),
  ).toBeVisible();
  const response = await page.request.get("/api/backend/dashboard");
  expect(response.status()).toBe(200);
  const state = dashboardSchema.parse(await response.json());
  if (state.demoPaymentsEnabled !== true || state.supplierMode !== "mock")
    throw new Error(
      "These tests refuse a non-local payment or supplier environment",
    );
  const cookie = (await page.context().cookies()).find(
    (entry) => entry.name === "erp_staff_session",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  await expect(page.getByText("MVP internal", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Supplier mock", { exact: true })).toHaveCount(0);

  return state;
}

async function logout(page: Page) {
  await page.getByRole("button", { exact: true, name: "Keluar" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "erp_staff_session",
    ),
  ).toBe(false);
}

async function capture(
  page: Page,
  name: string,
  options: { readonly fullPage?: boolean } = {},
) {
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  await page.screenshot({
    animations: "disabled",
    fullPage: options.fullPage ?? true,
    path: resolve(artifacts, `${name}.png`),
  });
}

test("staff can open their own account on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/app/account");
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByLabel("Email staf")).toHaveAttribute(
    "placeholder",
    "nama@perusahaan.com",
  );
  await expect(page.getByLabel("Kata sandi")).toHaveAttribute(
    "placeholder",
    "Masukkan kata sandi",
  );
  await capture(page, "login-placeholders");

  await login(page, "sales");
  await page.getByRole("link", { name: "Info akun" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/account$/);
  await expect(page.getByRole("heading", { name: "Info akun" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Info akun" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator("dl")).toContainText("Rizky Ananda");
  await expect(page.locator("dl")).toContainText("sales@demo.invalid");
  await expect(page.locator("dl")).toContainText("Sales");
  await expect(page.locator("dl")).not.toContainText("admin@demo.invalid");

  await logout(page);
  await login(page, "admin");
  await page.goto("/app/account");
  await expect(page.locator("dl")).toContainText("Dewi Kartika");
  await expect(page.locator("dl")).toContainText("admin@demo.invalid");
  await expect(page.locator("dl")).toContainText("Admin");
  await expect(page.locator("dl")).toContainText("Aktif");
  await expect(page.locator("dl")).not.toContainText("sales@demo.invalid");
  await capture(page, "account-desktop-light");

  await page.getByRole("button", { name: "Tema tampilan" }).click();
  await page.getByRole("menuitem", { name: "Gelap", exact: true }).click();
  await page.setViewportSize({ height: 844, width: 390 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await capture(page, "account-mobile-dark");
  await page.getByRole("button", { name: "Buka atau tutup navigasi" }).click();
  await expect(page.getByRole("link", { name: "Info akun" })).toBeVisible();
  await page.getByRole("link", { name: "Info akun" }).click();
  await expect(page.getByRole("link", { name: "Info akun" })).not.toBeVisible();
  await expect(page).toHaveURL(/\/app\/account$/);
});

test("staff creates an order, a local payment fixture unlocks fulfillment and operations retries the supplier failure", async ({
  page,
}) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/auth\/login$/);
  await page.getByRole("button", { exact: true, name: "Masuk" }).click();
  await expect(
    page.getByText("Masukkan email yang valid.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Email staf")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await capture(page, "login-validation");

  await login(page, "sales");
  await page.goto("/app/billing");
  await expect(page.getByText("Akses dibatasi", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/backend/invoices")).status()).toBe(403);
  await capture(page, "role-restriction");
  await page.goto("/app/orders/new");
  const customerName = "Raka Wijaya";
  await page.getByLabel("Nama pelanggan").fill(customerName);
  await page.getByLabel("Email pelanggan").fill("raka-e2e@traveller.invalid");
  await page.getByLabel("Nomor telepon").fill("+620000000000");
  await page.getByLabel("Pilih paket").click();
  await page.getByRole("option", { name: /Singapore short stay/ }).click();
  await expect(page.getByLabel("Skenario supplier mock")).toHaveCount(0);
  await expect(page.getByText(/^Rp\s*89\.000$/)).toBeVisible();
  await capture(page, "create-order");
  // Inject a local supplier failure without exposing test controls to staff.
  await page.route("**/api/backend/orders", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    const input = orderInputSchema.parse(route.request().postDataJSON());
    await route.continue({
      postData: JSON.stringify({ ...input, supplierScenario: "fail_once" }),
    });
  });
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/backend/orders") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { exact: true, name: "Buat order" }).click();
  const created = orderSchema.parse(await (await createdResponse).json());
  await page.unroute("**/api/backend/orders");
  const orderUrl = `/app/orders/${created.id}`;
  const invoiceUrl = `/app/billing/${created.invoiceId}`;
  await expect(page).toHaveURL(new RegExp(`${created.id}$`));
  await expect(page.getByText(customerName, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Menunggu pelunasan", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Periksa kode instalasi" }),
  ).toHaveCount(0);
  await logout(page);

  const financeState = await login(page, "finance");
  await page.goto(invoiceUrl);
  const paymentLink = page.getByRole("button", { name: "Buat payment link" });
  if (financeState.midtransConfigured) {
    await expect(paymentLink).toBeEnabled();
  } else {
    await expect(paymentLink).toBeDisabled();
  }
  const simulate = page.getByRole("button", {
    exact: true,
    name: "Simulasikan pelunasan",
  });
  await expect(simulate).toBeEnabled();
  await expect(page.getByText("Belum dibayar", { exact: true })).toBeVisible();
  await capture(page, "invoice-unpaid");
  await simulate.focus();
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("tanpa transaksi Midtrans");
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(simulate).toBeFocused();
  await expect(page.getByText("Belum dibayar", { exact: true })).toBeVisible();
  await simulate.click();
  await confirmation
    .getByRole("button", { name: "Catat pelunasan simulasi" })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(
    page.getByText("Simulasi internal", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Simulasi internal · validasi ERP"),
  ).toBeVisible();
  await expect(page.getByText("Dalam antrean", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Margin bruto", { exact: true }).locator("..").locator("dd"),
  ).toHaveText("Belum terealisasi");
  await capture(page, "invoice-paid-queued");
  await page.goto(orderUrl);
  await expect(
    page.getByRole("button", { name: "Coba ulang penerbitan" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Periksa kode instalasi" }),
  ).toHaveCount(0);
  await logout(page);

  await login(page, "operations");
  const exceptionsUrl = `/app/exceptions?search=${created.number}`;
  await page.goto(exceptionsUrl);
  await expect(
    page.getByRole("button", { name: "Proses antrean (maks. 10)" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Proses antrean (maks. 10)" }).click();
  await expect(
    page.getByText("Pemrosesan selesai", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: `Lihat order ${created.number}` }),
  ).toBeVisible();
  await capture(page, "exceptions-failed-desktop-light");
  await page.goto(orderUrl);
  await expect(
    page.getByText("Penerbitan gagal", { exact: true }),
  ).toBeVisible();
  await capture(page, "order-failed-retry");
  await page.getByRole("button", { name: "Coba ulang penerbitan" }).click();
  await expect(page.getByText("Dalam antrean", { exact: true })).toBeVisible();
  await page.goto(exceptionsUrl);
  await expect(
    page.getByRole("button", { name: "Proses antrean (maks. 10)" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Proses antrean (maks. 10)" }).click();
  await expect(
    page.getByText("Pemrosesan selesai", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Belum ada hasil", { exact: true }),
  ).toBeVisible();
  await capture(page, "exceptions-empty-desktop-light");
  await page.goto(orderUrl);
  await expect(page.getByText("Profil siap", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Periksa kode instalasi" }).click();
  await expect(
    page.getByText("Instalasi belum tersedia", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`LPA:1$demo.invalid$MOCK-${created.id}`, { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("img", { name: /QR instalasi/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Salin kode", exact: true }),
  ).toHaveCount(0);
  await capture(page, "installation-ready");
  await page.getByRole("button", { name: "Tutup rincian" }).click();
  await expect(
    page.getByText("Instalasi belum tersedia", { exact: true }),
  ).toHaveCount(0);
  await logout(page);

  await login(page, "finance");
  await page.goto(invoiceUrl);
  for (const label of ["Margin bruto", "Margin neto tercatat"]) {
    await expect(
      page.getByText(label, { exact: true }).locator("..").locator("dd"),
    ).toHaveText(/^Rp\s*37\.000$/);
  }
  await capture(page, "invoice-ready");
});

test("catalog errors recover, search is shareable and the ERP is usable on mobile with dark mode", async ({
  page,
}) => {
  await login(page, "admin");
  await expect(
    page.getByRole("link", { name: "Ringkasan", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("status", { name: "Memuat ringkasan" }),
  ).toHaveCount(0);
  await capture(page, "dashboard-desktop-light");
  await page.goto("/app/products");
  await expect(page.getByText("Japan explorer", { exact: true })).toBeVisible();
  await capture(page, "catalog-desktop");
  await page.getByRole("button", { name: "Edit Japan explorer" }).click();
  await expect(page.getByRole("dialog", { name: "Edit paket" })).toBeVisible();
  await capture(page, "catalog-edit-dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page
    .getByRole("searchbox", { name: "Cari katalog paket" })
    .fill("no-such-travel-package-e2e");
  await page.getByRole("button", { name: "Cari katalog paket" }).click();
  await expect(page).toHaveURL(/search=no-such-travel-package-e2e/);
  await expect(
    page.getByText("Belum ada hasil", { exact: true }),
  ).toBeVisible();
  await capture(page, "catalog-empty");
  await page.getByRole("button", { name: "Reset pencarian" }).click();
  await expect(page.getByText("Japan explorer", { exact: true })).toBeVisible();

  await page.route("**/api/backend/products?**", (route) =>
    route.fulfill({
      json: {
        error: {
          code: "backend_unavailable",
          message: "API belum tersedia. Coba lagi.",
          requestId: "synthetic-review",
        },
      },
      status: 503,
    }),
  );
  await page.reload();
  await expect(
    page.getByText("Data belum dapat dimuat", { exact: true }),
  ).toBeVisible();
  await capture(page, "catalog-error");
  await page.unroute("**/api/backend/products?**");
  await page.getByRole("button", { name: "Coba lagi" }).click();
  await expect(page.getByText("Japan explorer", { exact: true })).toBeVisible();
  await page.goto("/app/billing");
  await expect(
    page.getByRole("heading", { name: "Billing & finance" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await capture(page, "billing-desktop");

  await page.goto("/app");
  await page.getByRole("button", { name: "Tema tampilan" }).click();
  await page.getByRole("menuitem", { name: "Gelap", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("menu", { includeHidden: true })).toHaveCount(0);
  await capture(page, "dashboard-desktop-dark");
  await page.setViewportSize({ height: 844, width: 390 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await capture(page, "dashboard-mobile-dark");
  await page.getByRole("button", { name: "Buka atau tutup navigasi" }).click();
  await expect(
    page.getByRole("link", { name: "Paket & supplier", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tutup navigasi" }),
  ).toBeVisible();
  await capture(page, "mobile-navigation", { fullPage: false });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("link", { name: "Paket & supplier", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Buka atau tutup navigasi" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Buka atau tutup navigasi" }).click();
  await page.getByRole("button", { name: "Tutup navigasi" }).click();
  await expect(
    page.getByRole("link", { name: "Paket & supplier", exact: true }),
  ).not.toBeVisible();
});

test("admin onboards staff, changes access, revokes sessions and finds the changes in audit", async ({
  browser,
  page,
}) => {
  const email = `lintang-${crypto.randomUUID()}@staff.invalid`;
  const name = "Lintang Arunika";
  const initialPassword = "synthetic-staff-browser-password";
  const resetPassword = "synthetic-reset-browser-password";
  await login(page, "admin");
  await page.goto("/app/staff");
  await expect(page.getByRole("table")).toBeVisible();
  await capture(page, "staff-desktop-light");
  await page.getByRole("button", { exact: true, name: "Undang staf" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Buat undangan" }).click();
  await expect(page.getByLabel("Nama staf")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Nama staf")).toBeFocused();
  await capture(page, "staff-invitation-validation");
  await page.getByLabel("Nama staf").fill(name);
  await page.getByLabel("Email staf", { exact: true }).fill(email);
  await page.getByLabel("Peran staf").focus();
  await page.keyboard.press("Space");
  await page
    .getByRole("option", { exact: true, name: "Operasional" })
    .press("Enter");
  await expect(page.getByLabel("Peran staf")).toContainText("Operasional");
  const invitationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/backend/staff") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Buat undangan" }).click();
  const invitation = staffAccessLinkSchema.parse(
    await (await invitationResponse).json(),
  );
  await expect(
    page.getByRole("dialog", { name: "Tautan akses staf" }),
  ).toBeVisible();
  await expect(page.getByLabel("Tautan rahasia")).toHaveAttribute(
    "type",
    "password",
  );
  await capture(page, "staff-access-link-masked");
  await page.getByRole("button", { exact: true, name: "Tutup" }).click();
  await expect(page.getByLabel("Tautan rahasia")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Cari daftar staf" }).fill(email);
  await page.getByRole("button", { name: "Cari daftar staf" }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("search") === email,
  );
  await expect(page.getByRole("row").filter({ hasText: email })).toContainText(
    "Belum diaktifkan",
  );
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await capture(page, "staff-invitation-pending");

  const staffContext = await browser.newContext({
    baseURL: "http://localhost:3010",
    reducedMotion: "reduce",
    viewport: { height: 1000, width: 1440 },
  });
  const staffPage = await staffContext.newPage();
  try {
    await staffPage.goto("/auth/set-password");
    await expect(
      staffPage.getByText("Tautan tidak valid", { exact: true }),
    ).toBeVisible();
    await capture(staffPage, "password-setup-invalid");
    // Fragment grants must not appear in Playwright navigation diagnostics.
    await staffPage.evaluate(
      (url) => window.location.replace(url),
      invitation.url,
    );
    await expect(staffPage.getByLabel("Kata sandi baru")).toBeVisible();
    await expect(staffPage.getByLabel("Kata sandi baru")).toHaveAttribute(
      "placeholder",
      "Minimal 12 karakter",
    );
    await expect(staffPage.getByLabel("Ulangi kata sandi")).toHaveAttribute(
      "placeholder",
      "Ulangi kata sandi baru",
    );
    expect(await staffPage.evaluate(() => window.location.hash === "")).toBe(
      true,
    );
    await capture(staffPage, "password-setup-desktop-light");
    await staffPage.getByRole("button", { name: "Simpan kata sandi" }).click();
    await expect(staffPage.getByLabel("Kata sandi baru")).toBeFocused();
    await expect(staffPage.getByLabel("Kata sandi baru")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(staffPage.locator("#new-password-error")).toHaveText(
      "Gunakan minimal 12 karakter.",
    );
    await fillPassword(staffPage, "Kata sandi baru", initialPassword);
    await fillPassword(staffPage, "Ulangi kata sandi", initialPassword);
    await staffPage.getByRole("button", { name: "Simpan kata sandi" }).click();
    await expect(
      staffPage.getByText("Kata sandi disimpan", { exact: true }),
    ).toBeVisible();
    await capture(staffPage, "password-setup-complete");
    await staffPage.goto("/app");
    await expect(staffPage).toHaveURL(/\/auth\/login$/);
    await login(staffPage, "operations", { email, password: initialPassword });
    for (const path of ["staff", "audit", "billing"]) {
      await staffPage.goto(`/app/${path}`);
      await expect(
        staffPage.getByText("Akses dibatasi", { exact: true }),
      ).toBeVisible();
    }
    await staffPage.goto("/app/exceptions");
    await expect(
      staffPage.getByRole("button", { name: "Proses antrean (maks. 10)" }),
    ).toBeVisible();

    await page.reload();
    const manageAccess = page.getByRole("button", {
      name: `Kelola akses ${name}`,
    });
    await manageAccess.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Kelola akses staf" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(manageAccess).toBeFocused();
    await manageAccess.click();
    await page.getByLabel("Peran staf").click();
    await page.getByRole("option", { exact: true, name: "Keuangan" }).click();
    await page.getByRole("button", { name: "Simpan akses" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (await staffPage.request.get("/api/backend/dashboard")).status(),
    ).toBe(401);
    await login(staffPage, "finance", { email, password: initialPassword });
    await staffPage.goto("/app/exceptions");
    await expect(
      staffPage.getByRole("button", { name: "Proses antrean (maks. 10)" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: `Buat tautan ${name}` }).click();
    await expect(
      page.getByRole("alertdialog", { name: "Buat tautan akses baru?" }),
    ).toBeVisible();
    await capture(page, "staff-reset-confirmation");
    const resetResponse = page.waitForResponse((response) =>
      response
        .url()
        .endsWith(`/api/backend/staff/${invitation.staff.id}/access-link`),
    );
    await page
      .getByRole("button", { name: "Buat tautan baru", exact: true })
      .click();
    const reset = staffAccessLinkSchema.parse(
      await (await resetResponse).json(),
    );
    await expect(
      page.getByRole("dialog", { name: "Tautan akses staf" }),
    ).toBeVisible();
    await page.getByRole("button", { exact: true, name: "Tutup" }).click();
    expect(
      (await staffPage.request.get("/api/backend/dashboard")).status(),
    ).toBe(401);
    await staffPage.evaluate((url) => window.location.replace(url), reset.url);
    await expect(staffPage.getByLabel("Kata sandi baru")).toBeVisible();
    await fillPassword(staffPage, "Kata sandi baru", resetPassword);
    await fillPassword(staffPage, "Ulangi kata sandi", resetPassword);
    await staffPage.getByRole("button", { name: "Simpan kata sandi" }).click();
    await expect(
      staffPage.getByText("Kata sandi disimpan", { exact: true }),
    ).toBeVisible();
    await login(staffPage, "finance", { email, password: resetPassword });
    await staffPage.goto("/app/billing");
    await expect(
      staffPage.getByRole("heading", { name: "Billing & finance" }),
    ).toBeVisible();

    await manageAccess.click();
    await page.getByRole("switch", { name: "Izinkan akun masuk" }).click();
    await capture(page, "staff-deactivation-form");
    await page.getByRole("button", { name: "Nonaktifkan akun" }).click();
    await expect(page.getByText("Nonaktif", { exact: true })).toBeVisible();
    expect(
      (await staffPage.request.get("/api/backend/dashboard")).status(),
    ).toBe(401);
    await capture(page, "staff-inactive");
  } finally {
    await staffContext.close();
  }

  await page.goto(`/app/audit?search=${invitation.staff.id}`);
  await page.getByLabel("Aksi", { exact: true }).fill("staff.updated");
  await page.getByRole("button", { name: "Terapkan filter" }).click();
  await expect(page).toHaveURL(/action=staff.updated/);
  await expect(page.getByText("staff.updated", { exact: true })).toHaveCount(2);
  const audit = auditPageSchema.parse(
    await (
      await page.request.get(
        `/api/backend/audit?search=${invitation.staff.id}&action=staff.updated`,
      )
    ).json(),
  );
  expect(audit.events).toHaveLength(2);
  expect(
    audit.events.every((event) => event.resourceId === invitation.staff.id),
  ).toBe(true);
  expect(
    JSON.stringify(audit).includes(new URL(invitation.url).hash.slice(7)),
  ).toBe(false);
  await capture(page, "audit-filtered-desktop-light");
});
