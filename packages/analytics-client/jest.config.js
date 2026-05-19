module.exports = {
  roots: ['<rootDir>/'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transformIgnorePatterns: [
    '/node_modules/(?!(?:\\.pnpm/uuid@[^/]+/node_modules/uuid|uuid)/)',
  ],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
};
