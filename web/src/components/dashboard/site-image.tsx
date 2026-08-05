"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, Check, X, ZoomIn, ZoomOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { uploadSiteImage } from "@/lib/api/sites";
import { Skeleton } from "@/components/ui/skeleton";
import { BUCKET_SITE_IMAGES } from "@/lib/storage";

interface ImageSettings {
  x: number;
  y: number;
  scale: number;
}

const STORAGE_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET_SITE_IMAGES}`;

function loadSettings(siteId: number): ImageSettings {
  try {
    const raw = localStorage.getItem(`site-img-${siteId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { x: 0, y: 0, scale: 1 };
}

function saveSettings(siteId: number, settings: ImageSettings) {
  localStorage.setItem(`site-img-${siteId}`, JSON.stringify(settings));
}

interface SiteImageProps {
  siteId: number;
  siteName: string;
  division?: string;
}

/** 토목/도로 — 고가도로 일러스트 (미니멀) */
function BridgeIllustration() {
  return (
    <svg viewBox="0 0 800 350" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="ph-sky-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8eff5" />
          <stop offset="100%" stopColor="#c5d8e8" />
        </linearGradient>
      </defs>
      {/* 하늘 */}
      <rect width="800" height="350" fill="url(#ph-sky-b)" />
      {/* 먼 산 실루엣 */}
      <path d="M0 240 Q120 200 240 220 Q400 190 520 210 Q660 185 800 215 L800 260 L0 260Z" fill="#b0c4d4" opacity="0.5" />
      {/* 지면 */}
      <rect x="0" y="255" width="800" height="95" fill="#d0dce6" />
      {/* 교각 */}
      {[100, 260, 420, 580, 740].map((x) => (
        <g key={`pier-${x}`}>
          <rect x={x - 6} y="180" width="12" height="80" rx="2" fill="#8a9caa" />
          <rect x={x - 14} y="254" width="28" height="8" rx="2" fill="#7a8c9a" />
        </g>
      ))}
      {/* 상판 */}
      <rect x="-20" y="172" width="840" height="14" rx="4" fill="#6a8090" />
      <rect x="-20" y="172" width="840" height="3" rx="1" fill="#8aa0b0" />
      {/* 난간 */}
      <rect x="-20" y="168" width="840" height="4" rx="1.5" fill="#7a909e" />
      {Array.from({ length: 40 }, (_, i) => (
        <rect key={`r-${i}`} x={i * 20} y="164" width="2" height="8" rx="0.5" fill="#7a909e" />
      ))}
      {/* 도로 중앙선 */}
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={`lane-${i}`} x={20 + i * 80} y="178" width="40" height="2" rx="1" fill="#a0b4c2" opacity="0.6" />
      ))}
      {/* 하부 구조 — 가로보 */}
      <rect x="-20" y="186" width="840" height="3" fill="#7a8c9a" opacity="0.4" />
    </svg>
  );
}

/** 건축 — 도시 스카이라인 일러스트 (미니멀) */
function BuildingIllustration() {
  return (
    <svg viewBox="0 0 800 350" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="ph-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#dce4ec" />
          <stop offset="100%" stopColor="#b8cad8" />
        </linearGradient>
      </defs>
      {/* 하늘 */}
      <rect width="800" height="350" fill="url(#ph-sky)" />
      {/* 뒷줄 건물 — 연한 실루엣 */}
      {[[30,160,50],[90,140,55],[155,170,40],[205,120,65],[280,150,50],[700,145,55],[760,165,40]].map(([x,y,w],i) => (
        <rect key={`bg-${i}`} x={x} y={y} width={w} height={350-y} fill="#b8c8d6" />
      ))}
      {/* 중간 건물 */}
      {[[55,180,60],[135,125,50],[205,100,65],[285,140,50],[350,165,45],[585,130,50],[650,155,45]].map(([x,y,w],i) => (
        <rect key={`md-${i}`} x={x} y={y} width={w} height={350-y} rx="1" fill="#96aec0" />
      ))}
      {/* 앞줄 건물 — 진한 실루엣 */}
      {[[20,210,55],[85,185,65],[165,160,75],[250,140,70],[340,115,85],[435,135,65],[510,165,60],[585,145,70],[670,180,55],[735,200,50]].map(([x,y,w],i) => (
        <rect key={`fg-${i}`} x={x} y={y} width={w} height={350-y} rx="1" fill="#6e8a9e" />
      ))}
      {/* 창문 — 앞줄에만 간결하게 */}
      {[165,250,340,435,585].map((bx) =>
        [0,1,2,3].map((row) =>
          [0,1,2].map((col) => (
            <rect key={`w-${bx}-${row}-${col}`} x={bx+8+col*20} y={bx===340?130:bx===250?155:175 + row*30} width="12" height="8" rx="1" fill="#84a0b4" opacity="0.5" />
          ))
        )
      )}
      {/* 지면 */}
      <rect x="0" y="342" width="800" height="8" fill="#4a6475" />
    </svg>
  );
}

