# VoIP Server Website — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a static 4-page marketing/documentation website for the VoIP Server project, deployable to GitHub Pages.

**Architecture:** Plain HTML/CSS/JS with no build step. Shared stylesheet (`css/style.css`) and script (`js/main.js`) across all pages. Dark theme with glassmorphism cards, animated gradient orbs, and scroll-reveal animations via Intersection Observer.

**Tech Stack:** HTML5, CSS3 (custom properties, backdrop-filter, grid, flexbox), vanilla JavaScript

---

### Task 1: Project Structure & Favicon

**Files:**

- Create: `voip-website/css/style.css` (empty placeholder)
- Create: `voip-website/js/main.js` (empty placeholder)
- Create: `voip-website/assets/favicon.svg`

**Step 1: Create directory structure**

Run:

```bash
mkdir -p /home/coder/projects/voip-website/css /home/coder/projects/voip-website/js /home/coder/projects/voip-website/assets
```

**Step 2: Create favicon SVG**

Create `assets/favicon.svg` — a purple hexagon with a microphone/headphone icon:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#9b7cfc"/>
      <stop offset="100%" stop-color="#7c5cfc"/>
    </linearGradient>
  </defs>
  <path d="M32 4L58 18v28L32 60 6 46V18z" fill="url(#g)"/>
  <circle cx="32" cy="28" r="8" fill="none" stroke="#fff" stroke-width="2.5"/>
  <path d="M24 28c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="32" y1="36" x2="32" y2="44" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M26 44h12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
</svg>
```

**Step 3: Create empty CSS and JS placeholders**

Create empty `css/style.css` and `js/main.js` files.

**Step 4: Verify structure**

Run:

```bash
find /home/coder/projects/voip-website -type f | sort
```

Expected:

```
voip-website/assets/favicon.svg
voip-website/css/style.css
voip-website/js/main.js
```

**Step 5: Initialize git and commit**

```bash
cd /home/coder/projects/voip-website && git init && git add -A && git commit -m "chore: initialize project structure with favicon"
```

---

### Task 2: Global CSS — Variables, Reset, Background, Typography

**Files:**

- Modify: `voip-website/css/style.css`

**Step 1: Write CSS custom properties and reset**

```css
/* ===== Variables ===== */
:root {
  --bg: #0a0a0f;
  --bg-card: rgba(255, 255, 255, 0.05);
  --border-card: rgba(255, 255, 255, 0.1);
  --accent: #7c5cfc;
  --accent-glow: rgba(124, 92, 252, 0.4);
  --text: #ffffff;
  --text-secondary: #a0a0b0;
  --radius: 16px;
  --nav-height: 64px;
}

/* ===== Reset ===== */
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
  scroll-padding-top: var(--nav-height);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  min-height: 100vh;
  overflow-x: hidden;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

img {
  max-width: 100%;
  display: block;
}
```

**Step 2: Add background orbs**

```css
/* ===== Background Orbs ===== */
.bg-orbs {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.bg-orbs .orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.3;
  animation: float 20s ease-in-out infinite;
}

.bg-orbs .orb:nth-child(1) {
  width: 600px;
  height: 600px;
  background: var(--accent);
  top: -200px;
  left: -100px;
  animation-delay: 0s;
}

.bg-orbs .orb:nth-child(2) {
  width: 400px;
  height: 400px;
  background: #4c3ccc;
  bottom: -100px;
  right: -100px;
  animation-delay: -7s;
}

.bg-orbs .orb:nth-child(3) {
  width: 300px;
  height: 300px;
  background: #3c8cfc;
  top: 50%;
  left: 60%;
  animation-delay: -14s;
}

@keyframes float {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }
  33% {
    transform: translate(30px, -30px) scale(1.05);
  }
  66% {
    transform: translate(-20px, 20px) scale(0.95);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bg-orbs .orb {
    animation: none;
  }
}
```

**Step 3: Add typography and utility classes**

```css
/* ===== Typography ===== */
h1,
h2,
h3,
h4 {
  font-weight: 700;
  line-height: 1.2;
}

