import { defineConfig } from '@playwright/test'
export default defineConfig({
 outputDir:'test-results-shell',
 testDir:'tests/shell',timeout:60000,workers:1,reporter:'list',updateSnapshots:'none',
 use:{trace:'retain-on-failure',screenshot:'only-on-failure',baseURL:'http://127.0.0.1:5873',viewport:{width:1440,height:900}},
 webServer:[
  {command:'node node_modules/tsx/dist/cli.mjs server/index.ts',url:'http://127.0.0.1:5874/api/app/info',env:{API_PORT:'5874',DATA_DIR:'data-shell-proof',XIUMI_SKIP_ENV_FILES:'1'},reuseExistingServer:false},
  {command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5873 --strictPort',url:'http://127.0.0.1:5873',env:{API_PORT:'5874',VITE_CACHE_DIR:'.cache/editorial-shell'},reuseExistingServer:false}
 ]})
