import type { Metadata } from "next";
import { Providers } from "../src";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Mon service" };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
