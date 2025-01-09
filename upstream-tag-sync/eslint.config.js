import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["eslint.config.js"],
  },
  js.configs.recommended,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