h1 {
  font-size: clamp(2rem, 5vw, 3.5rem);
}
h2 {
  font-size: clamp(1.5rem, 3vw, 2.5rem);
}
h3 {
  font-size: clamp(1.1rem, 2vw, 1.4rem);
}

.text-secondary {
  color: var(--text-secondary);
}

.container {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  position: relative;
  z-index: 1;
}

/* ===== Section spacing ===== */
section {
  padding: 80px 0;
}
```

**Step 4: Verify file isn't empty**

Run:

```bash
wc -l /home/coder/projects/voip-website/css/style.css
```

Expected: ~100+ lines

**Step 5: Commit**

```bash
cd /home/coder/projects/voip-website && git add css/style.css && git commit -m "style: add CSS variables, reset, background orbs, typography"
```

---

### Task 3: Global CSS — Navbar, Glassmorphism Cards, Footer, Scroll Reveal

**Files:**

- Modify: `voip-website/css/style.css`

**Step 1: Add navbar styles**

Append to `css/style.css`:

```css
/* ===== Navbar ===== */
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--nav-height);
  background: rgba(10, 10, 15, 0.8);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border-card);
  z-index: 100;
  display: flex;
  align-items: center;
}

.navbar .container {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.navbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text);
}

.navbar-brand img {
  width: 32px;
  height: 32px;
}

.navbar-links {
  display: flex;
  list-style: none;
  gap: 32px;
}

.navbar-links a {
  color: var(--text-secondary);
  font-size: 0.95rem;
  transition: color 0.2s;
  position: relative;
}

.navbar-links a:hover,
.navbar-links a.active {
  color: var(--text);
  text-decoration: none;
}

.navbar-links a.active::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
}

.hamburger {
  display: none;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
}

.hamburger span {
  display: block;
  width: 24px;
  height: 2px;
  background: var(--text);
  margin: 6px 0;
  transition:
    transform 0.3s,
    opacity 0.3s;
}

/* Mobile nav */
@media (max-width: 767px) {
  .hamburger {
    display: block;
  }

  .navbar-links {
    position: fixed;
    top: var(--nav-height);
    left: 0;
    right: 0;
    background: rgba(10, 10, 15, 0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    flex-direction: column;
    padding: 24px;
    gap: 16px;
    border-bottom: 1px solid var(--border-card);
    transform: translateY(-100%);
    opacity: 0;
    pointer-events: none;
    transition:
      transform 0.3s,
      opacity 0.3s;
  }

  .navbar-links.open {
    transform: translateY(0);
    opacity: 1;
    pointer-events: auto;
  }

  .hamburger.open span:nth-child(1) {
    transform: rotate(45deg) translate(5px, 6px);
  }

  .hamburger.open span:nth-child(2) {
    opacity: 0;
  }

  .hamburger.open span:nth-child(3) {
    transform: rotate(-45deg) translate(5px, -6px);
  }
}
```

**Step 2: Add glassmorphism card styles**

```css
/* ===== Glass Card ===== */
.glass-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius);
  padding: 32px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition:
    transform 0.3s,
    box-shadow 0.3s,
    border-color 0.3s;
}

.glass-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 32px var(--accent-glow);
  border-color: rgba(124, 92, 252, 0.3);
}

@media (prefers-reduced-motion: reduce) {
  .glass-card {
    transition: none;
  }
  .glass-card:hover {
    transform: none;
  }
}
```

**Step 3: Add footer styles**

```css
/* ===== Footer ===== */
.footer {
  border-top: 1px solid var(--border-card);
  padding: 32px 0;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.9rem;
  position: relative;
  z-index: 1;
}

.footer a {
  color: var(--text-secondary);
  transition: color 0.2s;
}

.footer a:hover {
  color: var(--accent);
}

.footer-content {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}
```

**Step 4: Add button styles**

```css
/* ===== Buttons ===== */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
  text-decoration: none;
}

