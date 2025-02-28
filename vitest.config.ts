import { defineConfig, ViteUserConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    browser: {
      enabled: true,
      headless: true,
      provider: 'playwright',
      instances: [
        {
          browser: 'chromium',
          // @ts-ignore
          launch: {
            args: [
              '--use-fake-ui-for-media-stream',
              '--use-fake-device-for-media-stream',
            ],
          },
        },
      ],
    },
    testTimeout: 15_000,
    reporters: ['json', 'default'],
    // fileParallelism: false,
    retry: 2,
  },
}) as ViteUserConfig;
