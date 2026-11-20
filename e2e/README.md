# Chromium browser tests

Run `pnpm install --frozen-lockfile` to apply the WebAV patches, then
`pnpm exec playwright install --with-deps chromium` and `pnpm test:e2e`.
Playwright starts Vite on port 4008. Each test has an isolated browser context
and OPFS. Tests live outside `src/` so Vitest does not collect them.

`fixtures/sample.mp4` is a 13 KB, half-second 160×90, 12 fps H.264 color
test pattern with a 440 Hz AAC audio track. Reproduce it with:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=12 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 -t 0.5 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart sample.mp4
```

Imports, decoding, preview pixels, H.264/Opus encoding and OPFS are real. The
export test redirects the save picker to an OPFS file, plays that MP4 in Chromium,
and uses Web Audio to check for the fixture's 440 Hz tone, including after
re-importing and re-exporting the saved file. The cancellation
test replaces the picker with one that throws AbortError; neither test opens a
native OS dialog. Unsupported-codec tests mock only the selected encoder's
`isConfigSupported` result.
The video-plus-text test also records the H.264 settings passed to the native
capability check before stopping at the simulated Opus rejection.
