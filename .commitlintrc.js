module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'type-enum': [
      2,
      'always',
      ['docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test', 'ci', 'chore', 'wip'],
    ],
    'subject-empty': [2, 'never'],
    'subject-min-length': [2, 'always', 2],
  },
};
