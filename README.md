# Now / Next / Later — Cloud

Team version with **Supabase auth** on **port 5174**.  
Personal v10 stays at `task-prioritizer-simplified` → http://localhost:5173

## Run locally

```bash
cd /Users/nelsonwedin/task-prioritizer-cloud
npm install
npm run dev
```

Open **http://localhost:5174**

Without Supabase configured, the app runs in local dev mode (profile picture works; no login wall).

---

## Supabase setup (5–10 min)

### 1. Create project
1. Go to [supabase.com](https://supabase.com) → New project
2. Note **Project URL** and **anon public** key (Settings → API)

### 2. Configure env
```bash
cp .env.example .env.local
```
Edit `.env.local`:
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```
Restart `npm run dev`.

### 3. Run database schema
In Supabase → **SQL** → New query → paste contents of `supabase/schema.sql` → Run.

### 4. Auth settings (recommended for colleagues)
Authentication → Providers → Email:
- Enable email sign-in
- For internal MVP: disable “Confirm email” so teammates can sign up instantly

### 5. Invite colleagues
Share the deployed URL (later) or `http://localhost:5174` on VPN. Each person signs up with email + password.

---

## What’s wired today (MVP)

| Feature | Status |
|---------|--------|
| Parhelia logo in header | Done |
| User profile picture (top-left) | Done — click avatar to upload |
| Supabase sign up / sign in | Done when `.env.local` is set |
| Per-user localStorage boards | Done — keyed by user id |
| Cloud DB sync (`app_states` table) | Schema ready — sync coming next |

---

## Deploy on Vercel

1. **Import** [github.com/Nelsoar/Prioritizer](https://github.com/Nelsoar/Prioritizer) (already linked)
2. **Settings → Environment Variables** — add both for Production, Preview, and Development:
   - `VITE_SUPABASE_URL` = `https://corezdvuzmsxnjshrsgt.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = your `sb_publishable_...` key from Supabase
3. **Deploy** (or Redeploy after adding env vars)
4. **Supabase → Authentication → URL configuration**
   - **Site URL** → your Vercel URL (e.g. `https://prioritizer-xxx.vercel.app`)
   - **Redirect URLs** → add the same URL + `http://localhost:5174`

Share the Vercel URL with colleagues. They sign up and use the app in the browser.

---

1. Wire autosave to Supabase `app_states` (replace localStorage for logged-in users)
2. Deploy frontend to Vercel/Netlify/S3 + custom domain
3. Optional: shared team board table
