export const metadata = {
  title: "CEFR Conversation POC",
  description: "Évaluation CEFR par conversation avec avatar 3D",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0f0f1e", color: "#fff" }}>
        {children}
      </body>
    </html>
  );
}
