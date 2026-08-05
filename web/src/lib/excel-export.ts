import ExcelJS from "exceljs";
import { STATUS_CONFIG, type SiteDashboard } from "@/types/database";

interface FilterDescriptor {
  corporations?: string[];
  regions?: string[];
}

export interface ExportSitesOptions {
  /** Title row date (defaults to today, formatted YYYY.MM.DD). */
  publishedAt?: Date;
  /** Filters in effect, used only to build a short filename suffix. */
  filterSummary?: FilterDescriptor;
}

interface ColumnSpec {
  header: string;
  width: number;
  format?: string;
  alignment?: "left" | "center" | "right";
  get: (s: SiteDashboard) => string | number | Date | null;
}

const HEADER_FILL = "FFD9E2F3"; // theme:8 / tint 0.8 근사값
const TITLE_DATE_COLOR = "FFFF0000";

const COLUMNS: ColumnSpec[] = [
  { header: "구분", width: 6, alignment: "center", get: (s) => s.corporation_name },
  { header: "부문", width: 6, alignment: "center", get: (s) => s.division },
  { header: "지역", width: 8, alignment: "center", get: (s) => s.region_name },
  { header: "공종", width: 8, alignment: "center", get: (s) => s.category ?? "" },
  { header: "현장명", width: 32, get: (s) => s.site_name },
  { header: "시설유형", width: 14, alignment: "center", get: (s) => s.facility_type_name ?? "" },
  { header: "발주유형", width: 12, alignment: "center", get: (s) => s.order_type ?? "" },
  { header: "발주처", width: 38, get: (s) => s.client_name ?? "" },
  { header: "공동도급(지분율)", width: 60, get: (s) => s.jv_summary ?? "" },
  { header: "도급액(억원)", width: 14, alignment: "right", format: "#,##0_);[Red](#,##0)", get: (s) => s.contract_amount },
  { header: "자사도급액(억원)", width: 14, alignment: "right", format: "#,##0_);[Red](#,##0)", get: (s) => s.our_share_amount },
  { header: "현장규모", width: 12, get: () => "" },
  { header: "착공일", width: 11, alignment: "center", format: "yy/mm/dd", get: (s) => parseDate(s.start_date) },
  { header: "준공일", width: 11, alignment: "center", format: "yy/mm/dd", get: (s) => parseDate(s.end_date) },
  { header: "공정률", width: 9, alignment: "right", format: "0.0%", get: (s) => s.progress_rate },
  { header: "상태", width: 8, alignment: "center", get: (s) => STATUS_CONFIG[s.status]?.label ?? s.status },
  { header: "현장 사무실 주소", width: 50, get: (s) => s.office_address ?? "" },
  { header: "현장소장", width: 18, get: (s) => joinWithSpace(s.site_manager, s.manager_position) },
  { header: "H.P", width: 14, alignment: "center", get: (s) => s.manager_phone ?? "" },
  { header: "현장인원", width: 9, alignment: "right", format: "0_);[Red](0)", get: (s) => s.headcount },
  { header: "PM", width: 14, get: (s) => joinWithSpace(s.pm_name, s.pm_position) },
];

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function joinWithSpace(a: string | null, b: string | null): string {
  return [a, b].filter(Boolean).join(" ");
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateLabel(d: Date): string {
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

function buildFilename(now: Date, summary?: FilterDescriptor): string {
  const datePart = formatDateLabel(now);
  const corps = summary?.corporations ?? [];
  const regions = summary?.regions ?? [];
  const suffixParts: string[] = [];
  if (corps.length === 1) suffixParts.push(corps[0]!);
  if (regions.length > 0 && regions.length <= 2) suffixParts.push(regions.join(""));
  const suffix = suffixParts.length > 0 ? `_${suffixParts.join("_")}` : "";
  return `현장리스트_${datePart}${suffix}.xlsx`;
}

function cmp(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", "ko");
}

function sortSites(sites: SiteDashboard[]): SiteDashboard[] {
  return [...sites].sort((a, b) => {
    return (
      cmp(a.corporation_name, b.corporation_name) ||
      cmp(a.division, b.division) ||
      cmp(a.region_name, b.region_name) ||
      cmp(a.site_name, b.site_name)
    );
  });
}

export async function exportSitesToExcel(
  sites: SiteDashboard[],
  options?: ExportSitesOptions,
): Promise<void> {
  const now = options?.publishedAt ?? new Date();

  const wb = new ExcelJS.Workbook();
  wb.creator = "현장 통합 대시보드";
  wb.created = now;

  const ws = wb.addWorksheet("현장리스트", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  ws.columns = COLUMNS.map((c) => ({ width: c.width }));

  const lastColLetter = ws.getColumn(COLUMNS.length).letter;

  // R1 — title + published date
  const titleRow = ws.getRow(1);
  titleRow.height = 26;
  titleRow.getCell(1).value = "건설 3사 현장 리스트";
  titleRow.getCell(1).font = { name: "맑은 고딕", size: 14, bold: true };
  titleRow.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
  ws.mergeCells(`A1:${lastColLetter}1`);
  // Date overlay in last column with red color (after merge, write via the
  // last cell — note that exceljs preserves only the top-left cell of a merge,
  // so emulate the original layout by appending a separate date row above.)
  // Instead: keep the merge for the title and put the date in the title text.
  titleRow.getCell(1).value = {
    richText: [
      { text: "건설 3사 현장 리스트", font: { name: "맑은 고딕", size: 14, bold: true } },
      { text: `   (${formatDateLabel(now)})`, font: { name: "맑은 고딕", size: 11, color: { argb: TITLE_DATE_COLOR } } },
    ],
  };

  // R2 — header
  const headerRow = ws.getRow(2);
  headerRow.height = 32;
  COLUMNS.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { name: "맑은 고딕", size: 10, bold: true };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = thinBorder();
  });

  // Data rows + subtotals + total
  const sorted = sortSites(sites);
  const grouped = groupByCorpAndDivision(sorted);
  const showCorpSubtotal = grouped.length > 1;
  const showDivSubtotal = grouped.some((g) => g.divisions.length > 1);
  const showTotal = sorted.length > 0 && (showCorpSubtotal || showDivSubtotal);

  let nextRow = 3;
  for (const corpGroup of grouped) {
    const showThisCorpDivSubtotal = corpGroup.divisions.length > 1;
    for (const divGroup of corpGroup.divisions) {
      for (const site of divGroup.sites) {
        writeSiteRow(ws, nextRow, site);
        nextRow++;
      }
      if (showThisCorpDivSubtotal) {
        writeSubtotalRow(
          ws,
          nextRow,
          `${corpGroup.corp} ${divGroup.div} 소계 (${divGroup.sites.length}건)`,
          divGroup.sites,
          "division",
        );
        nextRow++;
      }
    }
    if (showCorpSubtotal) {
      const allCorpSites = corpGroup.divisions.flatMap((d) => d.sites);
      writeSubtotalRow(
        ws,
        nextRow,
        `${corpGroup.corp} 소계 (${allCorpSites.length}건)`,
        allCorpSites,
        "corporation",
      );
      nextRow++;
    }
  }
  if (showTotal) {
    writeSubtotalRow(ws, nextRow, `총합계 (${sorted.length}건)`, sorted, "total");
    nextRow++;
  }

  // AutoFilter on header row
  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: COLUMNS.length },
  };

  const buffer = await wb.xlsx.writeBuffer();
  triggerDownload(
    buffer,
    buildFilename(now, options?.filterSummary),
  );
}

