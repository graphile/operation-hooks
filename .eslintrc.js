module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    sourceType: "module",
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "prettier",
    "prettier/@typescript-eslint",
  ],
  plugins: ["jest", "@typescript-eslint"],
  env: {
    jest: true,
    node: true,
    es6: true,
  },
  globals: {
    PACKAGE_VERSION: false,
  },
  rules: {
    "comma-dangle": [
      2,
      {
        arrays: "always-multiline",
        objects: "always-multiline",
        imports: "always-multiline",
        exports: "always-multiline",
        functions: "never",
      },
    ],
    "no-confusing-arrow": 0,
    "no-else-return": 0,
    "no-underscore-dangle": 0,
    "@typescript-eslint/no-unused-vars": [
      2,
      {
        argsIgnorePattern: "^_",
      },
    ],
    "no-restricted-syntax": 0,
    "no-await-in-loop": 0,
    camelcase: 0,
    "jest/no-focused-tests": 2,
    "jest/no-identical-title": 2,

    // TODO: re-enable this
    "@typescript-eslint/explicit-function-return-type": 0,
    "@typescript-eslint/no-explicit-any": "off",
  },
  overrides: [
    {
      files: ["**/__tests__/**/*.ts"],
      rules: {
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ],
};
