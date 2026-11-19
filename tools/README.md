# Rebuilding the profile images

The profile README is the portfolio site (`../github page`) rendered section by section.

1. Serve the site: `cd "../github page" && python3 -m http.server 8765 --bind 127.0.0.1`
2. Capture both themes (headless Chromium from the Playwright cache, one session, virtual time):
   `node tools/capture.mjs light /tmp/cap/light` and `node tools/capture.mjs dark /tmp/cap/dark`
3. Encode: static sections with `cwebp -q 88 -m 6 -sharp_yuv`, animated ones with
   `img2webp -loop 0 -lossy -q 82 -d 100` (hero uses `-d 140`), into `assets/<name>-<theme>.webp`.
