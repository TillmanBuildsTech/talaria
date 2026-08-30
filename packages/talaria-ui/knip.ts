import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/index.ts"],
  ignore: ["src/**/*.gen.ts"],
  project: ["src/**/*.{ts,tsx,js,jsx,css}"],
};

export default config;
