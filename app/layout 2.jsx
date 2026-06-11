export const metadata = {
  title: 'CashHeap',
  icons: { icon: '/icon.png' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#f9f9f9' }}>
        {children}
      </body>
    </html>
  );
}
