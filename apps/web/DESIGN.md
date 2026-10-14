# Internal ERP interface

## Surface and composition

Operational staff application, not marketing or storefront. ReUI `base-nova`
owns components, spacing variants, radius, shadows, and overlay behavior.
Use the installed source and MCP API; do not recreate ReUI with custom panels.

The operational archetype is a shell with sidebar, page heading, metrics where
useful, and a Frame-led records table/detail. Login is a separate Card-led flow.
Dense actions use the component's `size="sm"`; tables use the installed
`c-data-grid-23` composition and TanStack v9, server pagination and search.

## Visual rules

- Geist typography, `text-sm` body, `text-xs` metadata, clear heading hierarchy,
  tabular financial values, monospace references. No decorative dashboard art.
- Semantic light/dark tokens from the installed style. Payment and fulfillment
  are separate ReUI Badge states; warning/error use ReUI Alert variants.
- Parent-owned grouping and gaps; no nested Card/Frame surface families. Wide
  desktop layout collapses to one column; records tables scroll within their
  container rather than widening the mobile document.
- Lucide icons only, decorative icons hidden from assistive technology.
- A single opacity-only 200 ms Framer Motion page transition follows the user's
  explicit requirement. This is the documented exception to ReUI's preferred
  `motion/react` import. Overlay/table animations remain library-owned.
- `MotionConfig reducedMotion="user"`; no animated table rows or hover gestures.

## Behavior and states

Every remote-data region handles loading with Skeleton, empty with one useful
action, and failure with Retry. Loading/error states are announced. Forms show
linked labels and field errors; pending actions disable duplicate submission.
Payment actions create a hosted Snap link or reconcile its server-side status.
The interface has no payment-fixture controls or supplier scenario selector.

Navigation uses real links and `aria-current`; there is a skip link, keyboard
focus, and a mobile Sidebar/Sheet. Staff role controls visible actions, while
server authorization is authoritative. Theme has light/dark/system choices.

Use operational copy without demo/development/static labels. Preserve facts:
supplier disconnected, catalog and recorded balance unverified, and Midtrans
environment sandbox. Legacy fixture payments display “Belum diverifikasi
Midtrans” and “Catatan pembayaran”; never relabel them as verified Snap.

“Periksa kode instalasi” requests the audited installation endpoint. Non-service
profiles display “Instalasi belum tersedia”, with no QR, activation code, or copy
action. “Tutup rincian” closes that state; reload does not reveal installation.
Profile ready is not device installation/network activation. Installation data
never belongs in automation payloads. Technical source identifiers and local
environment guards remain compatible; wording does not rewrite business state.

## Review

Run ReUI audit and C1–C4 against handwritten feature files; never use their
checks to restyle installed library source. Render dashboard, catalog/form,
order detail, pending/paid/unverified invoice, unavailable installation,
empty/error/retry, dark mode,
and mobile navigation. Execute browser actions, inspect screenshots, then run
lint/typecheck/build. Review captures are private under `.amp/in/artifacts/`.

One installed data-grid cell-selection guard was narrowed with a local `row`
binding to preserve strict `noUncheckedIndexedAccess`; styling/API was not changed.
