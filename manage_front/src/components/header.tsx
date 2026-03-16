"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { clearTokens } from "@/lib/auth";
import { LogOut } from "lucide-react";

export function Header() {
  const router = useRouter();

  function handleLogout() {
    clearTokens();
    router.push("/login");
  }

  return (
    <header className="h-14 border-b bg-white flex items-center justify-end px-6">
      <Button variant="ghost" size="sm" onClick={handleLogout}>
        <LogOut className="h-4 w-4 mr-2" />
        退出登录
      </Button>
    </header>
  );
}
