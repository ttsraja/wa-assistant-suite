import './globals.css';

export const metadata = {
  title: 'WhatsApp AI Assistant Suite | Control Center',
  description: 'Manage executive WhatsApp AI agent, live logs, context injection and Google Integrations',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
