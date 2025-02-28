import { defineConfig, mergeConfig } from 'vitest/config';
import vitestConfig from '../../vitest.config';

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      testTimeout: 20_000,
      outputFile: './test-extra.json',
    },
  })
);