.btn:hover {
  text-decoration: none;
  transform: translateY(-2px);
}

.btn-primary {
  background: var(--accent);
  color: #fff;
}

.btn-primary:hover {
  box-shadow: 0 4px 24px var(--accent-glow);
  color: #fff;
}

.btn-secondary {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border-card);
}

.btn-secondary:hover {
  border-color: var(--accent);
  color: var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  .btn:hover {
    transform: none;
  }
}
```

**Step 5: Add scroll reveal**

```css
/* ===== Scroll Reveal ===== */
.reveal {
  opacity: 0;
  transform: translateY(30px);
  transition:
    opacity 0.6s ease-out,
    transform 0.6s ease-out;
}

.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
```

**Step 6: Add main content offset**

```css
/* ===== Main ===== */
main {
  padding-top: var(--nav-height);
}
```

**Step 7: Commit**

```bash
cd /home/coder/projects/voip-website && git add css/style.css && git commit -m "style: add navbar, glass cards, buttons, footer, scroll reveal"
```

---

### Task 4: JavaScript — Hamburger Menu & Scroll Reveal

**Files:**

- Modify: `voip-website/js/main.js`

**Step 1: Write main.js**

```javascript
document.addEventListener('DOMContentLoaded', () => {
  // Hamburger menu toggle
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.navbar-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      navLinks.classList.toggle('open');
    });

    // Close menu when a link is clicked
    navLinks.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
  }

  // Scroll reveal via Intersection Observer
  const reveals = document.querySelectorAll('.reveal');

  if (reveals.length > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' },
    );

    reveals.forEach((el) => observer.observe(el));
  } else {
    // If reduced motion, show everything immediately
    reveals.forEach((el) => el.classList.add('visible'));
  }
});
```

**Step 2: Verify**

Run:

```bash
wc -l /home/coder/projects/voip-website/js/main.js
```

Expected: ~40 lines

**Step 3: Commit**

```bash
cd /home/coder/projects/voip-website && git add js/main.js && git commit -m "feat: add hamburger menu toggle and scroll reveal"
```

---

### Task 5: Home Page (`index.html`)

**Files:**

- Create: `voip-website/index.html`

**Step 1: Write index.html**

Full HTML for the home page with:

- `<head>`: meta tags (charset, viewport, description, OG tags), favicon link, stylesheet link
- Background orbs `<div>`
- Navbar with logo, links (Home active, Features, Docs, Downloads), hamburger
- Hero section: title "VoIP Server", subtitle, two CTA buttons
- Features preview: 4 glass cards linking to features.html
- Final CTA section
- Footer
- Script tag for main.js

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>VoIP Server — Open-Source Voice & Chat Platform</title>
    <meta
      name="description"
      content="Self-hosted voice channels, text chat, roles, DMs, and more. Built with WebRTC and mediasoup."
    />
    <meta property="og:title" content="VoIP Server" />
    <meta property="og:description" content="Open-source, self-hosted voice and chat platform." />
    <meta property="og:type" content="website" />
    <link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="css/style.css" />
  </head>
  <body>
    <div class="bg-orbs">
      <div class="orb"></div>
      <div class="orb"></div>
      <div class="orb"></div>
    </div>

    <nav class="navbar">
      <div class="container">
        <a href="index.html" class="navbar-brand">
          <img src="assets/favicon.svg" alt="" />
          VoIP Server
        </a>
        <button class="hamburger" aria-label="Toggle navigation">
          <span></span><span></span><span></span>
        </button>
        <ul class="navbar-links">
          <li><a href="index.html" class="active">Home</a></li>
          <li><a href="features.html">Features</a></li>
          <li><a href="docs.html">Docs</a></li>
          <li><a href="downloads.html">Downloads</a></li>
        </ul>
      </div>
    </nav>

    <main>
      <section class="hero">
        <div class="container">
          <div class="hero-content">
            <h1>Your Voice,<br />Your Server</h1>
            <p class="hero-subtitle">
              An open-source, self-hosted platform for voice channels, text chat, roles, and more.
              No third parties. No data collection. Just communication.
            </p>
            <div class="hero-buttons">
              <a href="downloads.html" class="btn btn-primary">Download</a>
              <a
                href="https://github.com/sellserv/voice-server"
                class="btn btn-secondary"
                target="_blank"
                rel="noopener"
                >View on GitHub</a
              >
            </div>
          </div>
        </div>
      </section>

      <section class="highlights">
        <div class="container">
          <div class="highlights-grid">
            <a href="features.html" class="glass-card reveal">
              <div class="highlight-icon">🎙️</div>
              <h3>Crystal-Clear Voice</h3>
              <p class="text-secondary">
                WebRTC-powered voice channels with low latency via mediasoup SFU.
              </p>
            </a>
            <a href="features.html" class="glass-card reveal">
              <div class="highlight-icon">💬</div>
              <h3>Rich Text Chat</h3>
              <p class="text-secondary">
                Messages, replies, reactions, pins, file uploads, and more.
              </p>
            </a>
            <a href="features.html" class="glass-card reveal">
              <div class="highlight-icon">🛡️</div>
              <h3>Roles & Permissions</h3>
              <p class="text-secondary">
                Multi-role system with channel and group-level permission overrides.
              </p>
            </a>
            <a href="features.html" class="glass-card reveal">
              <div class="highlight-icon">🏠</div>
              <h3>Self-Hosted</h3>
              <p class="text-secondary">
                Your data stays on your hardware. No accounts, no tracking, no limits.
              </p>
            </a>
          </div>
        </div>
      </section>

      <section class="cta-section">
        <div class="container">
          <div class="cta-content reveal">
            <h2>Ready to get started?</h2>
            <p class="text-secondary">
              Set up your own server in minutes. Check out the docs for a step-by-step guide.
            </p>
            <a href="docs.html" class="btn btn-primary">Read the Docs</a>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div class="container">
        <div class="footer-content">
          <span>&copy; 2026 VoIP Server</span>
          <a href="https://github.com/sellserv/voice-server" target="_blank" rel="noopener"
            >GitHub</a
          >
        </div>
      </div>
    </footer>

    <script src="js/main.js"></script>
  </body>
</html>
```

