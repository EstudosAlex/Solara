import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solara OS",
};

export default function LayoutRaiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
