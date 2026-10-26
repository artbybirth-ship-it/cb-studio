import type { Metadata } from "next";
import "./globals.css";
import { CharacterLibraryProvider } from "@/lib/characterLibrary";
import { GOOGLE_FONTS_HREF } from "@/lib/fonts";
import DialogDragManager from "@/components/DialogDragManager";
export const metadata: Metadata = {
  title: { default: "CharacterBazaarStudio — AI 2D Animation Studio", template: "%s | CharacterBazaarStudio" },
  description: "Create editable 2D animated stories with characters, backgrounds, voiceovers and browser-based studio tools.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><head><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" /><link rel="stylesheet" href={GOOGLE_FONTS_HREF} /></head><body><CharacterLibraryProvider>{children}</CharacterLibraryProvider><DialogDragManager /></body></html>; }
