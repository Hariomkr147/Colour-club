# Verification record

## PostgreSQL and administration release, 10 November 2026

The current implementation supersedes the local SQLite-only status below. Saved accounts, bets, rounds and ledger entries were imported into a separate PostgreSQL 18 cluster without deleting the original SQLite database. Import reconciliation passed.

Validation completed for this upgrade:

- Full native test run with `DATABASE_URL`: **22 passed, zero failed, zero skipped**. Includes the original rules/accounting checks, unsafe-total rejection and three real PostgreSQL integration tests.
- PostgreSQL tests cover concurrent duplicate requests, conditional debits, opposing submissions, multiple settlement workers, cutoff checks after lock waiting, verified-email enforcement, admin access denial/elevation, authenticator replay rejection, account blocking/session revocation, protected admin accounts, private-field exclusion, one-use verification/reset links and ledger reconciliation.
- Browser suite using Microsoft Edge: **3 passed**. Complete player registration/selection/submission/conflict/wallet/history/rules/reload/logout flow; responsive board at 320/375/768/1024/1440; administrator sign-in/authenticator, search, user details, block/unblock and every dashboard section.
- Main/player/auth/admin scripts passed syntax checks. Runtime npm dependency audit reported zero known vulnerabilities at the time of checking; this is not a penetration-test result. The non-root Docker image built successfully as `colour-club:local` with production dependencies only and no local credentials or database files in its build context.
- PostgreSQL backup created with `pg_dump`. A restore drill used a uniquely named temporary database, restored two accounts and one bet from that snapshot, found zero wallet/ledger differences and removed that temporary database. Live data was not overwritten.
- Browser measurements at all five widths: no document overflow and no visible button below 44px in either dimension.
- Computed-style text contrast scans on the player page, signup dialog and administrator sign-in reported no failing pairs. These scans do not replace a full accessibility audit.
- Browser reduced-motion emulation reported no hero animation. Result and dialog animations are brief and disabled by reduced-motion styles.

Browser review fixes: clipped the decorative orbit to its illustration bounds at 320px; kept narrow-screen number targets at 44px; ensured account-recovery feedback remains visible; kept healthy administrator status distinct from error feedback. Public calculation buttons, experimental footer copy and the old full-width demo banner were removed. The stake-dependent policy remains explicit in the rules, signup acknowledgement and prediction slip.

Fresh previews: `screenshots/professional-desktop.png`, `screenshots/professional-mobile.png`, `screenshots/admin-dashboard.png`. The accounts visible in admin screenshots are actual local test records, not invented customer claims.

Launch limits: no public deployment, actual SMTP inbox delivery, independently measured large-load capacity, multi-device/screen-reader certification, external penetration test or legal approval. Docker was built locally; the Render template was not deployed or validated through the provider's service. See README.md and LAUNCH.md for concrete external inputs and launch gates.

## Completion check, 10 November 2026

`npm test`: **18 passed, 0 failed**. `npm run check`: passed. The local server was restarted and its health endpoint returned `ok: true`.

Two final defects were corrected: room snapshots now create/settle the current round if the periodic scheduler has not reached its boundary yet; history refreshes preserve unchanged DOM nodes so routine polling does not discard keyboard focus. New regression tests cover immediate acceptance of the advertised boundary round and unchanged/changed history for signed-out and signed-in views. The history regression runs the real browser script against a minimal DOM test double; it is not a new browser or assistive-technology certification.

The original browser review and screenshots below remain dated 7 November. Public load, live hosting and production services remain outside this local-demo handoff.

Original review: 7 November 2026. Environment: Windows, Node 24.19.0; local browser testing against `http://127.0.0.1:3000`.

## Automated checks

`npm test`: **16 passed, 0 failed**.

- Every selection evaluated against all ten outcomes, including exclusive Violet mapping.
- Supplied 1,000 Red / 2,000 Green / 500 Violet example produces 1,500 points of house surplus.
- Empty-pool tie handling covers every candidate.
- Every bet's uniform-average payout is at most 95% of its stake; 500 generated mixed portfolios satisfy the house bound.
- Exact-number liabilities change the minimum correctly.
- Invalid stakes/multipliers and opposing selections rejected; eighth distinct number rejected, repeat permitted.
- All four rooms use aligned boundaries and a five-second lock.
- Duplicate registration cannot issue another welcome grant for the same email.
- Same-key retries debit once, including retries after lock; changed payload rejected.
- Exact lock boundary, pre-start requests and insufficient balances leave funds protected.
- Separate submissions accumulate restrictions within a room and remain isolated between rooms.
- Settlement is exactly once, and wallets reconcile to ledger entries.
- Restart catch-up does not manufacture empty downtime history.
- An injected ledger failure rolls back both debit and prediction.
- A real on-disk database is closed/reopened twice; balance and pending settlement survive and do not duplicate.
- HTTP tests cover signup, acknowledgement validation, cookie flags, concurrent same-key submission, anonymous data isolation, settlement, logout, login rotation, wrong-password rejection, cross-origin rejection and static-file isolation.

`npm run check`: server and browser JavaScript syntax checks passed. Rules/store/test files were parsed and executed by the test runner.

## Browser interaction record

