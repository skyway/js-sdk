const chromeFlags = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--use-file-for-fake-audio-capture=./assets/1.wav',
];
const firefoxFlags = {
  'media.navigator.permission.disabled': true,
  'media.navigator.streams.fake': true,
  'network.http.max-persistent-connections-per-server': 10000,
};

module.exports = {
  basePath: '',
  frameworks: ['jasmine', 'karma-typescript'],
  exclude: [],
  reporters: ['progress', 'coverage'],
  port: 9876,
  colors: true,
  autoWatch: true,
  customLaunchers: {
    chrome_with_fake_device: {
      base: 'Chrome',
      flags: chromeFlags,
    },
    chrome_headless_with_fake_device: {
      base: 'ChromeHeadless',
      flags: chromeFlags,
    },
    safari: {
      base: 'Safari',
    },
    FirefoxAutoAllowGUM: {
      base: 'Firefox',
      prefs: firefoxFlags,
    },
    FirefoxHeadlessAutoAllowGUM: {
      base: 'FirefoxHeadless',
      prefs: firefoxFlags,
    },
  },
  singleRun: false,
  concurrency: Infinity,
  karmaTypescriptConfig: {
    compilerOptions: {
      baseUrl: '.',
      module: 'commonjs',
      target: 'ES2020',
      lib: ['DOM', 'ES2020'],
      sourceMap: true,
      declaration: true,
      declarationMap: true,
      noEmitOnError: true,
      skipLibCheck: true,
      esModuleInterop: true,
      strict: true,
    },
    exclude: ['node_modules', 'example', 'examples', 'debug', 'typedoc', 'doc'],
    bundlerOptions: {
      transforms: [
        require('karma-typescript-es6-transform')()
      ]
    },
  },
};
