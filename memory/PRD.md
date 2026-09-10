# Nafis Ride - Product Requirements

## Overview
Ride-sharing mobile app for Alwar city, Rajasthan (similar to Rapido). Single app with three roles: Rider, Captain, Admin. Built with Expo React Native + FastAPI + MongoDB.

## Colors & Design
- Primary: Golden Yellow `#FFCC00`
- Ink: Dark Slate `#222222`
- Design guidelines: `/app/design_guidelines.json`

## Auth
- Emergent-managed Google Auth
- After login, user picks Role (Rider or Captain)
- Admin access via 5-tap on logo (role-select or profile) + claim code `NAFIS-ADMIN`

## Rider Flow
- Home tab: map background + bottom sheet with pickup/drop autocomplete of Alwar landmarks
- Choose vehicle: Nafis Bike or Nafis Auto
- Fare: `base + per_km * distance` (default ₹15 base + ₹8/km). Auto adds premium.
- Book Ride -> creates ride with status REQUESTED -> navigates to Ride Status
- Ride Status polls every 3s: Searching → Captain Arriving → In Progress → Completed
- Rides tab: history
- Profile tab: sign out, admin access

## Captain Flow
- Home: Online/Offline toggle; simulated GPS updates every 8s
- Polls pending rides every 4s; on new ride shows big modal with sound + haptics
- Accept Ride → moves ride to ACCEPTED, links to captain
- Rides tab: accepted rides + Complete Ride button

## Cancel Reasons
- Riders cancelling a live ride pick from 7 predefined reasons (Captain took too long, Wrong pickup, Fare too high, etc.)
- Stored on the ride as `cancel_reason` + `cancelled_by` + `cancelled_at`
- Admin Overview shows the top cancellation reasons over the last 30 days

## Captain Earnings Tile
- Captain home shows a live earnings card: Today ₹ / Rides / Active + All-time earnings from completed rides
- Refreshes every 10 seconds when captain is online; endpoint: `GET /api/captains/me/earnings`

## Weekly Revenue Chart
- Admin Overview → 7-day revenue bar chart (highest bar in Golden Yellow)
- Endpoint: `GET /api/admin/revenue/weekly` returns per-day revenue + ride count

## Peak Hour Insights
- Admin Overview → 24-hour bar chart (rides in yellow, cancellations in red slim overlay)
- Uses MongoDB `$hour` with IST timezone (Asia/Kolkata)
- Endpoint: `GET /api/admin/peak-hours` (last 30 days)

## Rider Rewards
- Every 5th completed ride grants ₹50 credit automatically (idempotent per ride via `reward_granted` flag)
- Rider profile shows credit balance + progress bar toward next reward
- Booking screen shows "Use ₹X Nafis credit" toggle that discounts fare
- Endpoints: `GET /api/rewards/me`, `POST /api/rides` with `apply_credits: true`

## Rate the Captain
- On ride receipt, rider taps 1-5 stars — instantly submitted
- Server updates the captain's `avg_rating` + `total_ratings` on each rating
- Endpoint: `POST /api/rides/{id}/rate`

## Force Complete (Admin)
- Admin Rides tab shows "Force Complete" button on any non-terminal ride
- Also triggers reward + referral bonus logic
- Endpoint: `POST /api/admin/rides/{id}/force-complete`

## Captain Rush Bonuses
- Server checks last 30 days per-hour ride distribution
- If the current IST hour's rides exceed 1.5× the daily hourly average (min 2), it's a rush hour
- Endpoint: `GET /api/peak/now` → `{ is_peak, current_hour_rides, bonus_multiplier, message }`
- Captain Home shows a yellow **Go Online →** rush banner when offline during a rush hour

## Referral Credits
- Every user gets a `referral_code` (e.g. `NAFAB123X`) on first login
- Rider Profile shows own code + native Share button + input to apply a friend's code
- On the referred rider's first completed ride, both parties receive ₹50 credit (idempotent via `referral_bonus_granted`)
- Endpoints: `POST /api/referral/apply`, `referral_code` exposed via `GET /api/rewards/me`

