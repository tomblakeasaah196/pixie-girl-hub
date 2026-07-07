# Kaizen (frontend)

JBS Praxis maintenance & operations console for Pixie Girl Hub, served at
`kaizen.pixiegirlglobal.com`. React 18 + Vite 5 + TanStack Query v5 + Zustand +
React Router 6, Tailwind. Distinct "ops" theme (amber + signal-red on near-black)
so it's unmistakably not the Maroon Noir client admin.

## Dev

```bash
npm install
npm run dev        # http://localhost:5174 (proxies /api and /media → :7000)
```

The backend must be running on `:7000` (or set `VITE_API_PROXY_TARGET`). Because
dev is same-origin through the Vite proxy, the httpOnly refresh cookie works
without CORS.

## Build

```bash
npm run build      # tsc -b && vite build → dist/
```

## Auth model

- Access token (30 min) kept **in memory only** (Zustand), never localStorage.
- Refresh token in an httpOnly/Secure/SameSite=Strict cookie the JS never sees;
  the app silently refreshes on load and transparently on any 401.
- Operators are a separate identity from the client's platform users.

## Phase 0 screens

Login · Accept-invite · Forced change-password · Overview (live system status) ·
Operators (invite / list / disable). Errors, Health, Performance, Backups,
Alerts and Settings are present as "coming soon" stubs and light up in later
phases per the implementation guide.
