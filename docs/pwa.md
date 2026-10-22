# PWA behavior

Serwist precaches generated application assets and the `/~offline` route. Navigations are never runtime-cached because signed-in HTML can contain account details; offline navigation falls back to `/~offline`. Versioned scripts, styles, fonts, and workers use cache-first; public icons use stale-while-revalidate. `/api`, `/auth`, Supabase REST/RPC/Auth, and Realtime responses are excluded. Authenticated data stays in user-scoped IndexedDB rather than Cache Storage. The worker asks before activating a waiting update, registers a best-effort background sync wakeup, and the app requests persistent storage after workspace load.

The manifest declares standalone display, app colors, icons, and Today/Later shortcuts. Icons are original NestList vectors. Installability and offline navigation still need browser validation on desktop Safari/Chrome and Android Chrome. iOS notification behavior varies by version and installation mode.

While open, local data remains available offline and reminder actions use the local repository. Server Web Push uses the delivery ledger and VAPID Edge worker. The daily summary groups all open tasks scheduled for the user’s local date, sends one notification at the selected local time, and updates the app badge where supported. It does not use email. On iPhone and iPad the user must add the app to the Home Screen before enabling Web Push. A PWA cannot promise delivery when fully closed and offline.

Manual release checks: install in desktop Chrome/Safari and Android Chrome, add to iOS Home Screen, reload each app offline, confirm a waiting-worker update prompt, inspect Cache Storage for authenticated responses, and run Lighthouse PWA/accessibility audits over HTTPS.
