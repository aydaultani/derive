import type { Metadata } from "next";
import { CollectionApp } from "@/components/collection";

export const metadata: Metadata = {
  title: "DERIVE — Collection",
  description: "Every card ever dealt. Lit is completed, greyed is still locked.",
};

/** The most-screenshotted screen — every place ever dealt, lit and tinted
 * by MTA line when completed, greyed at low opacity otherwise. Identity is
 * client-side only (no accounts), so the actual data fetch lives in the
 * client component below. */
export default function CollectionPage() {
  return <CollectionApp />;
}
