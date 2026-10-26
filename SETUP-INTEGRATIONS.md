# Connecting Google Search Console & Analytics 4

There are two ways to bring real data into the dashboard. You can use the **CSV
import** today with no setup, and configure the **live API** later.

> **Note:** Dashboard *login* (who can open the app) is separate from the *data*
> OAuth below (which fetches GSC/GA4 metrics). See **Dashboard sign-in** next.

---

## Dashboard sign-in (Google / Auth.js)

The dashboard requires signing in with Google. Access is restricted to approved
accounts; Google proves identity, the database decides the role.

### 1. Google Cloud (reuses your existing OAuth client)
Add this **Authorised redirect URI** to the same OAuth client used for data sync:
```
http://localhost:3000/api/auth/callback/google
```
(Use your real origin in production.) No new scopes are needed — login uses the
default `openid email profile`. While the OAuth consent screen is in **Testing**,
add each allowed Google account as a **Test user**.

### 2. Environment
In `.env`:
```env
AUTH_SECRET="<random string>"   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
BOOTSTRAP_ADMIN_EMAIL="tech@atlasuniversity.edu.in"   # optional; this is the default
```
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are reused. Restart the dev server.

### 3. Establish the initial admin
- **Normal bootstrap:** with no admin in the database yet, sign in at `/login` with
  Google as **tech@atlasuniversity.edu.in** → that verified account is created as the
  first admin automatically. It happens only once (never again while an admin exists),
  and only for that designated, verified email. Other unknown accounts are denied.
- **Recovery / override (authorized, local only):** if an admin already exists or you
  are locked out, run on the server:
  ```bash
  npm run grant-admin                       # grants tech@atlasuniversity.edu.in
  npm run grant-admin someone@example.com   # or a specific email
  ```
  This requires shell access (it is not a web endpoint) and records an audit entry.

### 4. Add more users
Signed in as an admin, go to **/admin/users → New user**: enter name, email and role.
That approves the email — the person then signs in with Google. Deactivating a user
blocks them on their next request; the last active admin cannot be demoted or deactivated.

### 5. Verify it worked
- `/login` shows **Continue with Google**; after consent you land on the dashboard.
- An approved admin sees **Administration → User Management**; a standard user does not,
  and `/admin/users` denies them.
- An un-approved Google account is bounced back to `/login` with an access-denied notice.

---

---

## Option A — CSV import (no configuration)

### Search Console
1. Open Search Console → **Performance → Search results**.
2. Set the date range and (optionally) the **Pages** tab.
3. Click **Export → CSV** (or Download).
4. In the dashboard: **Settings → Data & Imports**, choose **Search Console**, pick the
   file, and (if your export has no `date` column) set the period, then **Import CSV**.

**Recognised columns** (case-insensitive): `date`, `page`/`url`/`landing page`,
`clicks`, `impressions`, `ctr`, `position`. A `date` column produces daily rows;
otherwise rows are stored for the period you choose. See
`public/samples/search-console-sample.csv`.

### Analytics 4
1. In GA4, build an exploration or report with dimension **Date** (and optionally
   **Page path**) and metrics such as Views, Active users, Sessions, Engaged sessions,
   Engagement rate, Average engagement time.
2. **Export** to CSV.
3. In the dashboard: **Settings → Data & Imports**, choose **Analytics 4**, import.

**Recognised columns**: `date`, `page`/`page path`, `views`/`screen page views`,
`active users`/`users`, `sessions`, `engaged sessions`, `engagement rate`,
`average engagement time`. See `public/samples/ga4-sample.csv`.

> Page-level rows are matched to a tracked page when the URL/path matches one in your
> website pages, which powers the per-page figures in the Page Inspector.

---

## Option B — Live Google API (OAuth)

This enables the **Connect Google** and **Sync** buttons in Settings → Integrations.

### 1. Google Cloud project & APIs
1. Go to <https://console.cloud.google.com/> and create (or pick) a project.
2. **APIs & Services → Library** → enable:
   - **Google Search Console API**
   - **Google Analytics Data API**
   - **PageSpeed Insights API** (optional, for the inspector)

### 2. OAuth consent screen
1. **APIs & Services → OAuth consent screen** → choose **External** (or Internal for a
   Workspace org) and fill in the app name and support email.
2. Add the scopes:
   - `https://www.googleapis.com/auth/webmasters.readonly`
   - `https://www.googleapis.com/auth/analytics.readonly`
3. Add your Google account as a **Test user** (while the app is in Testing).

### 3. OAuth client credentials
1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorised redirect URIs** — add exactly:
   ```
   http://localhost:3000/api/integrations/google/callback
   ```
   (Use your real origin in production, e.g. `https://dashboard.example.com/api/integrations/google/callback`.)
4. Copy the **Client ID** and **Client secret**.

### 4. Environment variables
Edit `.env` (copy from `.env.example`):
```env
GOOGLE_CLIENT_ID="<your client id>"
GOOGLE_CLIENT_SECRET="<your client secret>"
GOOGLE_OAUTH_REDIRECT_URI="http://localhost:3000/api/integrations/google/callback"
PAGESPEED_API_KEY=""     # optional
```
Restart the dev server after changing `.env`.

### 5. Connect & choose properties
1. **Settings → Integrations → Connect Google**, approve the consent screen.
2. **Settings → Website Property**, set:
   - **Search Console property** — a domain property `sc-domain:atlasuniversity.edu.in`
     or a URL-prefix property `https://atlasuniversity.edu.in/`. Your Google account
     must have access to it in Search Console.
   - **GA4 property id** — the numeric id from GA4 **Admin → Property Settings**. Your
     account needs at least Viewer access.
