import type { ReactNode } from 'react';

// No manual <head>: hand-written head tags in an App Router layout have
// previously stopped Next's client runtime dead (docs/scratch/LESSONS.md).
// Everything that would go there goes through `metadata`.
export const metadata = {
  title: 'ASKK',
  description: 'A personal agent harness that runs entirely in the browser.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
