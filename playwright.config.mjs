import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./e2e',workers:1,timeout:45000,use:{baseURL:'http://127.0.0.1:3000',channel:process.env.E2E_CHANNEL || (process.platform==='win32'?'msedge':'chromium'),headless:true,screenshot:'only-on-failure'},reporter:'list'});
