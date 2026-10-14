import { mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  dashboardSchema,
  orderInputSchema,
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

async function login(
  page: Page,
  role: "admin" | "sales" | "operations" | "finance",
) {
  await page.goto("/auth/login");
  await page.getByLabel("Email staf").fill(`${role}@demo.invalid`);
  // Do not put a password into a locator action's diagnostic call log or a trace.
  await page.getByLabel("Kata sandi").evaluate((input, secret) => {
    if (!(input instanceof HTMLInputElement))
      throw new Error("Password input is absent");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Native input setter is absent");
    setter.call(input, secret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, password);
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
  const created: unknown = await (await createdResponse).json();
  if (
    typeof created !== "object" ||
    created === null ||
    !("id" in created) ||
    typeof created.id !== "string" ||
    !("invoiceId" in created) ||
    typeof created.invoiceId !== "string"
  )
    throw new Error("Order creation did not return its invoice reference");
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
  await expect(
    page.getByRole("button", { name: "Simulasikan pelunasan" }),
  ).toHaveCount(0);
  await expect(page.getByText("Belum dibayar", { exact: true })).toBeVisible();
  await capture(page, "invoice-unpaid");
  // This guarded API fixture is not evidence of a real Midtrans payment.
  const payment = await page.request.post(
    `/api/backend/invoices/${created.invoiceId}/simulate-payment`,
    { headers: { Origin: "http://localhost:3010" } },
  );
  expect(payment.status()).toBe(200);
  await page.reload();
  await expect(
    page.getByText("Belum diverifikasi Midtrans", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Provisioning gagal", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Belum terealisasi", { exact: true }),
  ).toBeVisible();
  await capture(page, "invoice-paid-fulfillment-failed");
  await page.goto(orderUrl);
  await expect(
    page.getByRole("button", { name: "Coba ulang provisioning" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Periksa kode instalasi" }),
  ).toHaveCount(0);
  await logout(page);

  await login(page, "operations");
  await page.goto(orderUrl);
  await expect(
    page.getByText("Provisioning gagal", { exact: true }),
  ).toBeVisible();
  await capture(page, "order-failed-retry");
  await page.getByRole("button", { name: "Coba ulang provisioning" }).click();
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
  await expect(page.getByText(/^Rp\s*37\.000$/)).toBeVisible();
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
