import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './'：GitHub Pages 部署在 /CatTool/ 子路徑，相對路徑兩邊通用
export default defineConfig({
  base: './',
  plugins: [react()]
});
