import { ProductCatalogScreen } from "@/components/reference-data/product-catalog-screen";

// The catalog in full — every family, every variety, nothing filtered out.
//
// The screen itself lives in components/reference-data because
// /backoffice/picked-products mounts the same table over a narrower row set
// (the varieties growers actually picked on the selected trading day). This
// route is the unfiltered case: it passes no `varietyIds`, which is also what
// turns the "משפחה חדשה" and "זן חדש" controls on — see the component's own
// `allowCreate` note for why creating a record only makes sense here.
export default function ProductsPage() {
  return (
    <ProductCatalogScreen
      title="מוצרים"
      subtitle="הקטלוג לפי משפחות — לחיצה על משפחה פותחת את הזנים שלה. ניתן לערוך משפחה וזן כאחד."
    />
  );
}
