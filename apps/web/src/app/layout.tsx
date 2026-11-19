import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "새가나안교회 만나",
  description: "나의 하루를 여는 새벽예배 음성 보관함",
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
