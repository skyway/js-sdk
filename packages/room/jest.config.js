/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  setupFiles: ['./jest.setup.js'],
  testEnvironment: 'jsdom',
  testRegex: 'jest/.*\\.test\\.ts$',
  transformIgnorePatterns: [
    '/node_modules/(?!(?:\\.pnpm/uuid@[^/]+/node_modules/uuid|uuid)/)',
  ],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};

module.exports = config;
