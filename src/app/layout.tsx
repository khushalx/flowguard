import type { Metadata } from "next";
import localFont from "next/font/local";
import { FeedbackProvider } from "@/components/feedback";
import "./globals.css";

const instrumentSans = localFont({
  src: "./fonts/instrument-sans.woff2",
  variable: "--font-interface",
  display: "swap",
  weight: "400 700",
});
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-regular.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-medium.woff2", weight: "500" },
  ],
  variable: "--font-technical",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "FlowGuard — Deployment safety, made visible",
    template: "%s · FlowGuard",
  },
  description:
    "Protect critical user journeys with browser tests, deployment checks, and clear failure reports. Explore the FlowGuard frontend demo.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${instrumentSans.variable} ${plexMono.variable} dark antialiased`}
    >
      <body>
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}
