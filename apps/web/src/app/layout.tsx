import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "새가나안교회 만나",
  description: "새가나안교회 새벽예배, 저녁 영성집회, 주일예배 음성 보관함",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
