import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@skyway-sdk/common': '@skyway-sdk/common/dist',
      '@skyway-sdk/core': '@skyway-sdk/core/dist',
      '@skyway-sdk/rtc-api-client': '@skyway-sdk/rtc-api-client/dist',
      '@skyway-sdk/rtc-rpc-api-client': '@skyway-sdk/rtc-rpc-api-client/dist',
      '@skyway-sdk/sfu-bot': '@skyway-sdk/sfu-bot/dist',
      '@skyway-sdk/sfu-api-client': '@skyway-sdk/sfu-api-client/dist',
      '@skyway-sdk/message-client': '@skyway-sdk/message-client/dist',
      '@skyway-sdk/token': '@skyway-sdk/token/dist',
    },
  },
});
