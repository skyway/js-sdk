module.exports = {
  roots: ['<rootDir>/'],
  setupFilesAfterEnv: ['./__tests__/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
};