interface DivisionGroup {
  div: string;
  sites: SiteDashboard[];
}

interface CorpGroup {
  corp: string;
  divisions: DivisionGroup[];
}

function groupByCorpAndDivision(sorted: SiteDashboard[]): CorpGroup[] {
  const out: CorpGroup[] = [];
  for (const s of sorted) {
    const corpKey = s.corporation_name ?? "";
    const divKey = s.division ?? "";
    let corp = out[out.length - 1];
    if (!corp || corp.corp !== corpKey) {
      corp = { corp: corpKey, divisions: [] };
      out.push(corp);
    }
    let div = corp.divisions[corp.divisions.length - 1];
    if (!div || div.div !== divKey) {
      div = { div: divKey, sites: [] };
      corp.divisions.push(div);
    }
    div.sites.push(s);
  }
  return out;
}

function writeSiteRow(ws: ExcelJS.Worksheet, rowIdx: number, site: SiteDashboard): void {
  const row = ws.getRow(rowIdx);
  COLUMNS.forEach((col, colIdx) => {
    const cell = row.getCell(colIdx + 1);
    cell.value = col.get(site);
    if (col.format) cell.numFmt = col.format;
    cell.font = { name: "맑은 고딕", size: 10 };
    cell.alignment = {
      vertical: "middle",
      horizontal: col.alignment ?? "left",
      wrapText: false,
    };
    cell.border = thinBorder();
  });
}

