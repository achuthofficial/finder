import Finder from "@/components/Finder";
import { googleEnabled } from "@/lib/google";

// Read the Google key at request time so enabling it never needs a rebuild.
export const dynamic = "force-dynamic";

export default function Page() {
  return <Finder googleAvailable={googleEnabled()} />;
}
