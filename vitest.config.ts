import { availableParallelism } from 'node:os';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig, type ViteUserConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ],
        },
      }),
      instances: [
        {
          browser: 'chromium',
        },
      ],
    },
    // 既定の maxWorkers は availableParallelism() - 1 で、2 vCPU の runner では 1 になり
    // テストファイルが逐次実行される。この層はネットワーク待ちが大半で CPU が余るため、
    // CI では 4 を下限にする。ローカルは既定のままにして、コアの少ない開発機で
    // 並列度が上がらないようにする。
    ...(process.env.CI
      ? { maxWorkers: Math.max(4, availableParallelism() - 1) }
      : {}),
    testTimeout: 15_000,
    reporters: ['json', 'default'],
    // fileParallelism: false,
    retry: 2,
  },
}) as ViteUserConfig;
