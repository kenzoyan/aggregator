import { AccountHoldingsPage } from "@/components/account-holdings-page";

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ holding?: string; from?: string | string[] }>;
}) {
  const [{ accountId }, { holding, from }] = await Promise.all([params, searchParams]);
  return <AccountHoldingsPage accountId={accountId} requestedHoldingId={holding} navigationOrigin={from} />;
}
