/* eslint-disable @typescript-eslint/no-var-requires */

const baseConfig = require('../../karma.base');

const testPath = 'tests/small/**/*.ts';
const reportPath = 'reports/small';

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