**Step 2: Add home-page-specific styles to style.css**

Append to `css/style.css`:

```css
/* ===== Hero ===== */
.hero {
  padding: 120px 0 80px;
  text-align: center;
}

.hero-content {
  max-width: 700px;
  margin: 0 auto;
}

.hero h1 {
  margin-bottom: 24px;
  background: linear-gradient(135deg, #fff 0%, var(--accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-subtitle {
  font-size: clamp(1rem, 2vw, 1.25rem);
  color: var(--text-secondary);
  margin-bottom: 40px;
  line-height: 1.7;
}

.hero-buttons {
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
}

/* ===== Highlights grid ===== */
.highlights-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 24px;
}

.highlights-grid .glass-card {
  color: var(--text);
  text-decoration: none;
  display: block;
}

.highlights-grid .glass-card:hover {
  text-decoration: none;
}

.highlight-icon {
  font-size: 2rem;
  margin-bottom: 16px;
}

/* ===== CTA Section ===== */
.cta-section {
  text-align: center;
}

.cta-content h2 {
  margin-bottom: 16px;
}

.cta-content p {
  margin-bottom: 32px;
  font-size: 1.1rem;
}
```

**Step 3: Verify by opening the file**

Run:

```bash
cat /home/coder/projects/voip-website/index.html | head -5
```

Expected: `<!DOCTYPE html>` and proper structure

**Step 4: Commit**

```bash
cd /home/coder/projects/voip-website && git add index.html css/style.css && git commit -m "feat: add home page with hero, feature highlights, and CTA"
```

---

### Task 6: Features Page (`features.html`)

**Files:**

