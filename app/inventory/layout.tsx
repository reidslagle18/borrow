import ScanBar from "@/components/ScanBar";

// Wraps the whole Inventory area so the scan dock stays mounted across the
// list and piece detail pages (keeps camera/listener state between navigations).
export default function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <ScanBar />
    </>
  );
}
