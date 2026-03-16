"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getUsageSummary, getUsageHistory } from "@/lib/api";
import type { UsageSummary, UsageHistory } from "@/types";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from "recharts";

export default function UsagePage() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [history, setHistory] = useState<UsageHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getUsageSummary(), getUsageHistory(30)])
      .then(([s, h]) => { setSummary(s); setHistory(h); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">加载中...</p>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">用量统计</h2>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm text-gray-500">今日 Token 总用量</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">
            {(summary?.total_tokens_today ?? 0).toLocaleString()}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>每日用量趋势 (近30天)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history?.daily ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Line type="monotone" dataKey="total_tokens" stroke="#2563eb" name="Total Tokens" />
                <Line type="monotone" dataKey="input_tokens" stroke="#16a34a" name="Input" />
                <Line type="monotone" dataKey="output_tokens" stroke="#ea580c" name="Output" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>各模型用量</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={history?.by_model ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={12} />
                <YAxis dataKey="model" type="category" fontSize={12} width={200} />
                <Tooltip />
                <Bar dataKey="total_tokens" fill="#2563eb" name="Total Tokens" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