- Create: `voip-website/features.html`

**Step 1: Write features.html**

Same head/nav/footer structure as index.html but with `Features` link active. Main content is a page header and an 8-card grid covering all features from the design doc.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Features — VoIP Server</title>
    <meta
      name="description"
      content="Explore all features of VoIP Server: voice channels, text chat, roles, DMs, emoji, bots, and more."
    />
    <link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="css/style.css" />
  </head>
  <body>
    <div class="bg-orbs">
      <div class="orb"></div>
      <div class="orb"></div>
      <div class="orb"></div>
    </div>

    <nav class="navbar">
      <div class="container">
        <a href="index.html" class="navbar-brand">
          <img src="assets/favicon.svg" alt="" />VoIP Server
        </a>
        <button class="hamburger" aria-label="Toggle navigation">
          <span></span><span></span><span></span>
        </button>
        <ul class="navbar-links">
          <li><a href="index.html">Home</a></li>
          <li><a href="features.html" class="active">Features</a></li>
          <li><a href="docs.html">Docs</a></li>
          <li><a href="downloads.html">Downloads</a></li>
        </ul>
      </div>
    </nav>

    <main>
      <section class="page-header">
        <div class="container">
          <h1>Features</h1>
          <p class="text-secondary">
            Everything you need for your community, self-hosted and open-source.
          </p>
        </div>
      </section>

      <section class="features-grid-section">
        <div class="container">
          <div class="features-grid">
            <div class="glass-card reveal">
              <div class="feature-icon">🎙️</div>
              <h3>Voice Channels</h3>
              <p class="text-secondary">
                Real-time voice communication powered by WebRTC and mediasoup SFU. Low latency, high
                quality, multiple channels.
              </p>
            </div>
            <div class="glass-card reveal">
              <div class="feature-icon">💬</div>
              <h3>Text Chat</h3>
              <p class="text-secondary">
                Full-featured messaging with replies, pins, reactions, mentions, file uploads, and
                link previews.
              </p>
            </div>
            <div class="glass-card reveal">
              <div class="feature-icon">🛡️</div>
              <h3>Roles & Permissions</h3>
              <p class="text-secondary">
                Multi-role system with per-channel and per-group permission overrides. Fine-grained
                access control.
              </p>
            </div>
            <div class="glass-card reveal">
              <div class="feature-icon">✉️</div>
              <h3>DMs & Calls</h3>
              <p class="text-secondary">
                Private direct messages and one-on-one voice/video calls between users.
              </p>
            </div>
            <div class="glass-card reveal">
              <div class="feature-icon">😀</div>
              <h3>Custom Emoji & Soundboard</h3>
              <p class="text-secondary">
                Upload custom emoji for reactions and messages. Play sound effects in voice channels
                via the soundboard.
              </p>
            </div>
            <div class="glass-card reveal">
              <div class="feature-icon">🤖</div>
              <h3>Bot System</h3>
              <p class="text-secondary">
                Build and integrate bots to automate tasks, moderate content, or add fun commands.
              </p>
            </div>
            <div class="glass-card reveal">
              <div class="feature-icon">🎬</div>
              <h3>Watch Parties</h3>
              <p class="text-secondary">
                Watch videos together in sync with your community. Shared playback controls for
                everyone.
              </p>
            </div>
            <div class="glass-card reveal">
              <div class="feature-icon">🏠</div>
              <h3>Self-Hosted & Private</h3>
              <p class="text-secondary">
                Run it on your own hardware. No third-party accounts, no data collection, no limits.
                You own everything.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div class="container">
        <div class="footer-content">
          <span>&copy; 2026 VoIP Server</span>
          <a href="https://github.com/sellserv/voice-server" target="_blank" rel="noopener"
            >GitHub</a
          >
        </div>
      </div>
    </footer>

    <script src="js/main.js"></script>
  </body>
</html>
```

**Step 2: Add features-page-specific styles to style.css**

Append to `css/style.css`:

```css
/* ===== Page Header ===== */
.page-header {
  padding: 80px 0 40px;
  text-align: center;
}

