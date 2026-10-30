import PublicLayout from "../components/PublicLayout";
import { LEGAL_DOCS } from "../../../shared/legalTexts.js";

export default function LegalPage() {
  const doc = LEGAL_DOCS.privacy;
  return <PublicLayout title={doc.title} subtitle={doc.subtitle} updatedAt={doc.updatedAt}><div style={{ whiteSpace: "pre-wrap" }}>{doc.content}</div></PublicLayout>;
}
