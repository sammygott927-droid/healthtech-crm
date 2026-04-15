import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import RevealProvider from "@/components/RevealProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HealthTech CRM",
  description: "Networking CRM with AI News Intelligence",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-gray-100">
        <RevealProvider>
          <Sidebar />
          <main className="ml-56 min-h-screen">{children}</main>
        </RevealProvider>
      </body>
    </html>
  );
}