.page-header p {
  margin-top: 12px;
  font-size: 1.15rem;
}

/* ===== Features Grid ===== */
.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
}

.feature-icon {
  font-size: 2.5rem;
  margin-bottom: 16px;
}
```

**Step 3: Commit**

```bash
cd /home/coder/projects/voip-website && git add features.html css/style.css && git commit -m "feat: add features page with 8 feature cards"
```

---

### Task 7: Docs Page (`docs.html`)

**Files:**

- Create: `voip-website/docs.html`

**Step 1: Write docs.html**

Same head/nav/footer structure. Main content has an anchor-based sidebar navigation and documentation sections: Prerequisites, Clone & Install, Environment Configuration, Running the Server, Accessing the App. Includes styled code blocks.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Documentation — VoIP Server</title>
    <meta
      name="description"
      content="Step-by-step guide to set up and run your own VoIP Server instance."
    />
    <link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="css/style.css" />
  </head>
  <body>
    <div class="bg-orbs">
      <div class="orb"></div>
      <div class="orb"></div>
      <div class="orb"></div>
    </div>

    <nav class="navbar">
      <div class="container">
        <a href="index.html" class="navbar-brand">
          <img src="assets/favicon.svg" alt="" />VoIP Server
        </a>
        <button class="hamburger" aria-label="Toggle navigation">
          <span></span><span></span><span></span>
        </button>
        <ul class="navbar-links">
          <li><a href="index.html">Home</a></li>
          <li><a href="features.html">Features</a></li>
          <li><a href="docs.html" class="active">Docs</a></li>
          <li><a href="downloads.html">Downloads</a></li>
        </ul>
      </div>
    </nav>

    <main>
      <section class="page-header">
        <div class="container">
          <h1>Documentation</h1>
          <p class="text-secondary">Get your server up and running in minutes.</p>
        </div>
      </section>

      <section class="docs-section">
        <div class="container">
          <div class="docs-layout">
            <aside class="docs-sidebar">
              <nav class="docs-nav glass-card">
                <h4>On This Page</h4>
                <ul>
                  <li><a href="#prerequisites">Prerequisites</a></li>
                  <li><a href="#clone-install">Clone & Install</a></li>
                  <li><a href="#environment">Environment Config</a></li>
                  <li><a href="#running">Running the Server</a></li>
                  <li><a href="#accessing">Accessing the App</a></li>
                </ul>
              </nav>
            </aside>

            <div class="docs-content">
              <div id="prerequisites" class="docs-block reveal">
                <h2>Prerequisites</h2>
                <ul>
                  <li>
                    <strong>Node.js</strong> — version 18 or later (<a
                      href="https://nodejs.org"
                      target="_blank"
                      rel="noopener"
                      >nodejs.org</a
                    >)
                  </li>
                  <li><strong>npm</strong> — comes with Node.js</li>
                </ul>
              </div>

              <div id="clone-install" class="docs-block reveal">
                <h2>Clone & Install</h2>
                <p>Clone the repository and install dependencies for both the server and client:</p>
                <pre><code>git clone https://github.com/sellserv/voice-server.git
cd voice-server

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install</code></pre>
              </div>

              <div id="environment" class="docs-block reveal">
                <h2>Environment Configuration</h2>
                <p>Create a <code>.env</code> file in the <code>server/</code> directory:</p>
                <pre><code># server/.env
PORT=3000
JWT_SECRET=your-secret-key-here
ANNOUNCED_IP=your-server-ip</code></pre>
                <p class="text-secondary" style="margin-top: 12px;">
                  Replace <code>your-secret-key-here</code> with a strong random string and
                  <code>your-server-ip</code> with your machine's LAN or public IP address.
                </p>
              </div>

              <div id="running" class="docs-block reveal">
                <h2>Running the Server</h2>
                <h3>Development</h3>
                <p>Start both the server and client in development mode:</p>
                <pre><code># Terminal 1 — Server
cd server
npm run dev

# Terminal 2 — Client
cd client
npm run dev</code></pre>
                <h3>Production</h3>
                <p>Build and run for production:</p>
                <pre><code># Build the client
cd client
npm run build

# Start the server (serves built client)
cd ../server
npm start</code></pre>
              </div>

              <div id="accessing" class="docs-block reveal">
                <h2>Accessing the App</h2>
                <p>Once running, open your browser and navigate to:</p>
                <pre><code>http://localhost:3000</code></pre>
                <p class="text-secondary" style="margin-top: 12px;">
                  The first user to register will automatically be assigned the admin role.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div class="container">
        <div class="footer-content">
          <span>&copy; 2026 VoIP Server</span>
          <a href="https://github.com/sellserv/voice-server" target="_blank" rel="noopener"
            >GitHub</a
          >
        </div>
      </div>
    </footer>

    <script src="js/main.js"></script>
  </body>
</html>
```

