module.exports = {
  roots: ['<rootDir>/'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest',{
      tsconfig: 'tsconfig.test.json',
    }],
  }
};
