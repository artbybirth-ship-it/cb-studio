import { redirect } from "next/navigation";

// Account creation is intentionally disabled for this MVP build.
// Any request to /signup immediately enters the studio dashboard.
export default function SignupPage() {
  redirect("/dashboard");
}
