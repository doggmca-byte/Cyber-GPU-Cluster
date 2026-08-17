export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="mx-auto min-h-dvh max-w-3xl px-4 py-6">{children}</div>;
}
