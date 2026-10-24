# strange-focus

A chaos-inspired productivity tool combining attractors, project visualization, stochastic task selection, and Pomodoro focus sessions.

Every task is a URL. Its domain becomes an **attractor**: a little world of related work, represented by a Lorenz butterfly with orbiting task dots. Choose a world, let chance choose a task, and give it your attention.

**Use the app:** https://gqgs.github.io/strange-focus/

## Deployment

GitHub Pages publishes automatically on pushes to `main` through `.github/workflows/pages.yml`. The workflow runs unit tests and uploads only `index.html`, `favicon.svg`, and `src/`. No backend or build step is required. It can also be run manually from GitHub Actions. The repository's Pages source is **GitHub Actions**.

Browser data is specific to the site's origin: tasks saved on localhost do not automatically appear on the hosted app.

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

The responsive layout uses a domain sidebar on desktop and a horizontal domain picker on mobile. Domain labels, counts, and selected states supplement the colors. Each pending task adds an orbiting dot; the selected task has a larger marker. Up to 60 dots are drawn per attractor to keep large backlogs responsive, while counts always show the full backlog. Curves stay centered when picking tasks. Reduced-motion preferences freeze the dots; background tabs pause animation.

Use the **⋯** inside an attractor card to open its settings. **Delete…** opens a separate confirmation showing the task count and warning when deletion will end its current focus session. **Keep attractor**, Escape, or clicking outside cancels deletion. Other attractors and sessions are preserved.

Attractor colors are sampled from the task site's `/favicon.ico` when it permits cross-origin reads. Transparent and white pixels are ignored. Missing icons, CORS restrictions, or offline requests keep the existing palette color. Each attempt is remembered locally. In attractor settings, choose **Custom color** with the picker or enter a six-digit hex code, then select **Save custom color**. The exact value is stored separately from the automatic color; **Use automatic color** removes the override. Display shades adapt for contrast in each theme. The app contacts only the task site's origin, without cookies, referrer, task path, or query string; no favicon proxy or backend is involved. Existing saved tasks remain compatible.

The app remains entirely static: `index.html`, `favicon.svg`, and `src/` can be served from a GitHub Pages project subdirectory because asset paths are relative. Python is only the local file server, not a deployment dependency.

The **Dark / Light** toggle in the workspace header changes the theme and remembers the choice in browser storage. Before a choice is saved, the app follows the operating system’s theme. The saved theme is applied before the page paints, and switching themes preserves tasks, custom colors, and active timers.

## Browser storage

Tasks, domain colors and custom overrides, theme choice, selection, duration settings, and timer state save automatically in `localStorage` under `strange-focus:v1`. Running timers use an absolute deadline, so refreshes and background tabs do not reset them; paused timers retain their remaining time. An expired session restores as finished without starting another session.

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
- `src/attractor.js`: Lorenz integration, SVG rendering, and task motion.
- `src/colors.js`: best-effort favicon sampling and readable accent colors.
- `tests/`: unit tests and end-to-end browser scenarios.

The MVP is plain HTML, CSS, and JavaScript, with no runtime dependencies or backend. Accounts, synchronization, page-title fetching, weighted selection, notifications, and long-break cycles are outside this version.

## Chromium / Brave extension

Build the unpacked extension with `npm run build:extension` (Node.js only; no dependency installation needed for packaging). In `chrome://extensions` or `brave://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/extension`. Click the extension's toolbar action to open the existing workspace. Reload the extension after rebuilding it. This is an unpacked extension, not a Chrome Web Store release.

Open **Tab attraction settings** beneath the task collection. Monitoring starts **paused, with no domains**. Enter exact hostnames such as `news.ycombinator.com`, `arxiv.org`, `en.wikipedia.org`, `www.youtube.com`, or `chatgpt.com`; subdomains must be listed individually. Save to grant optional access to those sites, choose an inactivity threshold (default 60 minutes), and uncheck **Pause automatic attraction** when ready. Checks use Manifest V3 alarms every minute, so capture may occur up to a minute after the threshold, or later while the browser is asleep.

The extension records observed tab URLs, titles, favicons, and activity timestamps in `chrome.storage.local`. After inactivity, it persists the task **before** navigating away. Only after a successful native navigation to its own saved-task landing page can it remove the tab. Chromium's unload confirmation is never automatically accepted. Active tabs in every window, pinned or audible tabs, loading tabs, edited form fields, contenteditable editors, and pages containing frames are kept open. Missing site permissions or an unsuccessful safety check also keep the tab open. This deliberately conservative policy means some sites, including editor-heavy ChatGPT pages, may need manual task creation. Extensions cannot guarantee detection of arbitrary application-internal unsaved state; native unload warnings and visible form checks are the protection available here.

The default safety check recognizes only Wikipedia Vector’s known autosaved Appearance controls (text size, content width, and theme). Those controls are initialized by page scripts and do not represent unsaved article edits. Other controls, article-source edits, VisualEditor/contenteditable regions, and frames are still checked. This is not a whole-site exemption.

**Bypass page-safety checks for all monitored sites** is an explicit global opt-out, **off by default**, including for existing extension installs. When enabled, the extension skips form/editor/frame inspection and closes eligible tabs directly instead of navigating through the native unload-confirmation path. **Unsaved progress can be lost, and unload warnings are bypassed.** Domain opt-in, granted site access, inactivity, pause, active tabs in every window, pinned/audible/loading tabs, URL rechecks, and persisting tasks before closing still apply. Disabling the option restores the normal safety checks. The option does not enable monitoring or add any domains.

**Current tab status**, in Tab attraction settings, explains why an observed tab is waiting or staying open: inactivity, active/pinned/audible state, edited forms, editors, frames, unavailable site access, and pending capture. Status updates after scans and includes up to 50 tabs. Diagnostics store reason codes, not form contents.

**Recently attracted** offers restore buttons. Opening a pending task removes it from the random pool while an equivalent URL is open. Closing it or leaving that URL queues it again; subsequent inactivity can attract it again. Only **Mark done** completes a task. Reopening counts and event history persist across cycles. Observed tabs that disappear during a crash or navigation become saved tasks; restored tab IDs are reconciled by URL. If a storage write fails, automatic closing stops and the original tab stays available.

Random selection uses `weight = 1 + alpha × log2(1 + reopeningCount)`, divided by the sum of eligible task weights. The default priority strength is 1; choose 0 for uniform selection. Open tasks are excluded. Known tracking parameters (`utm_*`, `fbclid`, `gclid`) are ignored for deduplication, while the original navigable URL, content parameters, and fragments are retained.

To migrate from GitHub Pages, click **Export data** in the web app, then choose that JSON file under **Import existing tasks** in the extension. Imports add missing tasks without replacing existing tasks or custom colors. Theme and timer durations are copied only into an empty collection; a running timer is not imported. The extension uses a version-2 storage envelope containing the compatible workspace schema. Export also provides an extension backup; importing one restores its tasks, not monitoring permissions or open browser tabs. There is no backend or cloud synchronization, and the web app continues to work independently.

The sidebar's **Hide attractors / Show attractors** button remembers its state on desktop and mobile. The timer's readiness caption uses smaller type.

Run `npm run test:extension` after installing development dependencies to test an unpacked extension in Chromium. The tests cover real capture/restoration, form and unload protection, opt-in configuration, alarms, and service-worker restarts. Unit tests cover failed writes, URL deduplication, recovery, concurrent edits, imports, and deterministic statistical checks of weighted sampling.

