"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getUsageSummary } from "@/lib/api";
import type { UsageSummary } from "@/types";
import { Users, Server, Zap } from "lucide-react";

export default function DashboardPage() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUsageSummary()
      .then(setSummary)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-gray-500">加载中...</div>;
  }

  const cards = [
    {
      title: "总用户数",
      value: summary?.total_users ?? 0,
      icon: Users,
    },
    {
      title: "活跃容器",
      value: summary?.active_containers ?? 0,
      icon: Server,
    },
    {
      title: "今日 Token 用量",
      value: (summary?.total_tokens_today ?? 0).toLocaleString(),
      icon: Zap,
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">仪表盘</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                {card.title}
              </CardTitle>
              <card.icon className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
