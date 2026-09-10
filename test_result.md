#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Complete the "Digest emails via Resend" feature that a previous agent left unfinished
  in the Nafis Ride Alwar (ride-sharing) project. Weekly digest to riders / captains /
  admins every Monday morning IST. Manual admin trigger + APScheduler cron. Use
  Emergent-managed Resend integration (no API key from user).

backend:
  - task: "POST /api/admin/digest/send — manual weekly digest trigger (admin only)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Implemented. Aggregates last-7-days rides for riders (spend, credits),
          captains (earnings, rating) and admins (revenue, top captains). Uses
          Emergent Resend proxy with `_assert_safe_email` gate on every send.
          Locally curl POST returns {ok:true, summary:{...}} — admin address on
          a `.local` domain lands in `failed` because proxy blocks synthetic
          domains (expected). Test with `delivered@resend.dev`.

  - task: "POST /api/admin/digest/preview — render template without sending"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Curl for kind=admin returns subject + html + data payload."

  - task: "POST /api/admin/digest/test-send — send test email to delivered@resend.dev"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          Verified via curl with `delivered@resend.dev` — returns
          {ok:true, email_id:"..."} and Resend proxy responds 202 Accepted.

  - task: "GET /api/admin/digest/runs — recent digest send history"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Reads from db.digest_runs, sorted by run_at desc, limit 20."

  - task: "APScheduler cron — every Monday 08:00 IST"
    implemented: true
    working: "NA"
    file: "backend/digest.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          AsyncIOScheduler with CronTrigger(day_of_week='mon', hour=8, minute=0,
          timezone='Asia/Kolkata'). Started on FastAPI startup event, stopped
          on shutdown. Log line "Digest scheduler started (Mondays 08:00 IST)"
          confirms boot. No cron fires immediately, so just verify job is
          registered — can be inspected via scheduler.get_jobs() if needed.

