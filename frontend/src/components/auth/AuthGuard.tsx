"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";

// Token lives in localStorage (see lib/auth.ts), which server-side
// middleware can't read — so route protection happens here, client-side, on
// mount. Renders nothing until the check completes, to avoid a flash of
// protected content before the redirect fires.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      setAuthed(true);
    } else {
      router.replace("/login");
    }
  }, [router]);

  if (!authed) return null;
  return <>{children}</>;
}
