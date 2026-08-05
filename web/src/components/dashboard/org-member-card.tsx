"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { User, X, Camera, ZoomIn, ZoomOut, Check } from "lucide-react";
import type { OrgMember } from "@/types/org-chart";
import { useAuth } from "@/lib/auth-context";
import { uploadOrgPhoto } from "@/lib/api/org";
import { orgPhotoUrl } from "@/lib/storage";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// 기존 업로드 사진은 photo_url 컬럼에 안 적힌 채 storage에만 있을 수 있음
// (백필 전 데이터). 예측 가능한 경로로 fallback해서 onError 시에만 빈 칸으로.
function initialPhotoSrc(member: OrgMember): string | null {
  if (member.photo_url) return member.photo_url;
  return orgPhotoUrl(member.id);
  return null;
}

interface PhotoSettings {
  x: number;
  y: number;
  scale: number;
}

function loadPhotoSettings(memberId: number): PhotoSettings {
  try {
    const raw = localStorage.getItem(`org-photo-${memberId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { x: 0, y: 0, scale: 1 };
}

function savePhotoSettings(memberId: number, s: PhotoSettings) {
  localStorage.setItem(`org-photo-${memberId}`, JSON.stringify(s));
}

interface OrgMemberCardProps {
  member: OrgMember;
  primary?: boolean;
  onSelect?: () => void;
}

/* Passport-photo 비율 (3:4) — primary/secondary 동일 크기 */
const PHOTO_W = 84;
const PHOTO_H = 112;

/* 직원 유형별 사진 테두리 색상 — 회사명/유형 라벨은 숨기고 테두리 색으로만 구분 */
function typeRing(member: OrgMember): string {
  if (member.employee_type === "전문직") return "ring-emerald-400";
  if (member.employee_type === "현채직") return "ring-sky-400";
  if (member.company_name) return "ring-amber-400"; // 공동사(타 회사)
  return "ring-slate-200";
}

export function OrgMemberCard({ member, primary, onSelect }: OrgMemberCardProps) {
  const { isAdmin } = useAuth();
  const [imgError, setImgError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | null>(() => initialPhotoSrc(member));
  const [settings, setSettings] = useState<PhotoSettings>(() => loadPhotoSettings(member.id));
  const [draft, setDraft] = useState<PhotoSettings>(settings);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const roleLabel = member.specialty
    ? `${member.role_name}(${member.specialty})`
    : member.role_name;

  const isMember = member.role_name === "팀원";

  const current = editing ? draft : settings;
  const photoW = PHOTO_W;
  const photoH = PHOTO_H;
  const ringColor = typeRing(member);

  // --- 업로드 ---
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await uploadOrgPhoto(file, member.id);
      const reset = { x: 0, y: 0, scale: 1 };
      // Backend returns the cache-busted URL it just persisted to photo_url.
      setImgSrc(res.url);
      setImgError(false);
      setSettings(reset);
      setDraft(reset);
      savePhotoSettings(member.id, reset);
      setEditing(true);
    } catch {}
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // --- 드래그 ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, [editing]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    e.stopPropagation();
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setDraft((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const handleMouseUp = useCallback(() => { dragging.current = false; }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setDraft((prev) => ({ ...prev, scale: Math.max(0.3, Math.min(3, prev.scale + delta)) }));
  }, [editing]);

  const zoom = (delta: number) => {
    setDraft((prev) => ({ ...prev, scale: Math.max(0.3, Math.min(3, prev.scale + delta)) }));
  };

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSettings(draft);
    savePhotoSettings(member.id, draft);
    setEditing(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(settings);
    setEditing(false);
  };

  const fileInput = <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />;

  const roleText = primary ? roleLabel : (isMember ? member.rank : roleLabel);
  const showSpecialtyInline = isMember && !primary && member.specialty;

  const photoNode = (
    <div className="relative shrink-0">
      <div
        className={cn(
          "relative overflow-hidden bg-slate-50 rounded-md ring-1 flex items-center justify-center select-none",
          "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
          primary ? "ring-slate-800" : "ring-slate-200"
        )}
        style={{ width: photoW, height: photoH }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {imgSrc && !imgError ? (
          <img
            src={imgSrc}
            alt={member.name}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={{
              transform: `translate(${current.x}px, ${current.y}px) scale(${current.scale})`,
              transformOrigin: "center center",
            }}
            draggable={false}
            onError={() => setImgError(true)}
          />
        ) : (
          <User className="h-7 w-7 text-slate-300" />
        )}
      </div>

      {/* 편집 모드 UI */}
      {editing && (
        <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-slate-900/80 backdrop-blur-sm rounded-full px-1.5 py-1 z-20">
          <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="p-1 text-white/80 hover:text-white rounded-full hover:bg-white/10" title="사진 교체">
            <Camera className="h-3 w-3" />
          </button>
          <div className="w-px h-3 bg-white/20" />
          <button onClick={(e) => { e.stopPropagation(); zoom(-0.1); }} className="p-1 text-white/80 hover:text-white rounded-full hover:bg-white/10">
            <ZoomOut className="h-3 w-3" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); zoom(0.1); }} className="p-1 text-white/80 hover:text-white rounded-full hover:bg-white/10">
            <ZoomIn className="h-3 w-3" />
          </button>
          <div className="w-px h-3 bg-white/20" />
          <button onClick={handleCancel} className="p-1 text-white/80 hover:text-white rounded-full hover:bg-white/10">
            <X className="h-3 w-3" />
          </button>
          <button onClick={handleSave} className="p-1 text-white bg-primary hover:bg-primary/80 rounded-full">
            <Check className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* 카메라 버튼 — 관리자 hover 시 */}
      {!editing && isAdmin && (
        <button
          onClick={(e) => { e.stopPropagation(); setDraft(settings); setEditing(true); }}
          className="absolute top-1 right-1 p-1 bg-slate-900/50 backdrop-blur-sm text-white/90 rounded-md opacity-0 group-hover:opacity-100 hover:bg-slate-900/70 transition-all z-10"
          title="사진 편집"
        >
          <Camera className="h-3 w-3" />
        </button>
      )}
    </div>
  );

  if (primary) {
    // Primary: 부서 카드와 동일한 구조 — 헤더(역할) + 본체(사진 + 이름/전화)
    return (
      <>
        {fileInput}
        <div
          onClick={() => { if (!editing && onSelect) onSelect(); }}
          tabIndex={0}
          className={cn(
            "group relative cursor-pointer outline-none w-50 rounded-md",
            "bg-slate-50 shadow-sm ring-1 ring-slate-200",
            "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
          )}
        >
          {/* 헤더 — 역할명 (현장대리인/현장소장) */}
          <div className="rounded-t-md px-2.5 py-1.5 bg-slate-700 text-white text-[12px] font-medium tracking-wide whitespace-nowrap text-center truncate">
            {roleText}
          </div>
          {/* 본체 — 사진 + 이름/전화 */}
          <div className="flex flex-row items-start gap-3 py-3 px-3">
            {photoNode}
            <div className="flex flex-col items-start min-w-0 flex-1 pt-0.5">
              <p className="text-[17px] font-bold text-slate-900 leading-tight truncate max-w-full">
                {member.name}
              </p>
              {member.phone && (
                <p className="mt-1.5 text-[11px] text-slate-500 font-mono tabular-nums leading-tight truncate max-w-full">
                  {member.phone}
                </p>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  // Secondary: 사진(좌) + 직위/이름/태그(우)
  return (
    <>
      {fileInput}
      <div
        onClick={() => { if (!editing && onSelect) onSelect(); }}
        tabIndex={0}
        className={cn(
          "group relative cursor-pointer outline-none",
          "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded-md",
          "flex flex-row items-center w-[140px] h-[112px] px-0.5"
        )}
      >
        {photoNode}
        <div className="ml-1.5 pt-2 flex flex-col items-start min-w-0 flex-1 self-stretch justify-start gap-0.5">
          {member.rank && (
            <p className="text-[12px] text-slate-500 font-normal tracking-wider leading-[1.3] truncate max-w-full">
              {member.rank}
            </p>
          )}
          <p className="text-[13px] font-bold text-slate-900 leading-[1.3] truncate max-w-full">
            {member.name}
          </p>
          <div className="mt-1 flex flex-col items-start gap-1">
            {member.org_type === "JV" && (
              <span className="inline-flex justify-center whitespace-nowrap w-8 py-[1px] rounded-xs bg-white text-slate-800 ring-1 ring-slate-300 text-[9px] font-semibold leading-[1.3]">
                공동도급
              </span>
            )}
            {member.specialty && (
              <span className="inline-flex justify-center whitespace-nowrap w-8 py-[1px] rounded-xs bg-white text-slate-600 ring-1 ring-slate-200 text-[9px] font-semibold leading-[1.3]">
                {member.specialty.length <= 2
                  ? member.specialty.split("").join(" ")
                  : member.specialty}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
