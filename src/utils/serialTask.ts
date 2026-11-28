/**
 * 同一时间只运行一次 task；运行期间的新调用不会丢弃当前任务，而是在它完成后再运行一次（按最新状态）。
 * 用于预览绘制：每帧都取消未完成的绘制时，解码慢于播放帧率的画面永远画不出来
 */
export function serialTask(task: () => Promise<void>) {
  const state = { running: false, again: false };
  return async() => {
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    try {
      do {
        state.again = false;
        // eslint-disable-next-line no-await-in-loop
        await task();
      } while (state.again);
    } finally {
      state.running = false;
    }
  };
}
