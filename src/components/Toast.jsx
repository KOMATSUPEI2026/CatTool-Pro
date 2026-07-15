import { useEffect, useState } from 'react';
import { useStore } from '../store.js';

/* 頂部置中輕量提示：2.4 秒自動消失、單例頂替（新訊息重置計時） */
export default function Toast() {
  const toast = useStore(s => s.toast);
  const [shown, setShown] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    setVisible(false);
    const raf = requestAnimationFrame(() => setVisible(true));
    const hide = setTimeout(() => setVisible(false), 2400);
    const gone = setTimeout(() => setShown(null), 2600);   // 等淡出動畫跑完再卸載
    return () => { cancelAnimationFrame(raf); clearTimeout(hide); clearTimeout(gone); };
  }, [toast]);

  if (!shown) return null;
  return <div className={'toast' + (visible ? ' show' : '')}>{shown.msg}</div>;
}
