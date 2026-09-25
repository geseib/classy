import type { Metadata } from "next";
import BenchmarkPage from "@/components/BenchmarkPage";
import { DATASETS } from "@/lib/datasets";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: DATASETS.github.metaTitle,
  description: DATASETS.github.metaDescription,
};

export default function Page() {
  return <BenchmarkPage dataset="github" />;
}
