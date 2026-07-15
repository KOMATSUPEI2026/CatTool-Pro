import { createRoot } from 'react-dom/client';
import 'bootstrap-icons/font/bootstrap-icons.min.css';
import './cat-tool.css';
import App from './App.jsx';
import { useStore } from './store.js';
import * as cloud from './cloud.js';

// 測試後門：Puppeteer 驗收經 __catStore 注入資料、經 __catCloud.db 替換為記憶體假資料庫
window.__catStore = useStore;
window.__catCloud = cloud;

createRoot(document.getElementById('root')).render(<App />);
