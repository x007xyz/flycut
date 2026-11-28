import { useTrackState } from '@/stores/trackState';
import { usePlayerState } from '@/stores/playerState';
import { baseFps } from '@/data/trackConfig';

/** 焦点在输入框、滑块等自己处理按键的控件上时不处理快捷键 */
export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ['input', 'textarea', 'select'].includes(target.tagName.toLowerCase()) || target.isContentEditable
    || Boolean(target.closest('[role="slider"], [role="spinbutton"], [role="listbox"], [role="menu"]'));
}

export const initHotKey = () => {
  const store = useTrackState();
  const player = usePlayerState();
  function seek(frame: number) {
    player.isPause = true;
    player.playStartFrame = Math.max(0, Math.min(frame, store.frameCount));
  }
  function zoom(step: number) {
    store.trackScale = Math.max(0, Math.min(100, store.trackScale + step));
  }
  // 捕获阶段处理，先于时间轴自带的方向键处理，避免播放头移动两次
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (isTypingTarget(document.activeElement) || isTypingTarget(event.target)) return;
    const { ctrlKey, metaKey, shiftKey, altKey } = event;
    const key = event.key.toLowerCase();
    const mod = ctrlKey || metaKey;
    if (mod && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (key === 'y' || shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && key === 'b') {
      event.preventDefault();
      store.splitSelected(player.playStartFrame, { width: player.playerWidth, height: player.playerHeight });
      return;
    }
    if (mod && (key === '=' || key === '+' || key === '-')) {
      event.preventDefault();
      zoom(key === '-' ? -10 : 10);
      return;
    }
    if (mod || altKey) return;
    switch (key) {
      case 'backspace':
      case 'delete':
        event.preventDefault();
        store.removeSelected();
        break;
      case 'arrowleft':
      case 'arrowright':
        event.preventDefault();
        event.stopPropagation();
        seek(player.playStartFrame + (key === 'arrowleft' ? -1 : 1) * (shiftKey ? baseFps : 1));
        break;
      case 'home':
        event.preventDefault();
        seek(0);
        break;
      case 'end':
        event.preventDefault();
        seek(store.frameCount);
        break;
      case 'escape':
        store.selectTrackItem.line = -1;
        store.selectTrackItem.index = -1;
        break;
      default:
        break;
    }
  }, { capture: true });
};