## Ride Chat
- In-ride messaging between rider and captain via canned quick messages + free-text
- Rider opens from the ride status screen (chat icon on driver card)
- Captain opens from Rides tab per active ride (Chat button)
- Endpoints: `GET/POST /api/rides/{id}/messages`, `GET /api/rides/{id}/messages/canned`
- Blocked after ride ends (COMPLETED/CANCELLED)

## Real-time
- Polling: Ride status (2s on ride-status, 4s on captain), Driver locations (8s)
- **Live Driver Trails**: server-side simulation of captain movement between pickup and drop, interpolated by elapsed time since `accepted_at`. Auto-advances status ACCEPTED → ARRIVING (5s) → IN_PROGRESS (30s) → COMPLETED (120s). Client polls `GET /api/rides/{id}` which returns `captain_location`.

## Ride Receipt (in-app)
- Auto-shown on the rider's Ride Status screen when status turns COMPLETED
- Shows pickup, drop, distance, vehicle, captain name, RJ 02 vehicle number, fare, cash payment method

## Phone Collection
- On first ride booking, if `user.phone` is empty, rider is prompted for a 10-digit mobile number (stored as `+91...` on the user record). Skippable.
- Vehicle numbers auto-generated for captains in `RJ 02 XX 0000` format when role is set to captain.

## Maps
- Mapbox GL JS inside a WebView (works in Expo Go)
- Token: `EXPO_PUBLIC_MAPBOX_TOKEN` in `frontend/.env`
- Real-time interactive dark map centered on Alwar
- Mapbox Geocoding API for landmark autocomplete (biased to Alwar, IN)
- Mapbox Directions API for pickup → drop route polyline + real distance/duration

## Known limitations (MVP)
- Real-time via polling, not WebSockets
- Web preview still shows the placeholder if no token; native shows real map

## Digest Emails (Resend)
- **Weekly digest** sent every Monday at 08:00 IST (Asia/Kolkata) via APScheduler cron.
- Three templates:
  - **Rider** — rides + spend + credits + leaderboard section (with your rank if top-3)
  - **Captain** — earnings + rides + rating + streak bonus badge (if 5+ consecutive days)
  - **Admin** — platform revenue + rides + top 5 captains + rider leaderboard + streaking captains
- Emergent-managed Resend proxy (no user API key). Sender display name `Nafis Ride Alwar`.
- Endpoints:
  - `POST /api/admin/digest/send` — manual trigger; also grants leaderboard credits + streak bonuses.
  - `POST /api/admin/digest/preview` — render a template without sending/granting. `email` optional (auto-picks eligible user). Returns `{subject, html, data, target_email}`.
  - `POST /api/admin/digest/test-send` — send a small test email to a supplied address.
  - `GET /api/admin/digest/runs` — recent run history from `digest_runs` collection.
- Admin dashboard: "Send weekly digest now" button, three preview buttons (Rider / Captain / Admin) that open a WebView modal with the actual HTML the recipient will see, test-send form, and recent runs list.
- Guardrails from Resend playbook enforced on every send (`_assert_safe_email`).

## Rider Weekly Leaderboard
- Top 3 spenders (COMPLETED rides, last 7 days) win credit boosts: **₹100 / ₹75 / ₹50**.
- Auto-granted when the weekly digest runs; idempotent per ISO week via `users.last_leaderboard_week`.
- Shown at top of rider digest with rank banner ("You ranked #1 this week!") and the full leaderboard table highlighting the recipient's row. Also shown in the admin digest.
- Rider digest summary contains `leaderboard`, `my_rank`, `my_boost` fields.

## Captain Streak Bonus
- Captains with **5+ consecutive active days** (at least one COMPLETED ride per IST day, ending today or yesterday) earn a **₹200 bonus**.
- Auto-granted when the weekly digest runs; idempotent per ISO week via `users.last_streak_week`.
- Captain digest shows either "🔥 STREAK BONUS UNLOCKED — X days straight, ₹200 credited" or a progress card "X day(s) — Y more for ₹200 bonus!".
- Admin digest lists all currently-streaking captains.
