// Kit-from-PDF wizard server shell — delegates to the client component so
// SSE consumption + form state can live in one place.

import { PageHeader } from '@/components/ui/page-header';

import { NewFromPdfClient } from './new-from-pdf-client';

export const dynamic = 'force-dynamic';

export default function NewFromPdfPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="New brand kit from PDF"
        description="Upload a brand guidelines PDF. Claude proposes a tokens + voice draft you can edit before publishing version 1."
      />
      <NewFromPdfClient />
    </div>
  );
}
