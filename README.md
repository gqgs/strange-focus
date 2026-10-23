# strange-focus

A chaos-inspired productivity tool combining attractors, project visualization, stochastic task selection, and Pomodoro focus sessions.

Every task is a URL. Its domain becomes an **attractor**: a little world of related work, represented by a static Lorenz butterfly. Choose a world, let chance choose a task, and give it your attention.

## Run locally

No build or dependency installation is needed to use the app. With Python 3 installed, run:

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Open **http://127.0.0.1:5173** in a modern browser. `npm run dev` starts the same server. Serve the files over HTTP rather than opening `index.html` directly, because the app uses JavaScript modules.

## How it works

1. **Add a link.** Paste an HTTP(S) URL; omitted schemes default to HTTPS. Paths, query strings, and fragments remain part of the task. Duplicate links are detected.
2. **Choose an attractor.** Hostnames determine grouping: `docs.google.com` and `drive.google.com` are separate; `www.example.com` and `example.com` share an attractor. Ports do not affect grouping. The actual task link retains its hostname and port so it opens the address you entered.
3. **Pick a task.** Every pending task in the chosen attractor has an equal chance. Independent draws can repeat the same task. Open the link in a new tab when ready.
4. **Focus.** Start a timer, pause/resume it, or end the session. Focus and break durations default to 25 and 5 minutes and can be changed in Timer settings. New settings take effect on the next session.
5. **Mark it done.** Completed tasks leave the draw pool and remain in the Done list, where they can be reopened. Tasks can also be deleted.

While a session is running or paused, its task is held in focus. You can browse other attractors, but cannot draw another task or delete the active task until the session ends. Completing that task ends its session. Timer expiry does **not** complete tasks or start another timer. Breaks start explicitly.

The responsive layout uses a domain sidebar on desktop and a horizontal domain picker on mobile. Domain labels, counts, and selected states supplement the colors. Attractor curves stay still, and keyboard navigation, focus indicators, screen-reader announcements, and reduced-motion preferences are supported.

## Browser storage

Tasks, domain colors, selection, duration settings, and timer state save automatically in `localStorage` under `strange-focus:v1`. Running timers use an absolute deadline, so refreshes and background tabs do not reset them; paused timers retain their remaining time. An expired session restores as finished without starting another session.

Data belongs to this browser profile and origin (including the port). It is not uploaded or synchronized. Clearing the site's browser data removes it. Use one app tab at a time; concurrent tabs do not merge edits.

If storage is blocked or full, the app displays a warning and remains usable in memory. Invalid saved data is preserved until you explicitly use **Reset saved data** and confirm. That reset also clears the temporary session.

## Tests

Node.js 22 or newer is recommended for development. Unit tests have no third-party dependencies:

```sh
npm test
```

For browser tests, install the development dependencies:

```sh
npm ci
npm run test:e2e
```

The Playwright suite starts its own local server and runs desktop (1440px) and touch/mobile (390px, plus a 320px overflow check) Chromium scenarios. It defaults to `/usr/bin/chromium`; set `CHROMIUM_PATH` to your installed Chromium executable on other systems. It exercises URL grouping, completion/reopening, timers and reload recovery, storage failures, keyboard controls, and long URLs. Axe checks the empty, populated, and settings states for accessibility issues, including text contrast. Screenshots are written under the ignored `test-results/` directory.

## Structure

- `index.html` and `src/styles.css`: responsive, accessible interface.
- `src/app.js`: DOM rendering and interaction handlers.
- `src/model.js`: URL rules, task lifecycle, random selection, and timer transitions.
- `src/storage.js`: versioned persistence, validation, and recovery.
- `src/attractor.js`: deterministic Lorenz integration and SVG rendering.
- `tests/`: unit tests and end-to-end browser scenarios.

The MVP is plain HTML, CSS, and JavaScript, with no runtime dependencies or backend. Accounts, synchronization, metadata fetching, weighted selection, notifications, and long-break cycles are outside this version.
