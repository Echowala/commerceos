import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "CommerceOS", description: "AI operating system for modern commerce" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
