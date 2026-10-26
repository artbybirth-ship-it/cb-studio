import { redirect } from "next/navigation";

// Authentication is intentionally disabled for this MVP build.
// Any request to /login immediately enters the studio dashboard.
export default function LoginPage() {
  redirect("/dashboard");
}
