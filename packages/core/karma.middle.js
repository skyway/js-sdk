/* eslint-disable @typescript-eslint/no-var-requires */

const baseConfig = require('../../karma.base');

const testPath = 'tests/middle/**/*.ts';
const reportPath = 'reports/middle';

module.exports = function (config) {
  config.set({
    ...baseConfig,
    files: ['src/**/*.ts', 'tests/common/**/*ts', testPath],
    preprocessors: {
      'src/**/*.ts': 'karma-typescript',
      'tests/common/**/*ts': 'karma-typescript',
      [testPath]: 'karma-typescript',
    },
    logLevel: config.LOG_INFO,
    coverageReporter: { dir: reportPath },
  });
};
