/* eslint-disable @typescript-eslint/no-var-requires */

const baseConfig = require('../../karma.base');

const testPath = 'tests/large/**/*.ts';
const reportPath = 'reports/large';

module.exports = function (config) {
  config.set({
    ...baseConfig,
    files: ['src/**/*.ts', 'tests/common/**/*ts', testPath, '../../env.ts'],
    preprocessors: {
      'src/**/*.ts': 'karma-typescript',
      'tests/common/**/*ts': 'karma-typescript',
      '../../env.ts': 'karma-typescript',
      [testPath]: 'karma-typescript',
    },
    logLevel: config.LOG_INFO,
    coverageReporter: { dir: reportPath },
  });
};
