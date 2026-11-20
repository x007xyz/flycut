import { baseFps } from '@/data/trackConfig';

type ClipTiming = { start: number; end: number; offsetL: number };

export function sourceTimeAt(clip: ClipTiming, frame: number) {
  return (frame - clip.start + clip.offsetL) / baseFps;
}

export function timelineFrameAt(clip: ClipTiming, mediaTime: number) {
  const frame = clip.start - clip.offsetL + Math.floor(mediaTime * baseFps + 1e-6);
  return Math.max(clip.start, Math.min(frame, clip.end - 1));
}

export function observeVideoFrames(video: HTMLVideoElement, onFrame: (time: number | null) => void) {
  const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function';
  let callback: number | undefined;
  let disposed = false;

  function present(time: number) {
    if (video.readyState >= 2 && !video.seeking && !video.ended) onFrame(time);
  }
  const presentCurrent = () => present(video.currentTime);
  const clear = () => onFrame(null);
  const cancel = () => {
    if (callback !== undefined) video.cancelVideoFrameCallback(callback);
    callback = undefined;
  };
  function schedule() {
    if (disposed || !hasFrameCallback || video.paused || video.ended || callback !== undefined) return;
    callback = video.requestVideoFrameCallback((_now, { mediaTime }) => {
      callback = undefined;
      if (disposed) return;
      present(mediaTime);
      schedule();
    });
  }
  function onPause() {
    cancel();
    presentCurrent();
  }
  function onEnd() {
    cancel();
    clear();
  }
  const listeners = {
    play: schedule, pause: onPause, ended: onEnd,
    seeked: presentCurrent, loadeddata: presentCurrent, emptied: clear, error: onEnd,
    ...(!hasFrameCallback && { timeupdate: presentCurrent })
  };
  for (const [event, listener] of Object.entries(listeners)) video.addEventListener(event, listener);
  presentCurrent();
  schedule();
  return () => {
    disposed = true;
    cancel();
    for (const [event, listener] of Object.entries(listeners)) video.removeEventListener(event, listener);
  };
}
