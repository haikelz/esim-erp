# Product Docs

This directory contains current consumer-product behavior derived from real
accepted intent. Harness deliberately ships no fake product domains.

Retain product intent and rationale here when existing code, types, tests, and
examples do not express them. Link to implementation knowledge instead of
copying it into summaries; no new document is required merely to record work.

## Current Product Contract

The ERP contract remains in [PRODUCT.md](../../PRODUCT.md). Operational
instructions and architecture remain in [README.md](../../README.md).
[Shared schemas](../../packages/contracts/src/index.ts) and executable tests
define the current public interface; [Midtrans evidence](../MIDTRANS-VERIFICATION.md)
records the payment boundary actually exercised.

## Keeping Intent Current

Keep existing explanations accurate when their product intent or rationale
changes. Code, tests, and observable behavior supply implementation proof.
Plans and decision records are used only when chosen by the user or consumer
workflow; a behavior change does not itself require another document.