type SubtotalLevel = "division" | "corporation" | "total";

interface SubtotalStyle {
  fill: string;
  fontColor?: string;
  fontSize?: number;
  topBorder?: "thin" | "medium" | "double";
}

const SUBTOTAL_STYLE: Record<SubtotalLevel, SubtotalStyle> = {
  // 부문 소계 — 옅은 골드 (Office "Note" 톤)
  division:    { fill: "FFFFF2CC" },
  // 회사 소계 — 앰버 (한 단계 강조)
  corporation: { fill: "FFFFE699", topBorder: "thin" },
  // 총합계 — 짙은 네이비 + 흰 글씨 + 상단 더블라인 (재무보고서 표준)
  total:       { fill: "FF1F4E79", fontColor: "FFFFFFFF", fontSize: 11, topBorder: "double" },
};

function sumNullable(sites: SiteDashboard[], pick: (s: SiteDashboard) => number | null): number {
  return sites.reduce((acc, s) => acc + (pick(s) ?? 0), 0);
}

function writeSubtotalRow(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  label: string,
  sites: SiteDashboard[],
  level: SubtotalLevel,
): void {
  const row = ws.getRow(rowIdx);
  const style = SUBTOTAL_STYLE[level];
  const fill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: style.fill },
  };
  const font: Partial<ExcelJS.Font> = {
    name: "맑은 고딕",
    size: style.fontSize ?? 10,
    bold: true,
    color: style.fontColor ? { argb: style.fontColor } : undefined,
  };
  const border = subtotalBorder(style.topBorder);

  // Slightly taller for total row to give it executive-summary weight
  if (level === "total") row.height = 22;
  else if (level === "corporation") row.height = 20;

  // Label spans columns 1..9 (corp through 공동도급).
  const LABEL_END = 9;
  const labelCell = row.getCell(1);
  labelCell.value = label;
  labelCell.font = font;
  labelCell.alignment = { vertical: "middle", horizontal: "right" };
  labelCell.fill = fill;
  labelCell.border = border;
  for (let c = 2; c <= LABEL_END; c++) {
    const cell = row.getCell(c);
    cell.value = null;
    cell.fill = fill;
    cell.border = border;
    cell.font = font;
  }
  ws.mergeCells(rowIdx, 1, rowIdx, LABEL_END);

  const sums: Record<number, number> = {
    10: sumNullable(sites, (s) => s.contract_amount),       // 도급액
    11: sumNullable(sites, (s) => s.our_share_amount),      // 자사도급액
    21: sumNullable(sites, (s) => s.headcount),             // 현장인원
  };

  for (let c = LABEL_END + 1; c <= COLUMNS.length; c++) {
    const cell = row.getCell(c);
    const colSpec = COLUMNS[c - 1];
    if (sums[c] !== undefined) {
      cell.value = sums[c];
      if (colSpec.format) cell.numFmt = colSpec.format;
      cell.alignment = { vertical: "middle", horizontal: "right" };
    } else {
      cell.value = null;
      cell.alignment = { vertical: "middle", horizontal: colSpec.alignment ?? "left" };
    }
    cell.font = font;
    cell.fill = fill;
    cell.border = border;
  }
}

function subtotalBorder(topStyle?: "thin" | "medium" | "double"): ExcelJS.Borders {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFBFBFBF" } };
  const top: Partial<ExcelJS.Border> = topStyle
    ? { style: topStyle, color: { argb: "FF1F4E79" } }
    : side;
  return {
    top,
    left: side,
    bottom: side,
    right: side,
    diagonal: { style: undefined } as Partial<ExcelJS.Border>,
  } as unknown as ExcelJS.Borders;
}

function thinBorder(): ExcelJS.Borders {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFBFBFBF" } };
  return {
    top: side,
    left: side,
    bottom: side,
    right: side,
    diagonal: { style: undefined } as Partial<ExcelJS.Border>,
  } as unknown as ExcelJS.Borders;
}

function triggerDownload(buffer: ExcelJS.Buffer, filename: string): void {
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
