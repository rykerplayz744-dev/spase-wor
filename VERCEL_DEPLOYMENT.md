# How to Run & Deploy Vector Spacewar on Vercel

This guide explains how to deploy **Vector Spacewar** using the [Vercel website (vercel.com)](https://vercel.com), including how the Vite frontend (`dist`) and the real-time WebSocket game server (`server.ts`) work when hosted on Vercel.

---

## 1. Understanding How This Project Works with Vercel

**Vector Spacewar** has two parts:
1. **The React + Canvas Frontend (`src/` -> builds to `dist/`)**:
   - Handles 60fps HTML5 Canvas rendering, Newtonian infinite-momentum physics, direct 360° joystick/mouse aiming, planetary gravity slingshots, Web Audio synth effects, and the Cheat Menu (`K`).
   - This part is a standard Vite Single-Page Application (SPA) and deploys natively to **Vercel** in under 60 seconds.
2. **The Stateful 60Hz WebSocket Server (`server.ts`)**:
   - Runs an Express HTTP server + `ws` WebSocket server (`/ws`) with an in-memory 60Hz simulation loop (`setInterval` at `1000 / 60` ms) for multiplayer synchronization, server-spawned target ships, and scanning `.ogg` files in `src/components/music/`.
   - **Important Vercel Note**: Because Vercel's backend runtime uses **stateless serverless functions** (which spin down between requests and do not support persistent stateful `ws` WebSocket rooms in memory), deploying to Vercel alone will host the **frontend game client**, while multiplayer/server features require either:
     - **Option A (Quickest — Frontend on Vercel)**: Deploy the repository directly to Vercel. Your ship, 10× star system, planetary orbits, gravity slingshots, warp drive, and local flight physics run directly in the browser, and the client automatically attempts to reconnect to `/ws` in the background.
     - **Option B (Full Multiplayer + Target Fleet Spawner)**: Host the frontend on **Vercel** and run `server.ts` on any persistent Node.js WebSocket host (such as **Render**, **Railway**, or **Fly.io**), or proxy `/ws` and `/api/*` to that backend.

---

## 2. Step-by-Step: Deploying on the Vercel Website (Option A)

### Step 1: Push the Project to GitHub
1. Download or clone this project folder to your computer.
2. Create a new repository on [GitHub](https://github.com/new).
3. Push the files to your GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Vector Spacewar"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```

### Step 2: Import the Repository on Vercel.com
1. Go to [https://vercel.com](https://vercel.com) and sign in (or sign up with your GitHub account).
2. On your Vercel Dashboard, click **"Add New..."** -> **"Project"**.
3. Find your GitHub repository in the **"Import Git Repository"** list and click **"Import"**.

### Step 3: Configure Build & Output Settings on Vercel
On the **"Configure Project"** screen in Vercel, use these exact settings:
- **Framework Preset**: `Vite`
- **Root Directory**: `./` (leave as default)
- **Build and Output Settings**:
  - **Build Command**: `npm run build`
  - **Output Directory**: `dist`
  - **Install Command**: `npm install`

### Step 4: Deploy
1. Click the **"Deploy"** button.
2. Vercel will install the dependencies from `package.json`, run `vite build`, and publish the compiled `dist/` bundle to a live `https://<your-project>.vercel.app` URL.

---

## 3. Making the Music Box `.ogg` Files Available on Static Vercel Builds

When running locally via `server.ts`, Express serves `src/components/music/*.ogg` at `/music-box/<filename>.ogg`.
If you are hosting a static build on Vercel without `server.ts`, you can copy the `.ogg` files into a `public/music-box/` folder before pushing to GitHub so Vercel serves them statically:

```bash
mkdir -p public/music-box
cp src/components/music/*.ogg public/music-box/
```

---

## 4. Full Multiplayer Setup: Vercel Frontend + Persistent WebSocket Server (Option B)

If you want multiplayer rooms, the **100x Target Ship Spawner**, and the **360° Nova Salvo** server synchronization to work online with your Vercel URL:

1. **Deploy `server.ts` to a Persistent Node Host** (e.g., [Railway.app](https://railway.app) or [Render.com](https://render.com)):
   - Connect the same GitHub repo to Railway or Render as a **Web Service**.
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npx tsx server.ts`
   - Copy the service's public URL (for example, `https://vector-spacewar-server.up.railway.app`).

2. **Point Your Vercel App to the WebSocket Server**:
   - You can either play directly on the persistent host URL (since `server.ts` also serves the built `dist/` frontend in production), **or** add a `vercel.json` file in your repo to rewrite `/api/*` requests to your backend server:
     ```json
     {
       "rewrites": [
         {
           "source": "/api/:path*",
           "destination": "https://your-backend-host.example.com/api/:path*"
         },
         {
           "source": "/music-box/:path*",
           "destination": "https://your-backend-host.example.com/music-box/:path*"
         }
       ]
     }
     ```
   - *(Note: Browser WebSockets (`wss://`) cannot be proxied through Vercel rewrites, so for live WebSocket connections on a separate domain, connect `new WebSocket('wss://your-backend-host.example.com/ws')`.)*