**Step 2: Add docs-page-specific styles to style.css**

Append to `css/style.css`:

```css
/* ===== Docs Layout ===== */
.docs-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 40px;
  align-items: start;
}

.docs-sidebar {
  position: sticky;
  top: calc(var(--nav-height) + 24px);
}

.docs-nav {
  padding: 20px;
}

.docs-nav h4 {
  margin-bottom: 12px;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.docs-nav ul {
  list-style: none;
}

.docs-nav li {
  margin-bottom: 8px;
}

.docs-nav a {
  color: var(--text-secondary);
  font-size: 0.9rem;
  transition: color 0.2s;
}

.docs-nav a:hover {
  color: var(--accent);
  text-decoration: none;
}

.docs-block {
  margin-bottom: 48px;
}

.docs-block h2 {
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-card);
}

.docs-block h3 {
  margin: 24px 0 12px;
}

.docs-block p {
  margin-bottom: 16px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.docs-block ul {
  margin-bottom: 16px;
  padding-left: 24px;
}

.docs-block li {
  margin-bottom: 8px;
  color: var(--text-secondary);
}

/* ===== Code Blocks ===== */
pre {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  padding: 20px;
  overflow-x: auto;
  margin-bottom: 16px;
}

code {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.9rem;
  line-height: 1.6;
}

:not(pre) > code {
  background: rgba(124, 92, 252, 0.15);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.85em;
}

/* Docs responsive */
@media (max-width: 767px) {
  .docs-layout {
    grid-template-columns: 1fr;
  }

  .docs-sidebar {
    position: static;
  }
}
```

**Step 3: Commit**

```bash
cd /home/coder/projects/voip-website && git add docs.html css/style.css && git commit -m "feat: add docs page with setup instructions and sidebar nav"
```

---

### Task 8: Downloads Page (`downloads.html`)

**Files:**

- Create: `voip-website/downloads.html`

**Step 1: Write downloads.html**

