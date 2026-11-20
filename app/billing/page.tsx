import { ProtectedLayout } from '@/components/protected-layout';
import { ExportWorkspace } from '@/components/export-workspace';

export const dynamic = 'force-dynamic';
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period = 'this_month' } = await searchParams;
  const selected = ['this_month', 'last_month', 'last3m', 'this_week', 'last_week'].includes(period) ? period : 'this_month';
  return <ProtectedLayout><ExportWorkspace kind="billing" period={selected} /></ProtectedLayout>;
}
