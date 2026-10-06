import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // 只把網址帶進前端，.env 裡的帳密等其他設定不會進 bundle
  const env = loadEnv(mode, process.cwd(), 'FUNC_MAP_BASE_URL');
  return {
    base: './',
    plugins: [react()],
    envPrefix: 'FUNC_MAP_PUBLIC_', // 不讓 Vite 自動暴露任何 FUNC_MAP_* 變數
    define: { __SITE_URL__: JSON.stringify((env.FUNC_MAP_BASE_URL || '').replace(/\/$/, '')) },
    server: { port: 5180 },
  };
});
