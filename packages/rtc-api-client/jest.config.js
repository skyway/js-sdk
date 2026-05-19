module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  transformIgnorePatterns: [
    '/node_modules/(?!(?:\\.pnpm/uuid@[^/]+/node_modules/uuid|uuid)/)',
  ],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};
