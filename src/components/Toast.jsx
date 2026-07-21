import { useEffect, useState } from 'react';
import { useStore } from '../store.js';

/* 頂部置中輕量提示：滯留時間依訊息長度動態（長訊息看得完才收）、單例頂替（新訊息重置計時） */
const FADE_MS = 200;
// 短訊息至少 3.6 秒、每字 +75ms、上限 9 秒（長段落提示如「儲存未完成…」看得清楚才消失）
function dwellFor(msg){
  return Math.min(9000, Math.max(3600, 1800 + (msg ? msg.length : 0) * 75));
}

export default function Toast() {
  const toast = useStore(s => s.toast);
  const [shown, setShown] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    setVisible(false);
    const dwell = dwellFor(toast.msg);
    const raf = requestAnimationFrame(() => setVisible(true));
    const hide = setTimeout(() => setVisible(false), dwell);
    const gone = setTimeout(() => setShown(null), dwell + FADE_MS);   // 等淡出動畫跑完再卸載
    return () => { cancelAnimationFrame(raf); clearTimeout(hide); clearTimeout(gone); };
  }, [toast]);

  if (!shown) return null;
  return <div className={'toast' + (visible ? ' show' : '')}>{shown.msg}</div>;
}
