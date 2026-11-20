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
modules are mocked. Export tests make the selected encoder report that its
configuration is unsupported, without replacing any encoders.

The save picker returns an OPFS file handle in the silent-export test and
throws AbortError in the cancellation test. The silent-export test plays the
saved MP4 and checks that it has a video track and no audio track. Native save
dialogs and successful AAC encoding are not covered by this suite.
