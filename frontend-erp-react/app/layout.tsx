import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { COLLEGE_NAME, COLLEGE_SHORT_NAME } from "@/lib/branding";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${COLLEGE_NAME} — ERP`,
    template: `%s · ${COLLEGE_SHORT_NAME} ERP`,
  },
  description:
    "Departments, programs, students, teachers, attendance and study materials for " +
    COLLEGE_NAME,
  // The app is behind a login and has nothing to gain from indexing.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
