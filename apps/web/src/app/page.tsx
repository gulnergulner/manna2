import { authenticated } from "@/lib/auth";
import Library from "@/components/library";
import Login from "@/components/login";
export const dynamic = "force-dynamic";
export default async function Home() {
  return (await authenticated()) ? <Library /> : <Login />;
}
