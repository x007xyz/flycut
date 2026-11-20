# Chromium browser tests

Run `pnpm exec playwright install --with-deps chromium`, then `pnpm test:e2e`.
Playwright starts Vite on port 4008. Each test has an isolated browser context
and OPFS. Tests live outside `src/` so Vitest does not collect them.

`fixtures/sample.mp4` is a 13 KB, half-second 160×90, 12 fps H.264 color
test pattern with a 440 Hz AAC audio track. Reproduce it with:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=12 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 -t 0.5 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart sample.mp4
```

Imports, decoding, preview pixels, H.264 encoding and OPFS are real. No app
modules are mocked. The save picker is replaced with an AbortError-throwing
browser API and a call counter, avoiding a native OS dialog. Unsupported-codec
tests replace only the selected encoder's `isConfigSupported` with `false`.

In the cancellation test only, if native AAC encoding is unavailable (as in
Playwright's Linux Chromium), an AudioEncoder subclass reports support and
delegates configure to native Opus instead of AAC. This exercises rendering,
staging, confirmation, picker cancellation, cleanup and repeated exports with
real encoded bytes, but **does not validate playable AAC/MP4 output**. Browsers
with AAC support use native AAC unchanged. A native successful save and exported
file playback are not covered. No codec support is faked in the error tests.