export function SiteImage({ siteId, siteName, division }: SiteImageProps) {
  const { isAdmin } = useAuth();
  const [hasImage, setHasImage] = useState(true);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [settings, setSettings] = useState<ImageSettings>(() => loadSettings(siteId));
  const [draft, setDraft] = useState<ImageSettings>(settings);
  const [imgSrc, setImgSrc] = useState(`${STORAGE_URL}/site_${siteId}.jpg`);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setImgSrc(`${STORAGE_URL}/site_${siteId}.jpg`);
    setHasImage(true);
    setImgLoaded(false);
    const loaded = loadSettings(siteId);
    setSettings(loaded);
    setDraft(loaded);
    setEditing(false);
  }, [siteId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadSiteImage(file, siteId);
      const reset = { x: 0, y: 0, scale: 1 };
      setImgSrc(`${STORAGE_URL}/site_${siteId}.jpg?t=${Date.now()}`);
      setHasImage(true);
      setImgLoaded(false);
      setSettings(reset);
      setDraft(reset);
      saveSettings(siteId, reset);
      setEditing(true);
    } catch {}
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!editing) return;
    e.preventDefault();
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, [editing]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setDraft((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const handleMouseUp = useCallback(() => { dragging.current = false; }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!editing) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setDraft((prev) => ({ ...prev, scale: Math.max(0.3, Math.min(3, prev.scale + delta)) }));
  }, [editing]);

  const touchRef = useRef<{ x: number; y: number; dist?: number }>({ x: 0, y: 0 });

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!editing) return;
    if (e.touches.length === 1) {
      touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchRef.current.dist = Math.sqrt(dx * dx + dy * dy);
    }
  }, [editing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!editing) return;
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchRef.current.x;
      const dy = e.touches[0].clientY - touchRef.current.y;
      touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setDraft((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    } else if (e.touches.length === 2 && touchRef.current.dist) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = (dist - touchRef.current.dist) * 0.005;
      touchRef.current.dist = dist;
      setDraft((prev) => ({ ...prev, scale: Math.max(0.3, Math.min(3, prev.scale + delta)) }));
    }
  }, [editing]);

  const handleSave = () => {
    setSettings(draft);
    saveSettings(siteId, draft);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(settings);
    setEditing(false);
  };

  const zoom = (delta: number) => {
    setDraft((prev) => ({ ...prev, scale: Math.max(0.3, Math.min(3, prev.scale + delta)) }));
  };

  const current = editing ? draft : settings;

  // 숨겨진 파일 input
  const fileInput = <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />;

  // 이미지 없을 때
  if (!hasImage) {
    return (
      <div className="relative w-full h-[300px] overflow-hidden group">
        {fileInput}
        {division === "토목" ? <BridgeIllustration /> : <BuildingIllustration />}
        {/* 카메라 버튼 — 관리자만 */}
        {isAdmin && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="absolute bottom-10 right-2 p-1.5 bg-black/40 backdrop-blur-sm text-white/80 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-black/60 hover:text-white transition-all"
            title="사진 등록"
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  // 이미지 있을 때
  return (
    <div
      ref={containerRef}
      className="relative w-full h-[300px] overflow-hidden bg-muted select-none group"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      style={{ cursor: editing ? "grab" : "pointer" }}
      onClick={() => { if (!editing) setLightbox(true); }}
    >
      {fileInput}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); setLightbox(false); }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(false); }}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={imgSrc}
            alt={`${siteName} 조감도`}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <img
        src={imgSrc}
        alt={`${siteName} 조감도`}
        className="absolute pointer-events-none transition-opacity duration-200"
        style={{
          left: "50%",
          top: "50%",
          width: "100%",
          transform: `translate(-50%, -50%) translate(${current.x}px, ${current.y}px) scale(${current.scale})`,
          opacity: imgLoaded ? 1 : 0,
        }}
        draggable={false}
        onLoad={() => setImgLoaded(true)}
        onError={() => setHasImage(false)}
      />

      {/* Loading skeleton — shown while the image fetches from Supabase storage */}
      {!imgLoaded && (
        <Skeleton className="absolute inset-0 rounded-none pointer-events-none" />
      )}

      {editing ? (
        <>
          {/* 편집 모드 안내 */}
          <div className="absolute inset-0 border-2 border-primary/40 rounded-sm pointer-events-none" />
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm text-white text-[10px] px-3 py-1 rounded-full pointer-events-none">
            드래그: 이동 · 스크롤: 확대/축소
          </div>
          {/* 편집 툴바 */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-black/60 backdrop-blur-sm rounded-lg px-1.5 py-1">
            <button onClick={() => fileInputRef.current?.click()} className="p-1.5 text-white/80 hover:text-white rounded hover:bg-white/10 transition-colors" title="사진 교체">
              <Camera className="h-3.5 w-3.5" />
            </button>
            <div className="w-px h-4 bg-white/20" />
            <button onClick={() => zoom(-0.1)} className="p-1.5 text-white/80 hover:text-white rounded hover:bg-white/10 transition-colors">
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => zoom(0.1)} className="p-1.5 text-white/80 hover:text-white rounded hover:bg-white/10 transition-colors">
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <div className="w-px h-4 bg-white/20" />
            <button onClick={handleCancel} className="p-1.5 text-white/80 hover:text-white rounded hover:bg-white/10 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
            <button onClick={handleSave} className="p-1.5 text-white hover:bg-primary/80 bg-primary rounded transition-colors">
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      ) : (
        /* 카메라 버튼 — 관리자만 */
        isAdmin && (
          <button
            onClick={() => { setDraft(settings); setEditing(true); }}
            className="absolute bottom-10 right-2 p-1.5 bg-black/40 backdrop-blur-sm text-white/80 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-black/60 hover:text-white transition-all"
            title="사진 편집"
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
        )
      )}
    </div>
  );
}
