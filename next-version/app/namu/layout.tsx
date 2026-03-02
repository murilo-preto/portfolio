import type { Metadata } from "next";
import ClientLayout from "./ClientLayout";

export const metadata: Metadata = {
  title: "Namu - Time Tracking",
  description: "A simple and powerful time tracking app to help you understand how you spend your time.",
};

export default function NamuLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClientLayout>{children}</ClientLayout>;
}
