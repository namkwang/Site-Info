"use client";

import { TrendingUp, Shield, Users, Wallet } from "lucide-react";
import type { StatisticsSummary } from "@/lib/api/statistics";

type KpiType = "progress" | "safety" | "headcount" | "budget";

/** Each kpi card consumes one slice of StatisticsSummary. Keying the data
 *  type off the discriminated `type` lets each sub-content function stay
 *  typed without an intermediate `any` cast. */
type KpiData<T extends KpiType> = StatisticsSummary[T];

interface KpiCardProps {
  type: KpiType;
  data: KpiData<KpiType>;
}

const CONFIG = {
  progress: {
    title: "공정률",
    icon: TrendingUp,
    accent: "#2563EB",
    accentSoft: "rgba(37,99,235,0.08)",
  },
  safety: {
    title: "안전 등급",
    icon: Shield,
    accent: "#10B981",
    accentSoft: "rgba(16,185,129,0.08)",
  },
  headcount: {
    title: "현장 인원",
    icon: Users,
    accent: "#0EA5E9",
    accentSoft: "rgba(14,165,233,0.08)",
  },
  budget: {
    title: "예산 현황",
    icon: Wallet,
    accent: "#F59E0B",
    accentSoft: "rgba(245,158,11,0.08)",
  },
};

function ProgressContent({ data }: { data: KpiData<"progress"> }) {
  const pct = ((data.average ?? 0) * 100).toFixed(1);
  return (
    <>
      <p className="text-3xl font-semibold tracking-tight text-slate-900">{pct}<span className="text-xl font-medium text-slate-500 ml-0.5">%</span></p>
      <div className="flex gap-3 text-[11px] text-slate-600 mt-1.5">
        <span>정상 <span className="text-slate-900 font-medium">{data.on_track ?? 0}</span>개</span>
        <span>지연 <span className="text-slate-900 font-medium">{data.delayed ?? 0}</span>개</span>
      </div>
      <p className="text-[11px] text-slate-500 mt-0.5">활성 현장 {data.total ?? 0}개</p>
    </>
  );
}

function SafetyContent({ data, accent, accentSoft }: { data: KpiData<"safety">; accent: string; accentSoft: string }) {
  const grades = [
    { label: "A", count: data.grade_a ?? 0 },
    { label: "B", count: data.grade_b ?? 0 },
    { label: "C", count: data.grade_c ?? 0 },
    { label: "D", count: data.grade_d ?? 0 },
  ];
  const total = grades.reduce((s, g) => s + g.count, 0);
  return (
    <>
      <p className="text-3xl font-semibold tracking-tight text-slate-900">{total}<span className="text-xl font-medium text-slate-500 ml-0.5">개</span></p>
      <div className="flex gap-1.5 mt-1.5">
        {grades.map((g) => (
          <div
            key={g.label}
            className="px-2 py-0.5 rounded-md text-[11px] font-semibold"
            style={{ backgroundColor: accentSoft, color: accent }}
          >
            {g.label} {g.count}
          </div>
        ))}
      </div>
    </>
  );
}

function HeadcountContent({ data }: { data: KpiData<"headcount"> }) {
  const byDiv = data.by_division ?? {};
  return (
    <>
      <p className="text-3xl font-semibold tracking-tight text-slate-900">{(data.total ?? 0).toLocaleString()}<span className="text-xl font-medium text-slate-500 ml-0.5">명</span></p>
      <div className="flex gap-3 text-[11px] text-slate-600 mt-1.5">
        {Object.entries(byDiv).map(([div, count]) => (
          <span key={div}>{div} <span className="text-slate-900 font-medium">{(count as number).toLocaleString()}</span>명</span>
        ))}
      </div>
    </>
  );
}

function BudgetContent({ data }: { data: KpiData<"budget"> }) {
  const total = data.total_contract ?? 0;
  const ourShare = data.total_our_share ?? 0;
  return (
    <>
      <p className="text-3xl font-semibold tracking-tight text-slate-900">{total.toLocaleString()}<span className="text-xl font-medium text-slate-500 ml-0.5">억</span></p>
      <div className="flex gap-3 text-[11px] text-slate-600 mt-1.5">
        <span>자사분 <span className="text-slate-900 font-medium">{ourShare.toLocaleString()}</span>억</span>
      </div>
    </>
  );
}

export function KpiCard({ type, data }: KpiCardProps) {
  const config = CONFIG[type];
  const Icon = config.icon;

  return (
    <div
      className="relative rounded-2xl p-5 bg-card border border-border shadow-(--shadow-hero) overflow-hidden transition-[box-shadow,transform] duration-(--motion) hover:shadow-(--shadow-card-hover) hover:-translate-y-0.5 cursor-default"
    >
      {/* Left accent bar */}
      <div
        className="absolute top-0 left-0 bottom-0 w-1 rounded-l-2xl"
        style={{ background: `linear-gradient(180deg, ${config.accent} 0%, ${config.accent}33 100%)` }}
      />

      {/* Faint corner tint */}
      <div
        className="absolute top-0 right-0 w-32 h-32 pointer-events-none opacity-60"
        style={{ background: `radial-gradient(circle at top right, ${config.accentSoft} 0%, transparent 70%)` }}
      />

      {/* Icon badge */}
      <div
        className="absolute top-4 right-4 h-8 w-8 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: config.accentSoft, color: config.accent }}
      >
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="relative z-10">
        <p className="text-[11px] font-medium text-slate-500 tracking-wide uppercase mb-2">{config.title}</p>
        {/* The `data` prop arrives as a union (one of the four shapes) — we trust
         *  the parent passes the slice that matches `type`. Cast at the boundary
         *  rather than per-field, so each sub-content function gets a precise type. */}
        {type === "progress" && <ProgressContent data={data as KpiData<"progress">} />}
        {type === "safety" && <SafetyContent data={data as KpiData<"safety">} accent={config.accent} accentSoft={config.accentSoft} />}
        {type === "headcount" && <HeadcountContent data={data as KpiData<"headcount">} />}
        {type === "budget" && <BudgetContent data={data as KpiData<"budget">} />}
      </div>
    </div>
  );
}