3. Back on **Integrations**, click **Sync 28d** for each. Synced rows are stored with
   `isDemo = false` and appear across the dashboard.

---

## Automatic daily sync

The manual **Sync 28d** button always works. To keep real data fresh without
clicking, an OS scheduler calls a protected endpoint once a day.

### How it works
- **Endpoint:** `POST /api/cron/sync` — runs Search Console **and** GA4 independently
  (one provider failing does not block the other), refreshing a trailing window of
  daily rows. It is protected by a bearer token (`CRON_SECRET`) and returns a JSON
  summary. It only syncs a provider that is **connected** and has a **property id**.
- **Non-destructive:** each run fetches first, then replaces only the real rows for
  that exact provider + property + date window inside a transaction. Demo data and
  real data outside the window are never touched. An empty response keeps existing data.
- **Search Console delay:** GSC finalises data ~2–3 days late. Because each run
  re-pulls a trailing window (default 30 days, `SYNC_WINDOW_DAYS`), provisional recent
  days self-correct automatically. The most recent 1–2 days may be missing until Google
  settles them — this is expected, not an error.
- **Next sync time** shown in Settings is an *expectation* based on a daily cadence and
  only appears after the scheduler has actually run once. It is not guaranteed — the
  real trigger is your OS scheduler.

### 1. Set the secret
Add to `.env` (never committed — `.env*` is git-ignored):
```env
CRON_SECRET="<a long random string>"
APP_URL="http://localhost:3000"
SYNC_WINDOW_DAYS="30"
```
Generate a secret:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Restart the dev server after editing `.env`.

### 2. Test the trigger manually
With the Next.js server running (`npm run dev`), in a second terminal:
```powershell
npm run sync
```
You should see one line per provider (`ok` / `skipped` / `FAILED`). The secret is read
from `.env` and is never printed.

### 3. Schedule it on Windows (Task Scheduler)
The local computer **and** the Next.js server must be running at the scheduled time for
the job to succeed (this is a local, self-hosted app — nothing runs while the machine is
off or the server is stopped).

1. Open **Task Scheduler** → **Create Task…** (not "Basic Task").
2. **General** tab: name it `Atlas Web Insight – Daily Google Sync`. Select
   **Run whether user is logged on or not** and **Run with highest privileges** (optional).
3. **Triggers** tab → **New…** → **Daily**, set a time a few hours after midnight
   (e.g. **05:00**), recur every **1 day** → OK.
4. **Actions** tab → **New…** → Action: **Start a program**, then:
   - **Program/script:**
     ```
     C:\Program Files\nodejs\node.exe
     ```
     (adjust if Node is installed elsewhere — check with `where node`)
   - **Add arguments:**
     ```
     scripts\daily-sync.mjs
     ```
   - **Start in (working directory):**
     ```
     C:\xampp\htdocs\report-gen-tool
     ```
     This is required so the script finds `.env`.
5. **Conditions** tab: tick **Wake the computer to run this task** if you want it to run
   while the PC sleeps; untick **Start the task only if the computer is on AC power** on a
   desktop. On a laptop, ensure it can run on battery if needed.
6. **Settings** tab: tick **Run task as soon as possible after a scheduled start is
   missed** so a sync still happens if the PC was off at 05:00.
7. Save. Right-click the task → **Run** to test; check **History** and the dashboard's
   **Settings → Integrations** (last successful sync updates).

> Environment variables: you don't need to set any in Task Scheduler — the script reads
> `CRON_SECRET` / `APP_URL` from the project's `.env`. If you prefer, you can instead set
> them as system environment variables and remove them from `.env`.

### macOS / Linux (cron)
```cron
# every day at 05:00, from the project directory
0 5 * * * cd /path/to/report-gen-tool && /usr/bin/node scripts/daily-sync.mjs >> sync.log 2>&1
```

### After deployment (self-hosted Node host)
Point the same OS scheduler (or the host's cron) at the deployed `APP_URL`, e.g.
`https://dashboard.example.com`. The server process must be running. The in-DB
sync lock assumes a single app instance; if you ever move to a multi-instance /
serverless host, replace it with a distributed lock or an external queue.

---

### Security & reliability notes
- Client secret and OAuth tokens are stored **server-side only** (never sent to the
  browser, logs, or reports). The OAuth `state` is validated via an HttpOnly cookie.
- Token expiry is handled by refreshing with the stored refresh token.
- API errors, revoked access and rate limits (HTTP 429) surface as readable messages
  and set the integration status to **Error** with the reason. Transient errors (429,
  5xx) get a small bounded retry; permanent auth/config errors are not retried.
- `CRON_SECRET` and OAuth tokens live server-side only (in `.env` and the database), are
  never sent to the browser, and are excluded from Git.
- Overlapping scheduled/manual runs are prevented by an atomic database lock, so a sync
  can't collide with itself; a crashed run's lock is reclaimed after ~10 minutes.
- Requesting only read-only scopes keeps the footprint minimal.

---

## Database (MySQL)
The app uses MySQL. To set it up:
1. Create a database (e.g. `atlas_dashboard`) and a user with access to it.
2. In `.env`, set `DATABASE_URL="mysql://user:password@host:3306/atlas_dashboard"`.
   URL-encode special characters in the password (e.g. `@` → `%40`).
3. Run `npx prisma migrate deploy` to create the tables, then `npm run db:seed`
   for demo data (optional).

`datasource.provider` is already `mysql` in `prisma/schema.prisma`; the data
model is portable, so no code changes are required to point at a new database.
