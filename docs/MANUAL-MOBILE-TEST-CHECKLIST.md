# Manual Mobile QA Checklist (MuviFy)

Date: 2026-03-26 (base) — extended 2026-08-14 (Frente 17, segunda camada) with screens/flows added
after the base date. NOT re-verified end to end since 2026-03-26 — only the "Extended coverage"
section below is current. Referenced from `docs/RELEASE-READINESS-CHECKLIST.md` (mobile checklist).
Mode: dark
Scope: device manual validation after automated pass

## Runtime already prepared on PC

- Backend API: running on `http://localhost:3000`
- Expo Metro (LAN): running on port `8081`
- Mobile API base URL configured to `http://192.168.1.10:3000/api`
- Test users generated in `logs/manual-test-users.txt`

## Open app on phone (only steps you need now)

1. Connect phone and PC to the same Wi-Fi.
2. Open Expo Go on phone.
3. Tap "Enter URL manually" (or similar option in Expo Go).
4. Paste this URL exactly: `exp://192.168.1.10:8081`
5. Wait app bundle load.
6. Expected: splash screen appears and app opens.

## Smoke sanity checks

- [ ] Open app first time. Expected: splash renders and app does not crash.
- [ ] Keep app open 2-3 minutes. Expected: no freeze/white screen.
- [ ] Force close and reopen app. Expected: app reopens consistently.

## Auth and onboarding flow

- [ ] Onboarding slide 1 -> tap Next. Expected: navigates to slide 2.
- [ ] Onboarding slide 2 -> tap continue CTA. Expected: goes to auth flow.
- [ ] Login screen visual. Expected: fields and primary action visible and tappable.
- [ ] Register new client user from app. Expected: register success and authenticated session.
- [ ] Logout and register new provider user from app. Expected: register success and authenticated session.
- [ ] Forgot password by EMAIL. Expected: success message shown.
- [ ] Forgot password by SMS. Expected: success message shown (dev simulated flow).
- [ ] Session expired path. Expected: redirected to session-expired screen and can re-login.

## Existing-user login test (pre-created users)

Use credentials from `logs/manual-test-users.txt`.

- [ ] Login as pre-created client. Expected: client home loads.
- [ ] Logout and login as pre-created provider. Expected: provider home loads.

## Client flow checklist (screen-by-screen)

- [ ] Client Home. Action: open shortcuts/cards. Expected: data loads without API error.
- [ ] Categories. Action: open categories list. Expected: list visible and selectable.
- [ ] Search professionals. Action: search by name and clear search. Expected: results update.
- [ ] Professionals list. Action: open one profile. Expected: detail screen opens.
- [ ] Professional detail. Action: read profile sections. Expected: price/bio/availability visible.
- [ ] Favorite add. Action: tap favorite. Expected: favorite state updates.
- [ ] Favorites screen. Action: open favorites. Expected: provider appears in list.
- [ ] Favorite remove. Action: remove item. Expected: removed from list.
- [ ] Consultancy request screen. Action: choose offer + fill text fields + submit. Expected: request created.
- [ ] Archived requests (client). Action: open archived list. Expected: archived items/filter work.
- [ ] Create booking. Action: pick provider/date/time/notes and submit. Expected: booking created.
- [ ] Booking confirmation. Action: confirm and continue. Expected: returns to bookings/home flow.
- [ ] Client bookings list. Action: filter tabs by status. Expected: filtered lists correct.
- [ ] Client booking detail. Action: open one booking. Expected: status and metadata correct.
- [ ] Attendance code visibility. Action: near booking time, open detail. Expected: 6-digit code available.
- [ ] Attendance QR visibility. Action: open detail/confirm completion. Expected: QR rendered.
- [ ] Confirm completion (client). Action: tap selfie flow, save selfie, confirm completion. Expected: confirmation accepted.
- [ ] Review professional. Action: submit rating/comment after completed booking. Expected: review saved.
- [ ] Payment method screen (client). Action: open and save payment method data. Expected: saved and no error.
- [ ] My training. Action: open list/details. Expected: correct empty or populated state.
- [ ] Promotions. Action: open promotions feed. Expected: cards render and scroll is smooth.
- [ ] Notifications. Action: open notifications. Expected: list visible, no duplicate noise.
- [ ] Support. Action: open support screen. Expected: screen opens and text/buttons render.
- [ ] Generic error screen. Action: trigger from app path if available. Expected: clear recovery action available.

## Provider flow checklist (screen-by-screen)