| Action | Observed result |
|---|---|
| Join the club | Signup dialog opens |
| Empty signup submission | Name, email, password and acknowledgement invalid; no account created |
| Register a local test account | Dialog closes; 10,000-point wallet appears |
| All 15 colour/number/size choices | Each updates the slip's selection label |
| All four base presets | Stake input changes |
| All six multipliers | Multiplier selection and totals change |
| All four duration tabs | Selected room changes; correct selected state |
| Place 10 points on Green | Accepted message, balance 9,990, pool 10 |
| Then attempt Red in the same round | Explicit conflict error, no additional debit |
| My predictions | Saved Green prediction appears with stake and pending result |
| Point activity | +10,000 grant and -10 stake entries appear |
| Game history / audit | Published results and all ten liabilities shown; selected result marked |
| Game rules / How it works / Rules & payouts | Correct rule dialog opens and closes |
| Escape inside rules | Dialog closes |
| Demo privacy | Storage and local-demo limitations shown |
| Sign out | Signup and sign-in actions return |
| Sign in again | Existing 9,990 balance restored; no second grant |
| Login/signup toggle | Fields and primary action change appropriately |
| Signed-out My predictions | Sign-in action opens account dialog |
| Play navigation / Home key | Navigates to game / returns view to top |
| Reload | Session persists when signed in; rooms/history reload correctly |

The test account is named **Demo tester** with an `example.test` address. It is local test data, not fabricated social proof. It was signed out at handoff. Its recorded test prediction remains in the database; public round history is generated by the running engine, not seeded mock results.

## Appearance and accessibility review

Widths checked: **320, 375, 768, 1024 and 1440 px**. The browser reported document width no larger than viewport at each size. All visible buttons measured at least 44 × 44 px after corrections. Desktop and mobile screenshots are in `screenshots/`.

The first review found undersized multiplier/audit controls and mobile confirmation positioned after history. Corrections: use a three-column multiplier grid, enforce 44px targets, and place the slip before history in both DOM and mobile visual order. The final mobile check confirmed confirmation precedes history.

A computed-style contrast scan of visible, enabled desktop text found **zero failing colour/background pairs** at the 4.5:1 normal / 3:1 large-text thresholds. This is a targeted check, not an accessibility certification. Dialog labels, native fields, visible focus styling, Escape behaviour, semantic headings and reduced-motion styles were inspected. The page has exactly one H1.

Final browser console inspection returned no warning/error entries; the earlier deliberately rejected conflicting submission was handled in the interface. The server error log was empty at final inspection.

## Delivery gate for the delivered local UI

| Rule / check | Result and evidence |
|---|---|
| R-02 copy | PASS: UI source scan found no em dash |
| R-03 responsiveness | PASS: five measured widths without overflow; all visible button targets at least 44px |
| R-17 real figures | PASS: pool, history, wallet and ledger read from the API; welcome value is the actual configured grant |
| R-18 testimonials | PASS: none included |
| R-23 assets | PASS: product name in text; no invented logo, person image or testimonials |
| R-24 navigation | PASS: Play points to game; home points to app; dialogs are implemented |
| R-25 contrast | PASS for scanned visible enabled desktop text: no failing pairs |
| R-26 interaction | PASS: interaction record above covers control families and all selection/preset/multiplier controls |
| R-27 data states | PASS: initial loading, empty history, disconnected/error feedback and submit success/rejection exist; empty and validation states observed |
| R-28 FAQ | PASS: no filler FAQ |
| R-32 keyboard | PASS for reviewed flow: native controls, visible focus styles and tested Escape closure; source and mobile order agree |
| R-33 implementation | PASS: features edited directly in source using patches |
| R-34 themes | PASS: one deliberately selected light theme; no broken or unimplemented theme toggle |
| R-35 execution | PASS: app running, tests executed, click-through recorded |
| R-36 claims | PASS: no invented performance/security/customer claims; load targets labelled proposed |
| R-37 direction | PASS: design direction and rationale recorded in DESIGN.md |
| R-38 content | PASS: live server content and explicit demo disclosures; no fabricated activity |
| R-39 semantics | PASS for inspected scope: native named controls, labels, heading/landmark structure, cursor/focus states, reduced-motion rule |
| R-40 performance mechanisms | PASS: no blocking third-party scripts/fonts/media; no fabricated performance score |
| Purpose checks R-01/04/06/07/08/09/10/12/13/14/19/22 | PASS: semantic game colours, system typography, restrained ticket shadow and result circles have written purposes; no glass, glow, decorative icons or perpetual animation |
| Liveliness | PASS: ENERGY 2 / RHYTHM 2 / MOTION 1, countdown focus, ticket balance panel and repeated number-piece motif |
| C-1 through C-5 and quality locks | PASS within this prototype's reviewed scope: deliberate structure, working controls, real data and bounded claims; radius/palette/type choices documented |

## Not tested or not implemented

- No real-customer load test, public penetration test, PostgreSQL contention test or distributed failover.
- No induced browser network outage, lost-response retry E2E or operating-system suspend test; API idempotency and persisted recovery were tested independently.
- No complete screen-reader audit, multi-browser/device-lab run, Lighthouse score or field Web Vitals measurement.
- No live email delivery/verification/recovery, admin interface or backup-restore service.
- No public deployment, independent fairness certification or legal approval.

These are explicit public-launch gates in PLAN.md, not silent claims that the local demo already meets them.
