/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  setupFiles: ['./jest.setup.js'],
  testEnvironment: 'jsdom',
  testRegex: 'tests/jest/.*\\.test\\.ts$',
};

module.exports = config;
