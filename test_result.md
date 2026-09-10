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
    - "POST /api/admin/digest/send — manual weekly digest trigger (admin only)"
    - "POST /api/admin/digest/preview — render template without sending"
    - "POST /api/admin/digest/test-send — send test email to delivered@resend.dev"
    - "GET /api/admin/digest/runs — recent digest send history"
    - "APScheduler cron — every Monday 08:00 IST"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      New "Digest emails via Resend" feature implemented on top of the existing
      Nafis Ride Alwar app. Backend digest logic lives in `backend/digest.py` and
      is wired into `server.py`. Admin dashboard has UI to send weekly digests
      and a small test-send form.

      Please test backend endpoints ONLY:
        - `POST /api/admin/digest/send`  (admin auth required)
        - `POST /api/admin/digest/preview`  body: {"kind":"admin"} / rider / captain
        - `POST /api/admin/digest/test-send`  body: {"to":"delivered@resend.dev"}
        - `GET  /api/admin/digest/runs`
        - Auth non-admin → 403 on all four
        - Scheduler running on startup (grep backend log for
          `Digest scheduler started (Mondays 08:00 IST)`).

      Test credentials in `/app/memory/test_credentials.md`. Use `delivered@resend.dev`
      for any real send — any other synthetic recipient returns HTTP 422
      `undeliverable_recipient` from the Resend proxy which counts as `failed`
      in the summary (this is expected, NOT a bug).
