import type { Metadata } from "next";
import RootShell from "../src/RootShell";

export const metadata: Metadata = {
  title: { default: "Mon site", template: "%s - Mon site" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <RootShell>{children}</RootShell>;
}
