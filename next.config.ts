import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactCompiler: true,
  // Keep the local integration-test server separate from the user's preview.
  distDir: process.env.FLOWGUARD_TEST_DIST || ".next",
};
export default nextConfig;
