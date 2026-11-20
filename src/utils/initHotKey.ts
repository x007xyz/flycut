import { useTrackState } from '@/stores/trackState';
const store = useTrackState();
export const initHotKey = () => {
    // 注册全局事件
    window.onkeydown = (event: KeyboardEvent) => {
      // 判断按键是否在输入框中
      let activeElement = document.activeElement;
      if (activeElement && (['input', 'textarea'].includes(activeElement.tagName.toLowerCase()) || activeElement.isContentEditable)) {
        return;
      }
      const { ctrlKey, metaKey, shiftKey, key } = event;
      if ((ctrlKey || metaKey) && ['z', 'y'].includes(key.toLowerCase())) {
        event.preventDefault();
        if (key.toLowerCase() === 'y' || shiftKey) store.redo();
        else store.undo();
        return;
      }
      switch (key) {
          case 'Backspace':
              event.preventDefault();
              store.flushHistory();
              // 删除操作
              if (store.selectTrackItem.line !== -1 && store.selectTrackItem.index !== -1) {
                  store.removeTrack(store.selectTrackItem.line, store.selectTrackItem.index);
                  store.selectTrackItem.line = -1;
                  store.selectTrackItem.index = -1;
              }
              break;
          case 'Enter':
              break;
          default:
              break;
      }
    };
};