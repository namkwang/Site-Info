"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  User, Phone, Mail, MapPin, Calendar, ChevronLeft, X,
  Smartphone,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { OrgMember, ResumeData } from "@/types/org-chart";
import { fetchOrgMemberProfile, type OrgMemberProfile } from "@/lib/api/org";
import { orgPhotoUrl } from "@/lib/storage";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

type ProfileApiResponse = OrgMemberProfile;

interface EmployeeProfileProps {
  memberId: number;
  siteName: string;
  onBack: () => void;
  onClose?: () => void;
  fallbackMember?: OrgMember | null;
  allMembers?: OrgMember[];
}

function calcAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const parts = birthDate.replace(/-/g, ".").split(".");
  if (parts.length < 3) return null;
  const birth = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function calcTenure(startDate: string | null | undefined): string {
  if (!startDate) return "";
  const start = new Date(startDate);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years > 0 && rem > 0) return `${years}년 ${rem}개월`;
  if (years > 0) return `${years}년`;
  return `${Math.max(rem, 1)}개월`;
}

function calcTotalExperience(experience: ResumeData["experience"], assignedFrom: string | null | undefined): string {
  let totalMonths = 0;
  for (const exp of (experience || [])) {
    const start = exp.startDate || exp.period?.split("~")[0]?.trim();
    const end = exp.endDate || exp.period?.split("~")[1]?.trim();
    if (!start) continue;
    const s = new Date(start.replace(/\./g, "-"));
    const e = end ? new Date(end.replace(/\./g, "-").replace(/\(.*\)/, "").trim()) : new Date();
    totalMonths += (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  }
  if (assignedFrom) {
    const s = new Date(assignedFrom);
    const now = new Date();
    totalMonths += (now.getFullYear() - s.getFullYear()) * 12 + (now.getMonth() - s.getMonth());
  }
  if (totalMonths <= 0) return "";
  const years = Math.floor(totalMonths / 12);
  const rem = totalMonths % 12;
  if (years > 0 && rem > 0) return `${years}년 ${rem}개월`;
  if (years > 0) return `${years}년`;
  return `${rem}개월`;
}

function getMemberPhoto(member: OrgMember): string | null {
  if (member.photo_url) return member.photo_url;
  return orgPhotoUrl(member.id);
  return null;
}

export function EmployeeProfile({ memberId, siteName, onBack, onClose, fallbackMember, allMembers = [] }: EmployeeProfileProps) {
  const [data, setData] = useState<ProfileApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(memberId);
  const [imgError, setImgError] = useState(false);

  const loadProfile = useCallback(async (id: number) => {
    setLoading(true);
    setImgError(false);
    try {
      setData(await fetchOrgMemberProfile(id));
    } catch {
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadProfile(selectedId); }, [selectedId, loadProfile]);

  if (loading) {
    return (
      <div className="relative flex h-full">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute top-4 right-4 z-10 h-8 w-8 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        {/* Left peers sidebar skeleton */}
        <div className="w-50 shrink-0 border-r border-border bg-muted/30 flex flex-col">
          <div className="px-4 pt-4 pb-3">
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="px-4 pb-3 border-b border-border">
            <Skeleton className="h-3.5 w-24 mb-1" />
            <Skeleton className="h-2.5 w-32" />
          </div>
          <div className="flex-1 overflow-hidden py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <Skeleton className="w-7 h-9 rounded-md shrink-0" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3 w-20 mb-1" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main content skeleton */}
        <div className="flex-1 overflow-hidden">
          <div className="flex gap-6 p-6 min-h-full">
            <div className="w-70 shrink-0 space-y-4">
              <Skeleton className="h-3.5 w-16" />
              <div className="flex justify-center">
                <Skeleton className="w-[140px] h-[168px] rounded-xl" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-36" />
              </div>
              <div className="space-y-2 pt-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
            <div className="flex-1 space-y-4">
              <Skeleton className="h-5 w-32" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
              <Skeleton className="h-5 w-40 mt-6" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
              <Skeleton className="h-5 w-32 mt-6" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Build effective data — use API response or fallback to org chart data
  const currentFallback = allMembers.find((m) => m.id === selectedId) ?? fallbackMember;

  const member: OrgMember = data?.member ?? currentFallback ?? {
    id: selectedId, site_id: 0, name: "?", rank: null, phone: null, email: null,
    org_type: "OWN" as const, company_name: null, employee_type: null,
    role_id: 0, role_code: "", role_name: "", role_sort_order: 0,
    department_id: null, department_name: null, department_sort_order: null,
    specialty: null, parent_id: null, sort_order: 0, is_active: true,
    assigned_from: null, assigned_to: null, note: null,
  };
  const resume: ResumeData = data?.resume ?? { education: [], certifications: [], experience: [], appointmentHistory: [] };

  // Sidebar groups every member of the site by department so the user can
  // jump across teams without backing out to the org chart. Uses the full
  // client-side `allMembers` (already loaded for the chart) — the API's
  // narrower `data.peers` (current dept only) is intentionally ignored
  // here since the goal is the whole site at a glance.
  const peerGroups: { name: string; members: OrgMember[] }[] = (() => {
    if (allMembers.length === 0) return [];
    const topLevel = allMembers
      .filter((m) => m.parent_id == null)
      .sort((a, b) => a.sort_order - b.sort_order);
    const byDeptId = new Map<number, OrgMember[]>();
    for (const m of allMembers) {
      if (m.parent_id == null) continue;
      const did = m.department_id;
      if (did == null) continue;
      const arr = byDeptId.get(did) ?? [];
      arr.push(m);
      byDeptId.set(did, arr);
    }
    for (const arr of byDeptId.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    const groups: { name: string; members: OrgMember[] }[] = [];
    if (topLevel.length > 0) groups.push({ name: "현장 리더", members: topLevel });
    const deptIds = Array.from(byDeptId.keys()).sort((a, b) => {
      const aOrder = byDeptId.get(a)![0]?.department_sort_order ?? 0;
      const bOrder = byDeptId.get(b)![0]?.department_sort_order ?? 0;
      return aOrder - bOrder;
    });
    for (const did of deptIds) {
      const members = byDeptId.get(did)!;
      groups.push({ name: members[0].department_name ?? "기타", members });
    }
    return groups;
  })();
  const photoSrc = getMemberPhoto(member);
  const age = calcAge(member.birth_date);
  const tenure = calcTenure(member.assigned_from);
  const totalExp = calcTotalExperience(resume.experience || [], member.assigned_from);
  const skills = member.skills ? member.skills.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const internalCareers = resume.appointmentHistory || [];
  const externalCareers = resume.experience || [];
  const educations = resume.education || [];
  const certifications = resume.certifications || [];

  return (
    <div className="relative flex h-full">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute top-4 right-4 z-10 h-8 w-8 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      )}
      {/* ── Left sidebar: peers ── */}
      <div className="w-[200px] shrink-0 border-r border-border bg-muted/30 flex flex-col">
        <div className="px-4 pt-4 pb-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-500 hover:text-slate-900 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            나가기
          </button>
        </div>
        <div className="px-4 pb-3 border-b border-border">
          <h3 className="text-[13px] font-bold leading-tight">{siteName}</h3>
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">전체 인원 {peerGroups.reduce((n, g) => n + g.members.length, 0)}명</p>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {peerGroups.map((group, gi) => (
            <div key={`${gi}-${group.name}`} className={cn(gi > 0 && "mt-2")}>
              <div className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {group.name}
              </div>
              {group.members.map((p) => {
                const isActive = p.id === selectedId;
                const peerPhoto = p.photo_url
                  || orgPhotoUrl(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                      isActive ? "bg-primary/10 border-r-2 border-primary" : "hover:bg-muted/60"
                    )}
                  >
                    <div className="w-7 h-9 rounded-md overflow-hidden bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center shrink-0">
                      {peerPhoto ? (
                        <img src={peerPhoto} alt={p.name} className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : null}
                      <User className={cn("h-3.5 w-3.5 text-slate-300", peerPhoto && "hidden")} />
                    </div>
                    <div className="min-w-0">
                      <p className={cn("text-[11px] font-semibold truncate leading-tight", isActive && "text-primary")}>{p.name}</p>
                      <p className="text-[9px] text-muted-foreground truncate leading-tight mt-0.5">
                        {p.rank}{p.role_name ? ` · ${p.role_name}` : ""}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-6 p-6 min-h-full">
          {/* ── Profile sidebar ── */}
          <div className="w-40 shrink-0 space-y-3">
            {/* 프로필 카드 */}
            <div className="bg-card rounded-md border border-border p-4">
              <div className="flex flex-col items-center">
                {member.job_category && (
                  <Badge variant="orange" size="sm" className="mb-3">
                    {member.job_category}
                  </Badge>
                )}
                <div className="w-[120px] aspect-[3/4] rounded-md overflow-hidden mb-3 bg-muted flex items-center justify-center">
                  {photoSrc && !imgError ? (
                    <img
                      src={photoSrc}
                      alt={member.name}
                      className="w-full h-full object-cover object-top"
                      onError={() => setImgError(true)}
                    />
                  ) : (
                    <User className="h-12 w-12 text-muted-foreground/30" />
                  )}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <h2 className="text-[15px] font-bold text-foreground">{member.name}</h2>
                  <span className="text-[15px] font-bold text-muted-foreground">
                    {member.rank}
                    {age != null && <span className="text-foreground text-[12px] ml-0.5">({age}세)</span>}
                  </span>
                </div>
              </div>
            </div>

            {/* 근속/경력 카드 */}
            <div className="bg-card rounded-md border border-border py-3">
              <div className="flex">
                <div className="flex-1 text-center border-r border-border">
                  <p className="text-[14px] font-bold text-foreground leading-none">{tenure || "—"}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">근속</p>
                </div>
                <div className="flex-1 text-center">
                  <p className="text-[14px] font-bold text-foreground leading-none">{totalExp || "—"}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">경력</p>
                </div>
              </div>
            </div>

            {/* 학력 카드 */}
            <div className="bg-card rounded-md border border-border px-3 py-2.5">
              <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">학력</span>
              <div className="space-y-0.5">
                {educations.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground text-center py-1.5">등록된 학력이 없습니다.</p>
                ) : (
                  educations.slice(0, 3).map((edu, i) => (
                    <div key={i} className="py-1 flex items-center gap-2">
                      <span className="text-xl shrink-0">🎓</span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold text-foreground truncate">{edu.school_name}</p>
                        {edu.major && (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {edu.major}{edu.degree ? ` · ${edu.degree}` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── Right sections — 세로 스택 (탭 없음) ── */}
          <div className="flex-1 min-w-0 space-y-3">
            {/* ── Career 카드 ── */}
            <div className="bg-card rounded-md border border-border p-4">
              <p className="text-[14px] font-bold text-foreground uppercase tracking-normal mb-4">Career</p>
              <div className="grid grid-cols-2 gap-6">
                {/* 자사 경력 */}
                <div>
                  <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3 pb-1.5 border-b border-border">자사 경력</h4>
                  <div className="space-y-2.5">
                    {internalCareers.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground text-center py-4">등록된 경력이 없습니다</p>
                    ) : (
                      internalCareers.map((c, i) => (
                        <div key={i} className={cn(
                          "p-3 rounded-md bg-card",
                          i === 0 ? "border-2 border-border" : "border border-border"
                        )}>
                          <p className="text-[12px] font-bold text-foreground">
                            {i === 0 && (
                              <span className="mr-1.5 text-[10px] font-bold text-foreground bg-accent px-2 py-0.5 rounded-full uppercase tracking-widest">Now</span>
                            )}
                            {[c.department, c.position, c.date].filter(Boolean).join(" | ") || "—"}
                          </p>
                          {c.description && c.description.trim() && (
                            <ul className={cn(
                              "mt-2 space-y-1.5 pt-2",
                              i === 0 ? "border-t border-foreground/15" : "border-t border-border"
                            )}>
                              {c.description.split("\n").filter((l) => l.trim()).map((line, j) => {
                                const imp = line.startsWith("★");
                                const text = imp ? line.slice(1).trim() : line.trim();
                                return (
                                  <li key={j} className={cn(
                                    "flex items-center gap-2",
                                    i === 0 ? "text-[12px] font-bold text-foreground" : "text-[12px] text-muted-foreground"
                                  )}>
                                    <span className={cn(
                                      "inline-flex items-center gap-2",
                                      imp && "bg-yellow-100 dark:bg-yellow-900/30 rounded-sm px-1.5 py-0.5 -ml-1.5"
                                    )}>
                                      <span className={cn(
                                        "w-1.5 h-1.5 rounded-full shrink-0",
                                        imp ? "bg-yellow-500" : i === 0 ? "bg-foreground" : "bg-muted-foreground"
                                      )} />
                                      {text}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
                {/* 타사 경력 */}
                <div>
                  <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3 pb-1.5 border-b border-border">타사 경력</h4>
                  <div className="space-y-2.5">
                    {externalCareers.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground text-center py-4">등록된 타사 경력이 없습니다</p>
                    ) : (
                      externalCareers.map((c, i) => {
                        const period = (() => {
                          const s = c.startDate || c.period?.split("~")[0]?.trim();
                          const e = c.endDate || c.period?.split("~")[1]?.trim();
                          if (!s) return "";
                          return `${s} ~ ${e || "현재"}`;
                        })();
                        return (
                          <div key={i} className="p-3 rounded-md bg-card border-2 border-border">
                            <p className="text-[12px] font-bold text-foreground">
                              {c.company}{c.position && ` | ${c.position}`}{period && ` | ${period}`}
                            </p>
                            {c.description && c.description.trim() && (
                              <ul className="mt-2 space-y-1.5 pt-2 border-t border-border">
                                {c.description.split("\n").filter((l) => l.trim()).map((line, j) => {
                                  const imp = line.startsWith("★");
                                  const text = imp ? line.slice(1).trim() : line.trim();
                                  return (
                                    <li key={j} className={cn(
                                      "text-[12px] flex items-center gap-2",
                                      imp ? "text-foreground" : "text-muted-foreground"
                                    )}>
                                      <span className={cn(
                                        "inline-flex items-center gap-2",
                                        imp && "bg-yellow-100 dark:bg-yellow-900/30 rounded-sm px-1.5 py-0.5 -ml-1.5"
                                      )}>
                                        <span className={cn(
                                          "w-1.5 h-1.5 rounded-full shrink-0",
                                          imp ? "bg-yellow-500" : "bg-muted-foreground"
                                        )} />
                                        {text}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Skills 카드 ── */}
            <div className="bg-card rounded-md border border-border p-4">
              <p className="text-[14px] font-bold text-foreground uppercase tracking-normal mb-4">Skills</p>
              <div className="grid grid-cols-2 gap-6">
                {/* 자격증 및 면허 */}
                <div>
                  <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3 pb-1.5 border-b border-border">자격증 및 면허</h4>
                  {certifications.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground text-center py-4">등록된 자격증이 없습니다</p>
                  ) : (
                    <div className="space-y-2">
                      {certifications.map((cert, i) => (
                        <div key={i} className="px-3.5 py-2.5 rounded-md bg-card border-2 border-border">
                          <p className="text-[12px] font-bold text-foreground">{cert.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {[cert.acquisition_date, cert.issuer].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* 스킬 */}
                <div>
                  <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3 pb-1.5 border-b border-border">스킬</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {skills.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground py-4 w-full text-center">등록된 스킬이 없습니다</p>
                    ) : (
                      skills.map((skill) => (
                        <span key={skill} className="px-3 py-1.5 rounded-full bg-muted text-[11px] font-bold text-foreground">{skill}</span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Information 카드 ── */}
            <div className="bg-card rounded-md border border-border p-4">
              <p className="text-[14px] font-bold text-foreground uppercase tracking-normal mb-4">Information</p>
              <div className="grid grid-cols-2 gap-6">
                {/* 인사정보 */}
                <div>
                  <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3 pb-1.5 border-b border-border">인사정보</h4>
                  <div className="space-y-2">
                    {member.department_name && (
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] text-muted-foreground w-12 shrink-0">부서</span>
                        <span className="text-[12px] font-medium text-foreground">{member.department_name}</span>
                      </div>
                    )}
                    {member.role_name && (
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] text-muted-foreground w-12 shrink-0">직책</span>
                        <span className="text-[12px] font-medium text-foreground">{member.role_name}</span>
                      </div>
                    )}
                    {member.birth_date && (
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-md bg-card flex items-center justify-center shrink-0">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <span className="text-[12px] text-muted-foreground">{member.birth_date}</span>
                      </div>
                    )}
                    {member.address && (
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-md bg-card flex items-center justify-center shrink-0">
                          <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <span className="text-[12px] text-muted-foreground">{member.address}</span>
                      </div>
                    )}
                    {member.job_category && (
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] text-muted-foreground w-12 shrink-0">직무</span>
                        <span className="text-[12px] font-medium text-foreground">{member.job_category}</span>
                      </div>
                    )}
                    {member.entry_type && (
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] text-muted-foreground w-12 shrink-0">입사</span>
                        <span className="text-[12px] font-medium text-foreground">{member.entry_type}</span>
                      </div>
                    )}
                    {member.task_detail && (
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] text-muted-foreground w-12 shrink-0">업무</span>
                        <span className="text-[12px] font-medium text-foreground">{member.task_detail}</span>
                      </div>
                    )}
                    {member.hobby && (
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] text-muted-foreground w-12 shrink-0">취미</span>
                        <span className="text-[12px] font-medium text-foreground">{member.hobby}</span>
                      </div>
                    )}
                    {!member.department_name && !member.role_name && !member.birth_date && !member.address && !member.job_category && !member.entry_type && !member.task_detail && !member.hobby && (
                      <p className="text-[12px] text-muted-foreground py-4 text-center">등록된 정보가 없습니다</p>
                    )}
                  </div>
                </div>
                {/* 연락처 */}
                <div>
                  <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3 pb-1.5 border-b border-border">연락처</h4>
                  <div className="space-y-2">
                    {member.phone_work && (
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-md bg-card flex items-center justify-center shrink-0">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <span className="text-[12px] text-muted-foreground">{member.phone_work}</span>
                      </div>
                    )}
                    {member.phone && (
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-md bg-card flex items-center justify-center shrink-0">
                          <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <a href={`tel:${member.phone}`} className="text-[12px] text-primary hover:underline">{member.phone}</a>
                      </div>
                    )}
                    {member.email && (
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-md bg-card flex items-center justify-center shrink-0">
                          <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <a href={`mailto:${member.email}`} className="text-[12px] text-primary hover:underline">{member.email}</a>
                      </div>
                    )}
                    {!member.phone_work && !member.phone && !member.email && (
                      <p className="text-[12px] text-muted-foreground py-4 text-center">등록된 연락처가 없습니다</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
