import Link from "next/link";

/**
 * Public landing page Stripe returns consignors to after (or when refreshing)
 * their payout onboarding. No auth — this is consignor-facing.
 */
export default async function ConnectReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const refreshed = status === "refresh";

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
        <p className="font-serif text-4xl italic font-medium tracking-tight">BORROW</p>
        {refreshed ? (
          <>
            <h1 className="mt-6 font-serif text-3xl font-medium">
              Let&apos;s pick that back up
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink/60">
              Your setup link expired before you finished. No worries — check your
              welcome email for your link, or reply to it and we&apos;ll send a
              fresh one.
            </p>
          </>
        ) : (
          <>
            <p className="mt-6 font-serif text-5xl italic text-sage-deep">✓</p>
            <h1 className="mt-3 font-serif text-3xl font-medium">You&apos;re all set</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink/60">
              Thanks for setting up your payout info. Once one of your pieces
              rents, you&apos;ll earn 60% — paid out on your regular cycle. You can
              close this tab.
            </p>
          </>
        )}
        <p className="mt-6 text-[12px] uppercase tracking-[0.25em] text-ink/40">
          Questions? DM @borrowfayetteville
        </p>
        <Link
          href="https://instagram.com/borrowfayetteville"
          className="mt-4 inline-block text-[13px] text-ink/45 underline underline-offset-2"
        >
          borrowfayetteville
        </Link>
      </div>
    </main>
  );
}
