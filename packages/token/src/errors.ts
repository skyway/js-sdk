export const tokenErrors = {
  invalidParameter: {
    name: 'invalidParameter',
    detail: 'failed to decode token',
    solution: 'Use the correct token according to the specification',
  },
  invalidAppIdParameter: {
    name: 'invalidAppIdParameter',
    detail: 'failed to get AppId',
    solution: 'Use the correct token according to the specification',
  },
  invalidAnalyticsParameter: {
    name: 'invalidAnalyticsParameter',
    detail: 'failed to get analytics scope',
    solution: 'Use the correct token according to the specification',
  },
} as const;
