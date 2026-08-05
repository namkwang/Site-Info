"use client";

import { useState, useRef, useEffect } from "react";
import { MapPin, Calendar, Phone, User, Users, X, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { JvChart } from "./jv-chart";
import { SiteImage } from "./site-image";
import { OrgChartDialog } from "./org-chart-dialog";
import { SiteFormDialog } from "./site-form-dialog";
import { useAuth } from "@/lib/auth-context";
import type { SiteDashboard } from "@/types/database";
import { COMPANY_CONFIG, STATUS_CONFIG } from "@/types/database";

interface SiteDetailProps {
  site: SiteDashboard | null;
  onClose?: () => void;
  onSaved?: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-baseline gap-3 py-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-[13px]">{children}</span>
    </div>
  );
}

function ProgressBar({ label, value, color, badge }: { label: string; value: number; color: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground shrink-0 w-9">{label}</span>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden flex-1">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-[13px] font-bold font-mono tabular-nums shrink-0">{value.toFixed(1)}%</span>
      {badge && <span className="shrink-0">{badge}</span>}
    </div>
  );
}

import { cn } from "@/lib/utils";

export function SiteDetail({ site, onClose, onSaved }: SiteDetailProps) {
  const [orgOpen, setOrgOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { isAdmin } = useAuth();

  if (!site) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px] text-muted-foreground">
        <div className="text-center">
          <MapPin className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">현장을 선택하세요</p>
        </div>
      </div>
    );
  }

  const companyConfig = COMPANY_CONFIG[site.corporation_name];
  const statusConfig = STATUS_CONFIG[site.status];
  const progressPct = (site.progress_rate ?? 0) * 100;

  // 도급액 계산 — JV에 포함된 자사 중 주도급사(지분율 1위)를 파란색으로,
  // 그 외 자사 주관사들은 아래에 작은 회색 글씨로 나열
  let ourShareDisplay: React.ReactNode = <span className="text-muted-foreground">-</span>;
  if (site.contract_amount != null && site.jv_summary) {
    const regex = /(남광토건|극동건설|금광기업)\s+([\d.]+)%/g;
    const matches = [...site.jv_summary.matchAll(regex)];
    if (matches.length > 0) {
      const items = matches
        .map((m) => ({
          name: m[1],
          pct: parseFloat(m[2]),
          amount: Math.round(site.contract_amount! * parseFloat(m[2]) / 100),
        }))
        .sort((a, b) => b.pct - a.pct);
      const lead = items[0];
      const others = items.slice(1);
      ourShareDisplay = (
        <div>
          <span className="font-mono font-bold text-primary">
            {lead.name} {lead.amount.toLocaleString()}억{" "}
            <span className="font-normal text-muted-foreground">({Math.round(lead.pct)}%)</span>
          </span>
          {others.length > 0 && (
            <div className="mt-0.5 space-y-0.5">
              {others.map((item) => (
                <p
                  key={item.name}
                  className="text-muted-foreground/80 font-mono leading-tight"
                >
                  {item.name} {item.amount.toLocaleString()}억 ({Math.round(item.pct)}%)
                </p>
              ))}
            </div>
          )}
        </div>
      );
    }
  } else if (site.our_share_amount != null) {
    ourShareDisplay = <span className="font-mono font-bold text-primary">{site.our_share_amount.toLocaleString()}억</span>;
  }

  return (
    <div className="bg-card rounded-xl border border-border/40 shadow-sm w-full">
      {/* Sticky 닫기 버튼 — 카드 스크롤 시에도 항상 우측 상단 고정.
          버튼 자연 높이(=28px: p-1.5 12px + 아이콘 16px)와 -mb-7(-28px)을 정확히 매칭해
          flow 상 net margin이 0 → 다음 sibling(이미지)이 카드 top에 깔끔하게 붙는다.
          (이전 -mb-10은 -40 → -12px만큼 이미지가 카드 boundary 위로 튀어나가
           위쪽이 잘려 보였음) */}
      {onClose && (
        <div className="sticky top-2 z-20 flex justify-end px-2 -mb-7 pointer-events-none">
          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-black/50 backdrop-blur-sm text-white hover:bg-black/70 transition-colors pointer-events-auto"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {/* 조감도 — 카드의 rounded-xl과 맞도록 top corners 둥글게 + overflow-hidden */}
      <div className="relative rounded-t-xl overflow-hidden">
        <SiteImage siteId={site.id} siteName={site.site_name} division={site.division} />
      </div>

      {/* 지도 팝업 */}
      {mapOpen && site.latitude != null && site.longitude != null && (
        <div className="fixed inset-0 z-50" onClick={() => setMapOpen(false)}>
          <div
            className="absolute bg-card rounded-xl border border-border shadow-2xl overflow-hidden"
            style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <div>
                <p className="text-sm font-bold">{site.site_name}</p>
                <p className="text-xs text-muted-foreground">{site.office_address}</p>
              </div>
              <button onClick={() => setMapOpen(false)} className="p-1 rounded-md hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <SiteMapInline lat={site.latitude} lng={site.longitude} name={site.site_name} />
          </div>
        </div>
      )}
      {/* 헤더 — 라운드 코너로 이미지 위에 겹침 */}
      <div className="relative -mt-5 bg-card rounded-t-xl p-4 pb-3">
        <div className="flex items-center gap-1 flex-wrap mb-2">
          {companyConfig && <Badge variant={companyConfig.variant} size="sm">{companyConfig.label}</Badge>}
          <Badge variant="gray" size="sm">{site.division}</Badge>
          <Badge variant="gray" size="sm">{site.facility_type_name}</Badge>
          {statusConfig && <Badge variant={statusConfig.variant} size="sm">{statusConfig.label}</Badge>}
        </div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-foreground leading-snug flex-1 min-w-0">{site.site_name}</h2>
          {isAdmin && (
            <button
              onClick={() => setEditOpen(true)}
              className="shrink-0 p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded transition-colors"
              title="현장 편집"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <SiteFormDialog open={editOpen} onOpenChange={setEditOpen} site={site} onSaved={onSaved} />
        {site.office_address && (
          <button
            onClick={() => site.latitude != null && site.longitude != null && setMapOpen((v) => !v)}
            className="text-[11px] text-muted-foreground flex items-start gap-1 mt-1.5 leading-relaxed hover:text-primary transition-colors cursor-pointer text-left"
          >
            <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
            {site.office_address}
          </button>
        )}
        <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
          <Calendar className="h-3 w-3 shrink-0" />
          {site.start_date ?? "-"} ~ {site.end_date ?? "-"}
          {site.start_date && site.end_date && (() => {
            const start = new Date(site.start_date!);
            const end = new Date(site.end_date!);
            let years = end.getFullYear() - start.getFullYear();
            let months = end.getMonth() - start.getMonth();
            if (months < 0) { years--; months += 12; }
            const parts = [];
            if (years > 0) parts.push(`${years}년`);
            if (months > 0) parts.push(`${months}개월`);
            return <span className="bg-yellow-100 text-yellow-800 px-1 py-0.5 rounded font-medium">({parts.join(" ") || "0개월"})</span>;
          })()}
        </p>
      </div>

      <Separator />

      {/* 공정 프로그레스.
          실행률은 화면에서 감춘다(요청). 원가 정보라 노출 범위를 좁힌 것이고,
          데이터 자체는 남아 있으므로 되살릴 때는 이 블록만 복구하면 된다. */}
      <div className="px-4 py-3">
        <ProgressBar label="공정률" value={progressPct} color="bg-primary" />
      </div>

      <Separator />

      {/* 주요 정보 */}
      <div className="px-4 py-3 flex gap-3">
        <div className="min-w-0" style={{ flex: "1 1 60%" }}>
          <Row label="총공사금액"><span className="font-mono">{site.contract_amount != null ? `${Math.round(site.contract_amount).toLocaleString()}억` : "-"}</span></Row>
          <Row label="자사도급액">{ourShareDisplay}</Row>
          <Row label="발주처"><span className="font-medium">{site.client_name ?? "-"}</span></Row>
          <Row label="지역">{site.region_group} / {site.region_name}</Row>
          <Row label="현장 인원">
            <span className="flex items-center gap-1.5">
              <span className="font-mono">{site.headcount ?? 0}명</span>
              <button
                onClick={() => setOrgOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-white bg-primary hover:bg-primary/90 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
              >
                <Users className="h-2.5 w-2.5" />
                조직도
              </button>
            </span>
          </Row>
          <OrgChartDialog site={site} open={orgOpen} onOpenChange={setOrgOpen} onSaved={onSaved} />
        </div>
        {site.jv_summary && (
          <>
            <div className="border-l border-border" />
            <div className="flex flex-col items-center justify-center" style={{ flex: "1 1 40%" }}>
              <JvChart jvSummary={site.jv_summary} compact />
            </div>
          </>
        )}
      </div>

      <Separator />

      {/* 현장 인력 */}
      <div className="px-4 py-3">
        <Row label="현장소장">
          <div>
            <span className="flex items-center justify-end gap-1 font-medium">
              <User className="h-2.5 w-2.5" />
              {site.site_manager ?? "-"}
              {site.manager_position && <span className="text-muted-foreground font-normal">({site.manager_position})</span>}
            </span>
            {site.manager_phone && (
              <span className="text-[11px] text-muted-foreground flex items-center justify-end gap-1 mt-0.5">
                <Phone className="h-2.5 w-2.5" />{site.manager_phone}
              </span>
            )}
          </div>
        </Row>
        <Row label="PM">
          <span className="flex items-center justify-end gap-1 font-medium">
            <User className="h-2.5 w-2.5" />
            {site.pm_name ?? "-"}
            {site.pm_position && <span className="text-muted-foreground font-normal">({site.pm_position})</span>}
          </span>
        </Row>
      </div>


      {/* 비고/메모 */}
      {(site.latest_memo || site.progress_note) && (
        <>
          <Separator />
          <div className="px-4 py-3 space-y-2">
            {site.progress_note && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5 font-medium">공정 비고</p>
                <p className="text-[13px] leading-relaxed">{site.progress_note}</p>
              </div>
            )}
            {site.latest_memo && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-0.5 font-medium">메모</p>
                <p className="text-[13px] leading-relaxed">{site.latest_memo}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SiteMapInline({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const w = window as typeof window & { kakao?: { maps: { load: (cb: () => void) => void; LatLng: new (lat: number, lng: number) => unknown; Map: new (el: HTMLElement, opts: Record<string, unknown>) => unknown; Marker: new (opts: Record<string, unknown>) => unknown; InfoWindow: new (opts: Record<string, unknown>) => { open: (map: unknown, marker: unknown) => void }; ZoomControl: new () => unknown } } };
    if (!w.kakao?.maps) return;

    w.kakao.maps.load(() => {
      const position = new w.kakao!.maps.LatLng(lat, lng);
      const map = new w.kakao!.maps.Map(containerRef.current!, {
        center: position,
        level: 3,
      });
      const marker = new w.kakao!.maps.Marker({ position });
      (marker as { setMap: (m: unknown) => void }).setMap(map);

      const infoWindow = new w.kakao!.maps.InfoWindow({
        content: `<div style="padding:6px 10px;font-size:12px;font-weight:600;white-space:nowrap;">${name}</div>`,
      });
      infoWindow.open(map, marker);
    });
  }, [lat, lng, name]);

  return (
    <div>
      <div ref={containerRef} className="w-[600px] h-[450px]" />
    </div>
  );
}

