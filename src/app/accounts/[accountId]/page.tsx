import { AccountHoldingsPage } from "@/components/account-holdings-page";

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ holding?: string }>;
}) {
  const [{ accountId }, { holding }] = await Promise.all([params, searchParams]);
  return <AccountHoldingsPage accountId={accountId} requestedHoldingId={holding} />;
}
