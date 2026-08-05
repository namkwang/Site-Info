"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { BreakdownTabs } from "./breakdown-tabs";
import { CorpDivisionChart } from "./corp-division-chart";
import { KoreaMapChart } from "./korea-map-chart";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { SiteDetail } from "@/components/dashboard/site-detail";
import { SiteMap, type ColorCategory } from "@/components/dashboard/site-map";
import { SiteFormDialog } from "@/components/dashboard/site-form-dialog";
import { DemoNoticeDialog } from "@/components/layout/demo-notice";
import { Plus, Info, Building2, Banknote, PieChart, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { charts } from "@/lib/chart-colors";
import type { SiteFilter, FilterOptions } from "@/lib/api/sites";
import type { SiteDashboard } from "@/types/database";
import { fetchSites } from "@/lib/api/sites";
import { fetchStatisticsSummary, type StatisticsSummary } from "@/lib/api/statistics";
import { exportSitesToExcel } from "@/lib/excel-export";
import { DashboardScaler } from "./_internal/DashboardScaler";
import { HeroKpi } from "./_internal/HeroKpi";
import { SiteListWithDetail } from "./_internal/SiteListWithDetail";

// Match the BASE_W in DashboardScaler — used for sticky header width calculations.
const BASE_W = 1560;

/* ── Types ──────────────────────────────────────────────── */

interface StatisticsClientProps {
  summary: StatisticsSummary;
  filterOptions: FilterOptions;
  initialSites?: SiteDashboard[];
}

/* ── Main Component ─────────────────────────────────────── */

function setToParam(s: Set<string>): string {
  return Array.from(s).join(",");
}

export function StatisticsClient({ summary: initialSummary, filterOptions, initialSites = [] }: StatisticsClientProps) {
  const [summary, setSummary] = useState(initialSummary);
  const [sites, setSites] = useState<SiteDashboard[]>(initialSites);
  const [selectedSite, setSelectedSite] = useState<SiteDashboard | null>(null);
  // Animation state for SiteDetail panel (mirrors dashboard-client.tsx map tab)
  const [displayedSite, setDisplayedSite] = useState<SiteDashboard | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const closingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const siteListRef = useRef<HTMLDivElement>(null);
  const handleSelectSite = useCallback((site: SiteDashboard) => {
    clearTimeout(closingTimer.current);
    setSelectedSite(site);
    setDisplayedSite(site);
    // One rAF so `displayedSite` mounts (with cardVisible=false → maxWidth:0)
    // before `panelOpen` flips, otherwise the slide-in animation has nothing
    // to animate from. Two frames was overkill (~32ms of perceived lag).
    requestAnimationFrame(() => {
      setPanelOpen(true);
    });
    // Center the clicked row in the viewport. Earlier code scrolled the list
    // section as a whole with block:"start", which snapped the LIST top to
    // the viewport top and left the actually-clicked row far below the fold
    // for any click past the first few rows. Targeting the row itself makes
    // the click feel "stay where I am" instead of "yank back to list top".
    const rowEl = document.querySelector<HTMLDivElement>(
      `[data-site-row="${site.id}"]`,
    );
    rowEl?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleCloseSite = useCallback(() => {
    setPanelOpen(false);
    closingTimer.current = setTimeout(() => {
      setSelectedSite(null);
      setDisplayedSite(null);
    }, 500);
  }, []);

  // sites 배열이 갱신되면 (저장 후 refetch 등) 표시 중인 site도 같은 id의 새 데이터로 교체
  useEffect(() => {
    if (!displayedSite) return;
    const fresh = sites.find((s) => s.id === displayedSite.id);
    if (fresh && fresh !== displayedSite) {
      setDisplayedSite(fresh);
      if (selectedSite && selectedSite.id === fresh.id) setSelectedSite(fresh);
    }
  }, [sites]); // eslint-disable-line react-hooks/exhaustive-deps

  const [filters, setFilters] = useState<SiteFilter>({});
  const [amountRanges, setAmountRanges] = useState<Set<string>>(new Set());
  const [progressRanges, setProgressRanges] = useState<Set<string>>(new Set());
  // 자사 도급액 별 필터 — FilterBar에는 노출하지 않고, AmountHeatmapChart의
  // 자사도급액 시리즈 클릭으로만 토글된다.
  const [shareRanges, setShareRanges] = useState<Set<string>>(new Set());
  const [selectedStartYear, setSelectedStartYear] = useState<string | null>(null);
  const [selectedEndYear, setSelectedEndYear] = useState<string | null>(null);
  const [pageScale, setPageScale] = useState(1);
  const [stickyContentH, setStickyContentH] = useState(88);
  const stickyContentRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [showDetailMap, setShowDetailMap] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const { isAdmin } = useAuth();

  // Header has a "현장 관리" link that lands on /statistics?addSite=1 — when
  // that lands here for an admin, auto-open the site form and clean the URL
  // so a later refresh doesn't re-open the dialog.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("addSite") === "1" && isAdmin) {
      setAddOpen(true);
      router.replace("/statistics");
    }
  }, [searchParams, isAdmin, router]);
  const [mapColorCategory, setMapColorCategory] = useState<ColorCategory>("corporation");
  const detailMapRef = useRef<HTMLDivElement>(null);

  const handleShowDetailMap = useCallback(() => {
    setShowDetailMap(true);
  }, []);

  // Lock page scroll while the DETAIL MAP view is active — only the detail card
  // scrolls internally; the map itself fills the viewport. Reset scroll to 0 so
  // both the page header (top-0) and the sticky KPI header (top-14) stay visible.
  useEffect(() => {
    if (!showDetailMap) return;
    window.scrollTo(0, 0);
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, [showDetailMap]);

  // Keep `--dashboard-zoom` fresh while the detail map is active. DashboardScaler
  // is unmounted in this mode, so its resize listener that normally maintains the
  // CSS var doesn't run — meaning the floating detail card (which scales itself
  // by var(--dashboard-zoom) to match the dashboard's card size) would use a
  // stale value after a window resize. Same formula as DashboardScaler.
  useEffect(() => {
    if (!showDetailMap) return;
    const update = () => {
      const s = Math.max(window.innerWidth / BASE_W, 0.5);
      document.documentElement.style.setProperty("--dashboard-zoom", String(s));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [showDetailMap]);

  // Sticky header sizing: track the inner content's actual height + the page's
  // zoom factor so the outer sticky div can clamp to the right scaled height.
  // Effect runs once on mount; resize/RO callbacks update state directly. We
  // rAF-throttle window resize so a drag-resize doesn't fire setState 30+
  // times per second across the dashboard subtree. The previous version put
  // stickyContentH in the deps array, which forced the RO to disconnect/
  // re-observe on every height change — wasteful churn during font load
  // and filter-driven layout shifts.
  useEffect(() => {
    let rafId: number | null = null;
    function update() {
      const nextScale = Math.max(window.innerWidth / BASE_W, 0.5);
      setPageScale(nextScale);
      let nextStickyH = 0;
      if (stickyContentRef.current) {
        nextStickyH = stickyContentRef.current.offsetHeight;
        setStickyContentH(nextStickyH);
      }
      const headerBottom = 44 + nextStickyH * nextScale;
      document.documentElement.style.setProperty("--sticky-header-bottom", `${headerBottom}px`);
    }
    function scheduleUpdate() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        update();
      });
    }
    update();
    window.addEventListener("resize", scheduleUpdate);

    let ro: ResizeObserver | undefined;
    if (stickyContentRef.current && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(scheduleUpdate);
      ro.observe(stickyContentRef.current);
    }

    return () => {
      window.removeEventListener("resize", scheduleUpdate);
      ro?.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // H7 — clear close-animation timer on unmount so we don't try to update
  // state after the component is gone (React 18 ignores it but the ref
  // is on the GC root via the closure until the effect cleans up).
  useEffect(() => {
    return () => {
      clearTimeout(closingTimer.current);
      clearTimeout(searchTimer.current);
    };
  }, []);

  const buildParams = useCallback((f: SiteFilter, aRanges: Set<string>, pRanges: Set<string>, sRanges: Set<string>, sYear?: string | null, eYear?: string | null) => {
    const params = new URLSearchParams();
    if (f.corporation && f.corporation !== "all") params.set("corporation", f.corporation);
    if (f.division && f.division !== "all") params.set("division", f.division);
    if (f.region && f.region !== "all") params.set("region", f.region);
    if (f.facilityType && f.facilityType !== "all") params.set("facilityType", f.facilityType);
    if (f.orderType && f.orderType !== "all") params.set("orderType", f.orderType);
    if (f.status && f.status !== "all") params.set("status", f.status);
    if (f.managingEntity && f.managingEntity !== "all") params.set("managingEntity", f.managingEntity);
    if (f.search) params.set("search", f.search);
    if (aRanges.size > 0) params.set("amountRanges", setToParam(aRanges));
    if (pRanges.size > 0) params.set("progressRanges", setToParam(pRanges));
    if (sRanges.size > 0) params.set("groupShareRanges", setToParam(sRanges));
    if (sYear) params.set("startYear", sYear);
    if (eYear) params.set("endYear", eYear);
    return params;
  }, []);

  const [isFetching, setIsFetching] = useState(false);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const fetchSummary = useCallback(async (f: SiteFilter, aRanges: Set<string>, pRanges: Set<string>, sRanges: Set<string>, sYear?: string | null, eYear?: string | null) => {
    fetchAbortRef.current?.abort();
    const ctrl = new AbortController();
    fetchAbortRef.current = ctrl;

    const params = buildParams(f, aRanges, pRanges, sRanges, sYear, eYear);
    const filterDict = Object.fromEntries(params.entries());
    setIsFetching(true);
    try {
      const [summaryData, sitesData] = await Promise.all([
        fetchStatisticsSummary(params.toString(), { signal: ctrl.signal }),
        fetchSites(filterDict, { signal: ctrl.signal }),
      ]);
      if (ctrl.signal.aborted) return;
      if (summaryData) {
        setSummary({ ...initialSummary, ...summaryData });
      }
      if (sitesData) {
        setSites(sitesData);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      // Only the latest fetch should clear the loading flag — earlier ones
      // were superseded and their finally would otherwise flicker the UI.
      if (fetchAbortRef.current === ctrl) {
        setIsFetching(false);
        fetchAbortRef.current = null;
      }
    }
  }, [initialSummary, buildParams]);

  // Latest-state ref so click handlers can stay referentially stable. Earlier
  // each handler had `filters`, `amountRanges`, etc. in its useCallback deps,
  // which meant *every* handler recreated on *any* filter change. Charts that
  // received those handlers as props couldn't be memoized — the whole chart
  // subtree re-rendered on every cross-filter click. Reading from a ref lets
  // us keep handler identity stable while still seeing the freshest state.
  const stateRef = useRef({ filters, amountRanges, progressRanges, shareRanges, selectedStartYear, selectedEndYear });
  stateRef.current = { filters, amountRanges, progressRanges, shareRanges, selectedStartYear, selectedEndYear };

  const handleFilterChange = useCallback((key: keyof SiteFilter, value: string) => {
    const s = stateRef.current;
    const next = { ...s.filters, [key]: value };
    setFilters(next);
    if (key === "search") {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => fetchSummary(next, s.amountRanges, s.progressRanges, s.shareRanges, s.selectedStartYear, s.selectedEndYear), 300);
    } else {
      fetchSummary(next, s.amountRanges, s.progressRanges, s.shareRanges, s.selectedStartYear, s.selectedEndYear);
    }
  }, [fetchSummary]);

  const handleAmountChange = useCallback((v: Set<string>) => {
    setAmountRanges(v);
    const s = stateRef.current;
    fetchSummary(s.filters, v, s.progressRanges, s.shareRanges, s.selectedStartYear, s.selectedEndYear);
  }, [fetchSummary]);

  const handleProgressChange = useCallback((v: Set<string>) => {
    setProgressRanges(v);
    const s = stateRef.current;
    fetchSummary(s.filters, s.amountRanges, v, s.shareRanges, s.selectedStartYear, s.selectedEndYear);
  }, [fetchSummary]);

  const handleRefreshAfterSave = useCallback(() => {
    const s = stateRef.current;
    fetchSummary(s.filters, s.amountRanges, s.progressRanges, s.shareRanges, s.selectedStartYear, s.selectedEndYear);
  }, [fetchSummary]);

  const handleExport = useCallback(() => {
    const f = stateRef.current.filters;
    const corps = f.corporation && f.corporation !== "all"
      ? f.corporation.split(",").filter(Boolean)
      : [];
    const regions = f.region && f.region !== "all"
      ? f.region.split(",").filter(Boolean)
      : [];
    void exportSitesToExcel(sites, {
      filterSummary: { corporations: corps, regions },
    });
  }, [sites]);

  const handleResetFilters = useCallback(() => {
    const empty: SiteFilter = {};
    const emptyAmount = new Set<string>();
    const emptyProgress = new Set<string>();
    const emptyShare = new Set<string>();
    setFilters(empty);
    setAmountRanges(emptyAmount);
    setProgressRanges(emptyProgress);
    setShareRanges(emptyShare);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSelectedStartYear(null);
    setSelectedEndYear(null);
    fetchSummary(empty, emptyAmount, emptyProgress, emptyShare, null, null);
  }, [fetchSummary]);

  /* ── Cross-filter handlers (Power BI style) ──
     Clicking a chart element toggles the corresponding filter. Clicking the
     same element again clears it. The shared `handleFilterChange` already
     re-fetches summary + sites, so all charts and the site list update. */
  const handleCrossFilter = useCallback((key: keyof SiteFilter, value: string | null) => {
    const current = stateRef.current.filters[key];
    const next = value == null || current === value ? "all" : value;
    handleFilterChange(key, next);
  }, [handleFilterChange]);

  const handleRegionCrossFilter = useCallback((region: string | null) => {
    handleCrossFilter("region", region);
  }, [handleCrossFilter]);
  const handleCorpCrossFilter = useCallback((corp: string | null) => {
    handleCrossFilter("corporation", corp);
  }, [handleCrossFilter]);
  const handleStatusCrossFilter = useCallback((status: string | null) => {
    handleCrossFilter("status", status);
  }, [handleCrossFilter]);

  const handleAmountRangeCrossFilter = useCallback((rangeKey: string | null) => {
    const s = stateRef.current;
    if (rangeKey == null) {
      const empty = new Set<string>();
      setAmountRanges(empty);
      fetchSummary(s.filters, empty, s.progressRanges, s.shareRanges, s.selectedStartYear, s.selectedEndYear);
      return;
    }
    // Toggle: if already the only selected one, clear; otherwise select just it.
    const isOnlySelected = s.amountRanges.size === 1 && s.amountRanges.has(rangeKey);
    const next = new Set<string>(isOnlySelected ? [] : [rangeKey]);
    setAmountRanges(next);
    fetchSummary(s.filters, next, s.progressRanges, s.shareRanges, s.selectedStartYear, s.selectedEndYear);
  }, [fetchSummary]);

  // 자사 도급액 별 — 백엔드 필터(`groupShareRanges`)에는 적용되지만 FilterBar에는 안 보임
  const handleShareRangeCrossFilter = useCallback((rangeKey: string | null) => {
    const s = stateRef.current;
    if (rangeKey == null) {
      const empty = new Set<string>();
      setShareRanges(empty);
      fetchSummary(s.filters, s.amountRanges, s.progressRanges, empty, s.selectedStartYear, s.selectedEndYear);
      return;
    }
    const isOnlySelected = s.shareRanges.size === 1 && s.shareRanges.has(rangeKey);
    const next = new Set<string>(isOnlySelected ? [] : [rangeKey]);
    setShareRanges(next);
    fetchSummary(s.filters, s.amountRanges, s.progressRanges, next, s.selectedStartYear, s.selectedEndYear);
  }, [fetchSummary]);

  const handleStartYearClick = useCallback((year: string | null) => {
    setSelectedStartYear(year);
    setSelectedEndYear(null);
    const s = stateRef.current;
    fetchSummary(s.filters, s.amountRanges, s.progressRanges, s.shareRanges, year, null);
  }, [fetchSummary]);

  const handleEndYearClick = useCallback((year: string | null) => {
    setSelectedEndYear(year);
    setSelectedStartYear(null);
    const s = stateRef.current;
    fetchSummary(s.filters, s.amountRanges, s.progressRanges, s.shareRanges, null, year);
  }, [fetchSummary]);

  // Single-value selection state derived from current filter strings.
  // (Filter strings can be comma-separated; we treat exactly one value as "selected".)
  const selectedRegion = filters.region && filters.region !== "all" && !filters.region.includes(",") ? filters.region : null;
  const selectedCorp = filters.corporation && filters.corporation !== "all" && !filters.corporation.includes(",") ? filters.corporation : null;
  const selectedStatus = filters.status && filters.status !== "all" && !filters.status.includes(",") ? filters.status : null;
  const selectedAmountRange = amountRanges.size === 1 ? Array.from(amountRanges)[0] : null;
  const selectedShareRange = shareRanges.size === 1 ? Array.from(shareRanges)[0] : null;

  const progress = summary.progress;
  const headcount = summary.headcount;
  const budget = summary.budget;

  const byCorp = summary.by_corporation ?? [];
  const corpSites = byCorp.map((d) => ({ name: d.corporation, value: d.count }));
  const corpContract = byCorp.map((d) => ({ name: d.corporation, value: d.total_contract }));
  const corpHeadcount = byCorp.map((d) => ({ name: d.corporation, value: d.total_headcount }));

  return (
    <>
      <DemoNoticeDialog />
      {/* Sticky Header: Filter + KPIs - 페이지 헤더 바로 아래 고정 */}
      <div className="sticky top-11 z-30 bg-background border-b border-border -mx-4 sm:-mx-6 overflow-hidden" style={{ height: `${stickyContentH * pageScale}px` }}>
        <div
          ref={stickyContentRef}
          style={{
            width: BASE_W,
            transform: `scale(${pageScale})`,
            transformOrigin: "top left",
          }}
          className="px-6 flex flex-col gap-1 py-2"
        >
          <FilterBar
            filterOptions={filterOptions}
            filters={filters}
            onFilterChange={handleFilterChange}
            amountRanges={amountRanges}
            progressRanges={progressRanges}
            onAmountRangesChange={handleAmountChange}
            onProgressRangesChange={handleProgressChange}
            onReset={handleResetFilters}
            onExport={handleExport}
          />
          <div className="grid grid-cols-4 gap-2">
            <HeroKpi icon={Building2} label="총 현장"    value={summary.total_sites ?? 0} unit="개" />
            <HeroKpi icon={Banknote}  label="총 공사비"  value={Math.round(budget.total_contract ?? 0)} unit="억" />
            <HeroKpi icon={PieChart}  label="자사 도급액" value={Math.round(budget.total_our_share ?? 0)} unit="억" />
            <HeroKpi icon={Users}     label="총 인원"    value={headcount.total ?? 0} unit="명" />
          </div>
        </div>
      </div>
      <SiteFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={handleRefreshAfterSave}
      />

    {!showDetailMap ? (
    <DashboardScaler>
      {/* ── Charts area ── */}
      <div className={cn("flex-1 min-h-0 transition-opacity duration-300", isFetching ? "opacity-60" : "opacity-100")}>
        <BreakdownTabs
          by_corporation={summary.by_corporation ?? []}
          by_division_detail={summary.by_division_detail ?? []}
          by_region_group={summary.by_region_group ?? []}
          by_status={summary.by_status ?? []}
          by_amount_range={summary.by_amount_range ?? []}
          by_region={summary.by_region ?? []}
          pre_start_by_completion_year={summary.pre_start_by_completion_year ?? []}
          active_by_completion_year={summary.active_by_completion_year ?? []}
          amount_heatmap={summary.amount_heatmap ?? { by_contract: [], by_our_share: [], by_contract_division: [], by_our_share_division: [], labels: [], no_contract_count: 0, no_share_count: 0 }}
          corpDivisionData={summary.by_corporation_division ?? []}
          onShowDetailMap={handleShowDetailMap}
          selectedRegion={selectedRegion}
          selectedCorp={selectedCorp}
          selectedStatus={selectedStatus}
          selectedAmountRange={selectedAmountRange}
          selectedShareRange={selectedShareRange}
          onRegionClick={handleRegionCrossFilter}
          onCorpClick={handleCorpCrossFilter}
          onStatusClick={handleStatusCrossFilter}
          onAmountRangeClick={handleAmountRangeCrossFilter}
          onShareRangeClick={handleShareRangeCrossFilter}
          selectedStartYear={selectedStartYear}
          selectedEndYear={selectedEndYear}
          onStartYearClick={handleStartYearClick}
          onEndYearClick={handleEndYearClick}
        />
      </div>

      {/* ── Site List area ── */}
      {/* Add-site action moved to the header ("현장 관리") — admins
       *  reach the form via that link, not a floating button on the list. */}
      <div ref={siteListRef} className={cn("transition-opacity duration-300", isFetching ? "opacity-60" : "opacity-100")}>
        <SiteListWithDetail
          isAdmin={isAdmin}
          sites={sites}
          selectedSite={selectedSite}
          displayedSite={displayedSite}
          panelOpen={panelOpen}
          onSelectSite={handleSelectSite}
          onCloseSite={handleCloseSite}
          onSavedSite={handleRefreshAfterSave}
        />
      </div>
    </DashboardScaler>
    ) : (
      /* ── Detail map renders OUTSIDE DashboardScaler. CSS `zoom` on the
       *  parent breaks maplibregl's hit-test (mousePos uses
       *  getBoundingClientRect/clientWidth which don't agree under `zoom`),
       *  killing hover/click on markers. Native scale = working interaction. */
      <div ref={detailMapRef} className="-mx-4 sm:-mx-6 px-6 pt-1.5 overflow-hidden">
        {/* Map + animated detail card side-by-side — fills viewport, no page scroll */}
        <div
          className="flex gap-3"
          style={{
            height:
              "calc(100vh - var(--sticky-header-bottom, 200px) - 50px)",
          }}
        >
            <div className="relative flex-1 min-w-0">
              {/* Map fills the box. Must NOT be wrapped in CSS zoom — maplibregl's
                  hit-test reads getBoundingClientRect / clientWidth which disagree
                  under zoom, breaking hover/click on markers. */}
              <div className="absolute inset-0 [&>div]:h-full [&>div>div]:!h-full [&>div>div]:!min-h-0">
                <SiteMap
                  sites={sites}
                  selectedSiteId={selectedSite?.id ?? null}
                  onSelect={handleSelectSite}
                  colorCategory={mapColorCategory}
                />
              </div>
              {/* Overlay UI (return button, info banner, color selector, legend)
                  is zoomed to match DashboardScaler — otherwise these chrome
                  elements render at native size while the dashboard's identical
                  buttons (e.g. "상세 지도 보기" on KoreaMap) render at zoom-scaled
                  size, making them visibly inconsistent. Map stays unzoomed. */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ zoom: "var(--dashboard-zoom, 1)" }}
              >
                <button
                  type="button"
                  onClick={() => setShowDetailMap(false)}
                  className="pointer-events-auto absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors duration-150"
                >
                  ← 대시보드로 돌아가기
                </button>
                <div className="pointer-events-auto absolute top-3 right-16 z-20 bg-card/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-sm border border-border/50 text-[11px] text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5" />
                  주소가 입력되지 않은 현장은 지도에 표시되지 않습니다
                </div>
                <div className="pointer-events-auto absolute top-12 left-3 z-10 flex flex-col gap-1.5">
                  <div className="flex bg-card/90 backdrop-blur-sm rounded-lg p-0.5 shadow-sm border border-border/50">
                    {([
                      { key: "corporation" as ColorCategory, label: "법인별" },
                      { key: "division" as ColorCategory, label: "부문별" },
                      { key: "status" as ColorCategory, label: "상태별" },
                    ]).map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setMapColorCategory(c.key)}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                          mapColorCategory === c.key
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-0.5 bg-card/90 backdrop-blur-sm rounded-lg px-2.5 py-1.5 shadow-sm border border-border/50">
                    {(mapColorCategory === "corporation"
                      ? charts.siteMap.corporation
                      : mapColorCategory === "division"
                      ? charts.siteMap.division
                      : charts.siteMap.status
                    ).map((item) => (
                      <div key={item.label} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-[10px] text-foreground font-medium">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {displayedSite && (
              <div
                className="shrink-0 hidden lg:block h-full overflow-hidden transition-[max-width,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] self-start"
                style={{
                  /* 카드 화면상 폭 = 500 × dashboard-zoom — 대시보드의 floating
                     detail card(SiteListWithDetail)와 정확히 같은 크기로 맞춘다.
                     이 페이지는 DashboardScaler 밖이라 zoom이 자동 적용되지 않으므로
                     수동으로 같은 공식을 사용. */
                  maxWidth: panelOpen ? "calc(500px * var(--dashboard-zoom, 1))" : 0,
                  opacity: panelOpen ? 1 : 0,
                }}
              >
                <div
                  className="w-[500px] overflow-y-auto overscroll-contain"
                  style={{
                    zoom: "var(--dashboard-zoom, 1)",
                    /* zoom 적용 전 CSS 높이 = 화면상 목표 높이 / zoom — 그래야 zoom으로
                       축소된 후 outer flex container(높이 = 100vh - sticky - 50)를
                       정확히 채운다. SiteListWithDetail과 동일한 공식. */
                    height:
                      "calc((100vh - var(--sticky-header-bottom, 200px) - 50px) / var(--dashboard-zoom, 1))",
                  }}
                >
                  <SiteDetail site={displayedSite} onClose={handleCloseSite} onSaved={handleRefreshAfterSave} />
                </div>
              </div>
            )}
        </div>
      </div>
    )}
    </>
  );
}
