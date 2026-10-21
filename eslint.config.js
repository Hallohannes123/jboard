import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/distbuildnode_modules*.tsbuildinfo", "**/test-resultsplaywright-report*.mjs"],
    languageOptions: {
      globals: { process: "readonly", URL: "readonly", console: "readonly" },
    },
  },
  {
    files: ["bench/browser/harness*.ts"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        location: "readonly",
        performance: "readonly",
        URLSearchParams: "readonly",
      },
    },
  },
  {
    files: ["bench/browser*.spec.ts"],
    languageOptions: {
      globals: { console: "readonly", window: "readonly" },
    },
  },
);
