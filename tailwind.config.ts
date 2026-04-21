import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        status: {
          pending: "#dc2626",
          confirmed: "#111827",
          muted: "#9ca3af",
        },
      },
    },
  },
  plugins: [],
};

export default config;