Same head/nav/footer structure. Main content has 3 platform cards (Windows, Linux, macOS) each showing "Coming Soon" with a disabled download button.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Downloads — VoIP Server</title>
    <meta name="description" content="Download VoIP Server for Windows, Linux, or macOS." />
    <link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="css/style.css" />
  </head>
  <body>
    <div class="bg-orbs">
      <div class="orb"></div>
      <div class="orb"></div>
      <div class="orb"></div>
    </div>

    <nav class="navbar">
      <div class="container">
        <a href="index.html" class="navbar-brand">
          <img src="assets/favicon.svg" alt="" />VoIP Server
        </a>
        <button class="hamburger" aria-label="Toggle navigation">
          <span></span><span></span><span></span>
        </button>
        <ul class="navbar-links">
          <li><a href="index.html">Home</a></li>
          <li><a href="features.html">Features</a></li>
          <li><a href="docs.html">Docs</a></li>
          <li><a href="downloads.html" class="active">Downloads</a></li>
        </ul>
      </div>
    </nav>

    <main>
      <section class="page-header">
        <div class="container">
          <h1>Downloads</h1>
          <p class="text-secondary">Get VoIP Server for your platform.</p>
        </div>
      </section>

      <section class="downloads-section">
        <div class="container">
          <div class="downloads-grid">
            <div class="glass-card download-card reveal">
              <div class="download-icon">🪟</div>
              <h3>Windows</h3>
              <p class="text-secondary">Windows 10 or later (64-bit)</p>
              <span class="badge">Coming Soon</span>
              <!-- Replace with: <a href="URL" class="btn btn-primary">Download .exe</a> -->
            </div>
            <div class="glass-card download-card reveal">
              <div class="download-icon">🐧</div>
              <h3>Linux</h3>
              <p class="text-secondary">Ubuntu, Debian, Fedora, Arch (64-bit)</p>
              <span class="badge">Coming Soon</span>
              <!-- Replace with: <a href="URL" class="btn btn-primary">Download .AppImage</a> -->
            </div>
            <div class="glass-card download-card reveal">
              <div class="download-icon">🍎</div>
              <h3>macOS</h3>
              <p class="text-secondary">macOS 12 Monterey or later</p>
              <span class="badge">Coming Soon</span>
              <!-- Replace with: <a href="URL" class="btn btn-primary">Download .dmg</a> -->
            </div>
          </div>

          <div class="downloads-alt reveal" style="margin-top: 64px; text-align: center;">
            <h2>Build from Source</h2>
            <p class="text-secondary" style="margin: 12px 0 24px;">
              Prefer to build it yourself? Check out the docs for setup instructions.
            </p>
            <a href="docs.html" class="btn btn-secondary">View Docs</a>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div class="container">
        <div class="footer-content">
          <span>&copy; 2026 VoIP Server</span>
          <a href="https://github.com/sellserv/voice-server" target="_blank" rel="noopener"
            >GitHub</a
          >
        </div>
      </div>
    </footer>

    <script src="js/main.js"></script>
  </body>
</html>
```

**Step 2: Add downloads-page-specific styles to style.css**

Append to `css/style.css`:

```css
/* ===== Downloads ===== */
.downloads-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 24px;
}

.download-card {
  text-align: center;
}

.download-icon {
  font-size: 3rem;
  margin-bottom: 16px;
}

.download-card h3 {
  margin-bottom: 8px;
}

.download-card p {
  margin-bottom: 20px;
}

.badge {
  display: inline-block;
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
  background: rgba(124, 92, 252, 0.15);
  color: var(--accent);
  border: 1px solid rgba(124, 92, 252, 0.3);
}
```

**Step 3: Commit**

```bash
cd /home/coder/projects/voip-website && git add downloads.html css/style.css && git commit -m "feat: add downloads page with platform cards"
```

---

### Task 9: Final Polish & Verification

**Files:**

- Review all files

**Step 1: Verify all files exist**

Run:

```bash
find /home/coder/projects/voip-website -type f | sort
```

Expected:

```
voip-website/assets/favicon.svg
voip-website/css/style.css
voip-website/downloads.html
voip-website/docs.html
voip-website/features.html
voip-website/index.html
voip-website/js/main.js
```

**Step 2: Validate HTML structure**

Run for each file:

```bash
grep -c '</html>' /home/coder/projects/voip-website/*.html
```

Expected: each file shows `1`

**Step 3: Check that all internal links are consistent**

Run:

```bash
grep -oh 'href="[^"]*\.html"' /home/coder/projects/voip-website/*.html | sort | uniq
```

Expected links: `index.html`, `features.html`, `docs.html`, `downloads.html`

**Step 4: Final commit if any polish was needed**

```bash
cd /home/coder/projects/voip-website && git status
```

If clean: done. If changes exist:

```bash
git add -A && git commit -m "chore: final polish"
```

**Step 5: Log completion**

Run:

```bash
echo "Website build complete. Open index.html in a browser to preview."
```
