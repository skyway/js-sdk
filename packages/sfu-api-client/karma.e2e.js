/* eslint-disable @typescript-eslint/no-var-requires */

const baseConfig = require('../../karma.base');

module.exports = function (config) {
  config.set({
    ...baseConfig,
    files: ['src/**/*.ts', 'e2e/**/*.ts'],
    preprocessors: {
      'src/**/*.ts': 'karma-typescript',
      'e2e/**/*.ts': 'karma-typescript',
    },
    logLevel: config.LOG_INFO,
  });
};
