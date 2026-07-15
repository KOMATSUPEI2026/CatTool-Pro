import { createClient } from '@supabase/supabase-js';

/* Supabase 客戶端單例：整個 App 唯一的建立點（cloud.js 經此存取）。
   連線資訊走 Vite env（本機 .env.local、部署走 GitHub Actions secret）；
   anon key 屬公開金鑰，實際資料存取由 RLS（auth.uid() = user_id）把關。
   缺設定時退化為 stub：訪客模式照常可用，僅雲端功能吐錯，不讓整個 App 掛掉 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function stubClient() {
  const err = new Error('Supabase 未設定：缺 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  const fail = async () => ({ data: null, error: err });
  console.error(err.message);
  return {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: fail,
      signOut: fail
    },
    from() { throw err; }
  };
}

export const supabase = (url && anonKey) ? createClient(url, anonKey) : stubClient();
