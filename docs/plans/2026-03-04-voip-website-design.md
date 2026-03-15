# VoIP Server Website — Design Document

**Date:** 2026-03-04
**Location:** `/home/coder/projects/voip-website/`
**Stack:** Plain HTML/CSS/JS (no build step, GitHub Pages compatible)

## Overview

A static marketing/documentation website for the VoIP Server project. Four pages with a dark theme matching the app's visual identity (purple accent, glassmorphism).

## Pages

### Home (`index.html`)

- Hero section with title "VoIP Server", subtitle, and two CTA buttons (Download, View on GitHub)
- Animated gradient background orbs for depth
- 3-4 highlight cards previewing key features, linking to Features page
- Final CTA section before footer

### Features (`features.html`)

- Grid of glass-style cards covering:
  - Voice channels (WebRTC/mediasoup)
  - Text chat (messages, replies, pins, reactions, file uploads)
  - Role & permissions (multi-role, channel/group overrides)
  - DMs & calls
  - Custom emoji & soundboard
  - Bot system
  - Watch parties
  - Self-hosted & privacy

### Docs (`docs.html`)

- Hosting/setup documentation with sections:
  - Prerequisites (Node.js, npm)
  - Clone & install
  - Environment configuration
  - Running the server (dev and production)
  - Accessing the app
- Code blocks with dark styling
- Anchor navigation for sections

### Downloads (`downloads.html`)

- Three platform cards: Windows, Linux, macOS
- All showing "Coming Soon" badge initially
- Structured for easy swap to real download URLs later

## Visual Design

- **Background:** `#0a0a0f` (deep dark)
- **Accent:** `#7c5cfc` (purple) with glow effects
- **Text:** white/grey hierarchy
- **Cards:** Glassmorphism — semi-transparent with `backdrop-filter: blur()`, subtle white borders
- **Background decoration:** Blurred gradient orbs (purple/blue)
- **Hover effects:** Card lift + glow
- **Scroll reveal:** Fade-in via Intersection Observer

## Navigation

- Fixed top navbar: logo/name left, page links right
- Hamburger menu on mobile (<768px)
- Consistent across all pages

## Footer

- GitHub link (github.com/sellserv/voice-server)
- Copyright

## Responsive Breakpoints

- Desktop: 1024px+ — full nav, multi-column grids
- Tablet: 768-1023px — 2-column grids, horizontal nav
- Mobile: <768px — hamburger menu, single column

## Accessibility & SEO

- Semantic HTML (`<nav>`, `<main>`, `<section>`, `<footer>`)
- `prefers-reduced-motion` support
- Open Graph meta tags
- Favicon (purple accent SVG)

## File Structure

```
voip-website/
  index.html
  features.html
  docs.html
  downloads.html
  css/
    style.css
  js/
    main.js
  assets/
    favicon.svg
```

## External Links

- GitHub: https://github.com/sellserv/voice-server
- Downloads: Coming Soon (placeholder)
