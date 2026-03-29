import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sway",
  description: "Stay or leave? Let the group decide.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
