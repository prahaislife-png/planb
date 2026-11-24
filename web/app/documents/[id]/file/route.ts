import { getStaffUser } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { getEvidence } from '@/lib/storage';

/**
 * Controlled download of an original evidence document. Evidence files are private: they are served
 * only to a signed-in staff member, only when the document row is visible to them through RLS, and
 * always as an attachment so the browser never renders third-party content in this origin.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

function json(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getStaffUser();
  if (!user) return json(403, 'Staff access required.');

  const { id } = await params;
  if (!UUID.test(id)) return json(404, 'Document not found.');

  const [doc] = await asUser(user.id, (sql) => sql`select sha256, storage_path from intel.source_documents where id = ${id}`);
  if (!doc) return json(404, 'Document not found.');

  let data: Buffer;
  try {
    data = await getEvidence(doc.storage_path);
  } catch {
    return json(404, 'The original file for this document is missing from evidence storage.');
  }

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${doc.sha256}.pdf"`,
      'Content-Length': String(data.length),
    },
  });
}
