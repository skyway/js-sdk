import { defineConfig, mergeConfig } from 'vitest/config';
import vitestConfig from '../../vitest.config';

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      // https://docs.github.com/en/actions/reference/runners/github-hosted-runners
      ...(process.env.CI
        ? { maxConcurrency: 4, maxWorkers: 4 }
        : { maxConcurrency: 4 }),
      testTimeout: 20_000,
      outputFile: './test-extra.json',
    },
  }),
);
