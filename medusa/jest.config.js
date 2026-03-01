/** @type {import('jest').Config} */
module.exports = {
  transform: {
    "^.+\\.[jt]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true },
          target: "es2021",
        },
      },
    ],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "json"],
  testMatch: ["**/src/__tests__/**/*.spec.ts"],
  modulePathIgnorePatterns: ["\\.medusa/", "dist/"],
}
