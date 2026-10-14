import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createMidtransGateway } from "./midtrans";

const TEST_SERVER_KEY = "test-only-midtrans-server-key-not-a-credential";
const ORDER_ID = "erp-test-order";

function responseTransport(payload: Record<string, unknown>) {
  return Object.assign(async () => Response.json(payload), {
    preconnect: fetch.preconnect,
  });
}

function statusGateway(overrides: Record<string, unknown> = {}) {
  return createMidtransGateway(
    TEST_SERVER_KEY,
    responseTransport({
      currency: "IDR",
      gross_amount: "149000.00",
      order_id: ORDER_ID,
      transaction_id: "test-transaction",
      transaction_status: "settlement",
      ...overrides,
    }),
  );
}

test("notification signatures preserve the exact amount string", async () => {
  const gateway = createMidtransGateway(TEST_SERVER_KEY);
  const notification = {
    gross_amount: "149000.00",
    order_id: ORDER_ID,
    signature_key: createHash("sha512")
      .update(`${ORDER_ID}200149000.00${TEST_SERVER_KEY}`)
      .digest("hex"),
    status_code: "200",
  };

  expect(await gateway.verifyNotification(notification)).toBe(true);
  expect(
    await gateway.verifyNotification({
      ...notification,
      signature_key: notification.signature_key.toUpperCase(),
    }),
  ).toBe(true);
  expect(
    await gateway.verifyNotification({
      ...notification,
      gross_amount: "149000",
    }),
  ).toBe(false);
  expect(
    await gateway.verifyNotification({
      ...notification,
      order_id: "different-order",
    }),
  ).toBe(false);
});

test.each([
  { transaction_status: "settlement", expected: "paid" },
  { transaction_status: "capture", fraud_status: "accept", expected: "paid" },
  {
    transaction_status: "capture",
    fraud_status: "challenge",
    expected: "pending",
  },
  { transaction_status: "capture", fraud_status: "deny", expected: "failed" },
  { transaction_status: "capture", expected: "pending" },
  { transaction_status: "expire", expected: "expired" },
  { transaction_status: "refund", expected: "review" },
  { transaction_status: "partial_chargeback", expected: "review" },
])(
  "Midtrans $transaction_status/$fraud_status maps to $expected",
  async (input) => {
    const { expected, ...status } = input;

    expect(await statusGateway(status).getStatus(ORDER_ID)).toEqual({
      gatewayOrderId: ORDER_ID,
      grossAmount: "149000.00",
      status: expected,
      transactionId: "test-transaction",
    });
  },
);

test.each([
  { currency: "USD" },
  { order_id: "another-order" },
  { gross_amount: "1.49e5" },
])(
  "status responses for a different currency, order or amount format are rejected",
  async (status) => {
    await expect(
      statusGateway(status).getStatus(ORDER_ID),
    ).rejects.toMatchObject({
      code: "invalid_payment_status",
    });
  },
);

test("unknown payment states require manual review rather than becoming paid", async () => {
  await expect(
    statusGateway({ transaction_status: "unrecognized" }).getStatus(ORDER_ID),
  ).rejects.toMatchObject({ code: "unsupported_payment_status" });
});

test("Snap submits whole-IDR totals with server-side authentication", async () => {
  let submitted: Request | undefined;
  const transport = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      submitted = new Request(input, init);
      return Response.json({
        redirect_url:
          "https://app.sandbox.midtrans.com/snap/v4/redirection/test-token",
        token: "test-token",
      });
    },
    { preconnect: fetch.preconnect },
  );
  const gateway = createMidtransGateway(TEST_SERVER_KEY, transport);

  const link = await gateway.createLink({
    amountIdr: 149500,
    customerEmail: "customer@demo.invalid",
    customerName: "Synthetic Traveller",
    gatewayOrderId: ORDER_ID,
  });

  expect(link).toBe(
    "https://app.sandbox.midtrans.com/snap/v4/redirection/test-token",
  );
  if (!submitted) throw new Error("No request reached the payment transport");
  expect(submitted.url).toBe(
    "https://app.sandbox.midtrans.com/snap/v1/transactions",
  );
  expect(submitted.method).toBe("POST");
  expect(submitted.headers.get("Authorization")).toBe(
    `Basic ${btoa(`${TEST_SERVER_KEY}:`)}`,
  );
  expect(await submitted.json()).toEqual({
    credit_card: { secure: true },
    customer_details: {
      email: "customer@demo.invalid",
      first_name: "Synthetic Traveller",
    },
    transaction_details: { gross_amount: 149500, order_id: ORDER_ID },
  });
});

test.each([
  "https://app.midtrans.com/snap/test",
  "https://app.sandbox.midtrans.com.evil.invalid/snap/test",
  "https://user@app.sandbox.midtrans.com/snap/test",
  "http://app.sandbox.midtrans.com/snap/test",
])(
  "Snap rejects a redirect outside the authenticated sandbox origin",
  async (url) => {
    const gateway = createMidtransGateway(
      TEST_SERVER_KEY,
      responseTransport({ redirect_url: url, token: "test-token" }),
    );

    await expect(
      gateway.createLink({
        amountIdr: 149000,
        customerEmail: "customer@demo.invalid",
        customerName: "Synthetic Traveller",
        gatewayOrderId: ORDER_ID,
      }),
    ).rejects.toMatchObject({ code: "invalid_payment_url" });
  },
);