frontend:
  - task: "Admin → Overview → Weekly Digest Emails card"
    implemented: true
    working: "NA"
    file: "frontend/app/admin.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Added new card under Fare Configuration:
          - testID="digest-card" — the card container
          - testID="send-digest-now-button" — triggers POST /api/admin/digest/send
          - testID="digest-last-summary" — appears after a successful send
          - testID="digest-test-email-input" — email input, default delivered@resend.dev
          - testID="send-digest-test-button" — POSTs /api/admin/digest/test-send
          - testID="digest-runs-list" + testID="digest-run-{i}" — recent runs history

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "Referral leaderboard grant — top 3 referrers get ₹150/₹100/₹50 (idempotent per ISO week)"
    - "compute_referral_leaderboard — top 3 riders by count of new referred users last 7 days"
    - "Rider digest data — weekly_referrals, my_referral_rank, my_referral_boost, referral_leaderboard fields"
    - "Admin digest data — referral_leaderboard field present"
    - "Idempotency — second send does not re-grant referral credits"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Round 3 additions on top of digest feature — Rider Referral Leaderboard.

      Reward: top 3 rider inviters each week get ₹150 / ₹100 / ₹50
      (`REFERRAL_LEADERBOARD_CREDITS`). Idempotent per ISO week via
      `users.last_referral_leaderboard_week`. Summary now includes
      `referral_leaderboard_granted` count.

      Referral counting: for each rider we count how many `users` documents
      exist with `referred_by == that_rider.user_id` AND
      `created_at` in the last 7 days. Only riders are eligible
      (leaderboard computation filters `role == "rider"`).

      New fields:
        - Rider digest data: `weekly_referrals`, `my_referral_rank`,
          `my_referral_boost`, `referral_leaderboard`.
        - Admin digest data: `referral_leaderboard`.

      Manual verification already done (curl):
        - Seeded referrer1 + 3 invitees applying its code.
        - First /send granted `referral_leaderboard_granted == 1`
          and referrer1.credits went from 0 → 150.
        - Second /send granted 0 (idempotent).
        - Rider preview for referrer1 shows my_referral_rank=1,
          my_referral_boost=150, weekly_referrals=3, HTML contains
          "top inviters" section and "3 friends" copy.

      Please test BACKEND ONLY. Focus:
        - Seed 3 rider referrers with different invite counts (rider1 = 3
          invitees, rider2 = 2 invitees, rider3 = 1 invitee). Each invitee
          must use `POST /api/referral/apply` so `referred_by` gets set.
        - Call POST /api/admin/digest/send. Assert
          summary.referral_leaderboard_granted == 3. Verify:
            rider1.credits += 150, has last_referral_leaderboard_rank=1
            rider2.credits += 100, rank=2
            rider3.credits += 50,  rank=3
          Each has last_referral_leaderboard_week set to current IST week.
        - Immediate re-call: referral_leaderboard_granted == 0, credits
          unchanged.
        - Rider with 0 referrals doesn't appear on the board.
        - A CAPTAIN who somehow refers users is NOT on the rider referral
          board (leaderboard filters role="rider").
        - Preview: `POST /admin/digest/preview` for rider returns
          `data.weekly_referrals`, `data.my_referral_rank`,
          `data.my_referral_boost`, `data.referral_leaderboard`.
          For admin returns `data.referral_leaderboard`.
        - Regression: existing send summary keys (7 total previous +
          referral_leaderboard_granted = 8 keys); leaderboard_granted /
          streak_granted still work; test-send with delivered@resend.dev
          still 200; digest_runs still populated.

      IMPORTANT: Resend proxy blocks synthetic domains (422 → summary.failed).
      That is expected. Avoid rate-limits — do NOT rapid-fire /test-send.
      Idempotency uses IST week; if tests need to re-simulate a fresh week,
      reset `last_referral_leaderboard_week` on the user doc before re-calling.


      1. **Digest Previews** — frontend Modal + backend `preview_digest`
         now auto-picks an eligible rider/captain when email is omitted.
         `POST /admin/digest/preview` returns extra `target_email` field.

      2. **Rider Leaderboard** — new fields on Rider digest data
         (`leaderboard`, `my_rank`, `my_boost`) and on Admin digest data
         (`leaderboard`). Weekly `/send` awards ₹100/₹75/₹50 to top 3
         riders by spend (COMPLETED rides, last 7 days) — idempotent per
         ISO week via `users.last_leaderboard_week`. Summary now
         includes `leaderboard_granted` count.

      3. **Captain Streak** — new fields on Captain digest data
         (`streak_days`, `streak_eligible`, `streak_bonus`) and on Admin
         digest data (`streaking_captains`). Weekly `/send` awards
         ₹200 to captains with 5+ consecutive active days —
         idempotent per ISO week via `users.last_streak_week`.
         Summary now includes `streak_granted` count.

      Please test BACKEND ONLY:
        - Preview endpoint auto-pick behaviour: `POST /admin/digest/preview` body
          `{"kind":"rider"}` (no email) should return 200 with `target_email`.
          Same for `{"kind":"captain"}`. `{"kind":"admin"}` still works.
        - Preview data contains the new fields (leaderboard/my_rank/streak_days etc.).
        - Leaderboard grant: seed 3 riders with different completed-ride spends,
          call `/admin/digest/send`, verify `summary.leaderboard_granted == 3`,
          verify each rider's `credits` increased by the correct amount
          (rank 1 → +100, rank 2 → +75, rank 3 → +50), and their user doc
          has `last_leaderboard_week` set.
        - Idempotency: call `/admin/digest/send` again immediately, verify
          `summary.leaderboard_granted == 0` and credits are UNCHANGED.
        - Streak grant: seed a captain with 5 COMPLETED rides on 5 distinct
          consecutive days (IST), call `/admin/digest/send`, verify
          `summary.streak_granted >= 1` and captain credits increased by 200.
          Second immediate call should NOT re-grant.
        - Regression: `/admin/digest/test-send`, `/admin/digest/runs`,
          existing endpoints still respond OK.

      Test credentials in `/app/memory/test_credentials.md`. Use dev-login for
      quick user creation. IST timezone is Asia/Kolkata; when seeding streak
      data, use `completed_at` datetimes that map to distinct IST dates.