- [ ] Provider Home. Action: open quick actions/cards. Expected: no loading deadlock.
- [ ] Provider Agenda. Action: open agenda and refresh. Expected: bookings list refreshes.
- [ ] Booking detail (provider). Action: open target booking. Expected: detail screen complete.
- [ ] Confirm booking status. Action: change status to CONFIRMED when applicable. Expected: success message/status update.
- [ ] Attendance validate by code. Action: type 6-digit code and validate. Expected: validation success.
- [ ] Attendance validate by QR scanner. Action: open scanner, scan client QR, validate. Expected: success.
- [ ] Confirm completion (provider). Action: capture selfie, save, confirm completion. Expected: completion accepted.
- [ ] Booking payment status. Action: open booking payment status screen. Expected: method/status amounts visible.
- [ ] Professional consultancy center. Action: open offers/requests management. Expected: sections load.
- [ ] Archived requests (provider). Action: open archived list/filter. Expected: filter works.
- [ ] Availability manager. Action: select weekdays, set start/end, save. Expected: slots persisted.
- [ ] Professional profile editor. Action: update profile fields and save. Expected: saved and reflected.
- [ ] Payout/financial screen. Action: open metrics and refresh. Expected: stable render and data.
- [ ] Bank account setup (provider app-side). Action: fill and save bank data. Expected: success.
- [ ] Notifications (provider). Action: open panel. Expected: list opens correctly.
- [ ] Settings (provider). Action: open settings and test navigation links. Expected: all routes valid.
- [ ] Support (provider). Action: open support route. Expected: stable screen.

## Cross-role business-critical flows

- [ ] Full presential journey. Action: client books -> provider confirms -> attendance code/QR validated -> selfie completion by both sides. Expected: final completed booking and payment flow progression.
- [ ] Cancellation path. Action: cancel pending/confirmed booking. Expected: booking status becomes cancelled.
- [ ] One-sided completion. Action: only one side confirms completion. Expected: partial state (no invalid finalization).
- [ ] Role isolation. Action: login as client then provider and compare menus. Expected: each role sees only own routes.
- [ ] Reopen persistence. Action: close app and reopen while token valid. Expected: session restored.

## Offline and connectivity checks

- [ ] Start app with internet OFF. Expected: offline-required screen appears.
- [ ] Tap retry while offline. Expected: remains blocked with clear message.
- [ ] Turn internet ON and retry. Expected: app recovers to normal flow.
- [ ] Mid-session internet drop. Expected: graceful behavior; no hard crash.

## UI and device checks

- [ ] Portrait layout. Expected: no clipped/overlapping critical controls.
- [ ] Keyboard behavior in forms. Expected: fields remain reachable and submit buttons usable.
- [ ] Camera permission prompt. Expected: handled correctly and recoverable if denied.
- [ ] Notification permission prompt. Expected: no crash when denied.

## Extended coverage (added Frente 17, segunda camada, 2026-08-14)

Screens/flows built after the base checklist date (2026-03-26) that aren't covered above.

- [ ] Community feed (client). Action: open feed, like/comment a post, follow/unfollow a friend. Expected: state updates without error.
- [ ] Weekly streak + goal. Action: complete a session, check streak/goal card on home. Expected: reflects real progress.
- [ ] Connected devices. Action: open "dispositivos conectados" in settings, disconnect a session. Expected: session list updates.
- [ ] Financial goals (provider). Action: set/edit a monthly goal, check progress card. Expected: persists and reflects real revenue.
- [ ] Financial students / manual student (provider). Action: add manual student, register manual payment. Expected: reflected in dashboard.
- [ ] Presential package purchase (client). Action: buy a package, use one session credit on a booking. Expected: remaining sessions decrease correctly.
- [ ] Combo offer (client). Action: view a combo offer, book it. Expected: price shown matches price charged (known area of past bugs).
- [ ] Dispute flow (client and provider). Action: open a resolved/open dispute from settings. Expected: correct status and history shown.
- [ ] Account deletion (client, LGPD). Action: Settings > Excluir minha conta > confirm password. Expected: destructive confirmation, session ends, data actually removed (spot-check via admin or DB if available — do NOT run against a real user's data casually).
- [ ] Data export (client). Action: Settings > Baixar meus dados. Expected: file generated/shared, not just a raw JSON message.
- [ ] Admin: CREF validation queue. Action: approve/reject a pending CREF. Expected: status updates, provider notified.
- [ ] Admin: dispute detail + resolution. Action: resolve a dispute (refund/deny). Expected: real Mercado Pago action reflected, no double-processing on repeated taps.
- [ ] Admin: support ticket reply. Action: reply to an open ticket. Expected: user receives it (in-app + email).
- [ ] Accessibility spot-check. Action: enable TalkBack/VoiceOver, go through login + one critical form. Expected: every icon-only button and form field announces correctly (see `docs/RELEASE-READINESS-CHECKLIST.md`, item de acessibilidade).

## Exit criteria (manual GO)

- [ ] No crash or white screen in all tested flows.
- [ ] Client and provider critical journeys complete successfully.
- [ ] Presential attendance validation (code/QR) works end-to-end.
- [ ] Completion selfie flow works end-to-end.
- [ ] Main network/offline transitions are stable.

