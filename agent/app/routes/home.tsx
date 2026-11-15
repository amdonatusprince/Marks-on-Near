import HomePage from "@/components/home/HomePage";
import { marksMeta } from "@/marks/lib/site-meta";

export function meta() {
  return marksMeta("Marks");
}

export default function HomeRoute() {
  return <HomePage />;
}
