import BenchmarkPage from "@/components/BenchmarkPage";

export const dynamic = "force-static";

/** Movie reviews: the default benchmark. */
export default function Page() {
  return <BenchmarkPage dataset="imdb" />;
}
