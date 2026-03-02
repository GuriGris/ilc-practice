import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";

// ─── Storage ─────────────────────────────────────────────────
const STORAGE_KEY = "practicepad_data";
const THEME_KEY = "practicepad_theme";
function loadData() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    if (!r) return { categories: [], folders: [], wordPairs: [], imageItems: [] };
    const d = JSON.parse(r);
    // Migration: add categories array if missing
    if (!d.categories) d.categories = [];
    // Migration: move orphaned folders into a default category
    const orphans = d.folders.filter((f) => !f.categoryId);
    if (orphans.length > 0) {
      const catId = uid();
      d.categories.push({ id: catId, name: "My Practice", createdAt: new Date().toISOString() });
      orphans.forEach((f) => { f.categoryId = catId; });
    }
    return d;
  }
  catch { return { categories: [], folders: [], wordPairs: [], imageItems: [] }; }
}
function saveData(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ─── Helpers ─────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
}

// Shared: draw source to canvas, auto-crop transparent space, resize, compute brightness
function cropAndFinalize(source, sw, sh) {
  const MAX_DIM = 600;
  // Step 1: draw full size to temp canvas
  const tmp = document.createElement("canvas"); tmp.width = sw; tmp.height = sh;
  const tctx = tmp.getContext("2d"); tctx.drawImage(source, 0, 0, sw, sh);
  const id = tctx.getImageData(0, 0, sw, sh);
  const d = id.data;

  // Step 2: find bounding box of non-transparent pixels only (alpha > 10)
  let top = sh, left = sw, bottom = 0, right = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const a = d[((y * sw + x) * 4) + 3];
      if (a <= 10) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  // Fallback if no content found, or crop removes too much (< 20% of area)
  const cropArea = (bottom - top + 1) * (right - left + 1);
  const fullArea = sw * sh;
  if (bottom <= top || right <= left || cropArea < fullArea * 0.2) {
    top = 0; left = 0; bottom = sh - 1; right = sw - 1;
  }

  // Add padding (4% of dimensions, min 4px)
  const padX = Math.max(4, Math.round((right - left) * 0.04));
  const padY = Math.max(4, Math.round((bottom - top) * 0.04));
  top = Math.max(0, top - padY); left = Math.max(0, left - padX);
  bottom = Math.min(sh - 1, bottom + padY); right = Math.min(sw - 1, right + padX);

  let cw = right - left + 1, ch = bottom - top + 1;

  // Step 3: resize if needed
  let fw = cw, fh = ch;
  if (fw > MAX_DIM || fh > MAX_DIM) { const sc = Math.min(MAX_DIM / fw, MAX_DIM / fh); fw = Math.round(fw * sc); fh = Math.round(fh * sc); }

  // Step 4: draw cropped + resized to final canvas
  const fc = document.createElement("canvas"); fc.width = fw; fc.height = fh;
  const fctx = fc.getContext("2d");
  fctx.drawImage(tmp, left, top, cw, ch, 0, 0, fw, fh);

  // Step 5: compute brightness
  const fd = fctx.getImageData(0, 0, fw, fh).data;
  let total = 0, count = 0;
  for (let i = 0; i < fd.length; i += 80) { total += fd[i] * 0.299 + fd[i + 1] * 0.587 + fd[i + 2] * 0.114; count++; }
  const brightness = count > 0 ? Math.round(total / count) : 128;
  return { dataUrl: fc.toDataURL("image/png"), brightness };
}

// Convert any image file to cropped PNG data URL + brightness
async function processImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const result = cropAndFinalize(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    return result;
  } catch {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new window.Image(); img.crossOrigin = "anonymous";
        img.onload = () => resolve(cropAndFinalize(img, img.naturalWidth, img.naturalHeight));
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("File read failed"));
      reader.readAsDataURL(file);
    });
  }
}

// Convert an image URL to cropped data URL + brightness
function processUrl(url) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try { resolve(cropAndFinalize(img, img.naturalWidth, img.naturalHeight)); }
      catch { resolve({ dataUrl: url, brightness: null }); }
    };
    img.onerror = () => resolve({ dataUrl: url, brightness: null });
    img.src = url;
  });
}
const Ic = ({ d, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const IcBack = (p) => <Ic {...p} d="M19 12H5M12 19l-7-7 7-7" />;
const IcPlus = (p) => <Ic {...p} d="M12 5v14M5 12h14" />;
const IcX = (p) => <Ic {...p} d="M18 6L6 18M6 6l12 12" />;
const IcCheck = (p) => <Ic {...p} d="M20 6L9 17l-5-5" />;
const IcUp = (p) => <Ic {...p} d="M18 15l-6-6-6 6" />;
const IcDown = (p) => <Ic {...p} d="M6 9l6 6 6-6" />;
const IcEye = (p) => <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const IcTrash = (p) => <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>;
const IcFolder = (p) => <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>;
const IcEdit = (p) => <Ic {...p} d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />;
const IcTrophy = (p) => <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/></svg>;
const IcSun = (p) => <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const IcMoon = (p) => <Ic {...p} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />;

// ─── Themes ──────────────────────────────────────────────────
const themes = {
  dark: {
    mode: "dark", bg: "#0f0f13", card: "#1a1a22", border: "#2a2a38",
    primary: "#6c63ff", primaryLight: "#8b83ff", primaryBg: "rgba(108,99,255,0.08)", primaryBorder: "rgba(108,99,255,0.25)",
    success: "#22c55e", successBg: "rgba(34,197,94,0.1)",
    danger: "#ef4444", dangerBg: "rgba(239,68,68,0.1)",
    warning: "#f59e0b", warningBg: "rgba(245,158,11,0.1)",
    text: "#e8e6f0", textSec: "#8b8a9a", textMut: "#5f5e70",
    overlay: "rgba(0,0,0,0.7)",
    cbLight: { backgroundColor: "#d0d0d8", sq: "#bfbfc8" },
    cbDark: { backgroundColor: "#15151f", sq: "#1e1e2a" },
  },
  light: {
    mode: "light", bg: "#f4f4f7", card: "#ffffff", border: "#dddde3",
    primary: "#5b52e0", primaryLight: "#6c63ff", primaryBg: "rgba(91,82,224,0.06)", primaryBorder: "rgba(91,82,224,0.2)",
    success: "#16a34a", successBg: "rgba(22,163,74,0.08)",
    danger: "#dc2626", dangerBg: "rgba(220,38,38,0.08)",
    warning: "#d97706", warningBg: "rgba(217,119,6,0.08)",
    text: "#1a1a2e", textSec: "#5f5e70", textMut: "#9b9aab",
    overlay: "rgba(0,0,0,0.4)",
    cbLight: { backgroundColor: "#e8e8ee", sq: "#d8d8e0" },
    cbDark: { backgroundColor: "#2a2a36", sq: "#222230" },
  },
};

const ThemeCtx = createContext(themes.dark);
function useT() { return useContext(ThemeCtx); }

// Adaptive checkerboard: light bg for dark images, dark bg for light images
function checkerStyle(t, brightness) {
  const isDarkImage = (brightness ?? 128) < 128;
  const cb = isDarkImage ? t.cbLight : t.cbDark;
  return {
    backgroundImage: `linear-gradient(45deg, ${cb.sq} 25%, transparent 25%), linear-gradient(-45deg, ${cb.sq} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${cb.sq} 75%), linear-gradient(-45deg, transparent 75%, ${cb.sq} 75%)`,
    backgroundSize: "16px 16px", backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
    backgroundColor: cb.backgroundColor,
  };
}

// ─── Dynamic styles ──────────────────────────────────────────
function makeStyles(t) {
  const font = "'DM Sans', system-ui, sans-serif";
  const fontD = "'Space Grotesk', 'DM Sans', system-ui, sans-serif";
  return {
    page: { minHeight: "100vh", width: "100vw", background: t.bg, color: t.text, fontFamily: font, fontSize: 14, transition: "background 0.25s, color 0.25s" },
    container: { width: "100%", margin: "0 auto", padding: "32px clamp(16px, 4vw, 48px)" },
    card: { background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, marginBottom: 12, transition: "background 0.25s, border-color 0.25s" },
    cardHi: { background: t.primaryBg, border: `1px solid ${t.primaryBorder}`, borderRadius: 12, padding: 20, marginBottom: 12 },
    input: { width: "100%", padding: "10px 14px", background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 14, fontFamily: font, outline: "none", transition: "border-color 0.15s, background 0.25s" },
    textarea: { width: "100%", minHeight: 140, padding: "10px 14px", background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 13, fontFamily: "'JetBrains Mono', monospace", outline: "none", resize: "vertical", lineHeight: 1.6 },
    btn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 20px", borderRadius: 8, fontSize: 14, fontWeight: 600, fontFamily: font, cursor: "pointer", border: "none", transition: "all 0.15s" },
    btnP: { background: t.primary, color: "#fff" },
    btnO: { background: "transparent", color: t.text, border: `1px solid ${t.border}` },
    btnG: { background: "transparent", color: t.textSec, border: "none", padding: "8px 12px" },
    btnD: { background: t.dangerBg, color: t.danger, border: `1px solid rgba(239,68,68,0.2)` },
    btnSm: { padding: "6px 14px", fontSize: 13 },
    btnIc: { padding: 8, width: 36, height: 36 },
    badge: { display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: t.primaryBg, color: t.primaryLight },
    label: { display: "block", fontSize: 13, fontWeight: 500, color: t.textSec, marginBottom: 6 },
    h1: { fontSize: 28, fontWeight: 700, fontFamily: fontD, color: t.text, margin: 0, letterSpacing: -0.5 },
    h2: { fontSize: 20, fontWeight: 600, fontFamily: fontD, color: t.text, margin: 0 },
    h3: { fontSize: 15, fontWeight: 600, color: t.text, margin: 0 },
    sub: { fontSize: 13, color: t.textSec, margin: 0 },
    progress: { width: "100%", height: 6, background: t.border, borderRadius: 3, overflow: "hidden" },
    pBar: (pct) => ({ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${t.primary}, ${t.primaryLight})`, borderRadius: 3, transition: "width 0.4s ease" }),
    overlay: { position: "fixed", inset: 0, background: t.overlay, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20, backdropFilter: "blur(4px)" },
    dialog: { background: t.card, border: `1px solid ${t.border}`, borderRadius: 16, padding: 24, maxWidth: 520, width: "100%", maxHeight: "90vh", overflowY: "auto" },
    dialogW: { maxWidth: 680 },
    row: { display: "flex", alignItems: "center", gap: 12 },
    col: { display: "flex", flexDirection: "column", gap: 12 },
    grid2: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 },
  };
}

// ─── Shared Components ───────────────────────────────────────
function Btn({ children, variant = "primary", small, icon, disabled, style, ...props }) {
  const t = useT(), st = makeStyles(t);
  const base = { ...st.btn };
  if (variant === "primary") Object.assign(base, st.btnP);
  else if (variant === "outline") Object.assign(base, st.btnO);
  else if (variant === "ghost") Object.assign(base, st.btnG);
  else if (variant === "danger") Object.assign(base, st.btnD);
  if (small) Object.assign(base, st.btnSm);
  if (icon) Object.assign(base, st.btnIc);
  if (disabled) { base.opacity = 0.4; base.pointerEvents = "none"; }
  return <button style={{ ...base, ...style }} disabled={disabled} {...props}>{children}</button>;
}
function Dlg({ open, onClose, wide, children }) {
  const t = useT(), st = makeStyles(t);
  if (!open) return null;
  return <div style={st.overlay} onClick={onClose}><div style={{ ...st.dialog, ...(wide ? st.dialogW : {}) }} onClick={(e) => e.stopPropagation()}>{children}</div></div>;
}
function Prog({ value }) { const t = useT(), st = makeStyles(t); return <div style={st.progress}><div style={st.pBar(value)} /></div>; }
function ImgBox({ src, brightness, height = 100, fit = "contain", style }) {
  const t = useT();
  return <div style={{ ...checkerStyle(t, brightness), overflow: "hidden", ...style }}><img src={src} alt="" style={{ width: "100%", height, objectFit: fit, display: "block" }} /></div>;
}

// ═══════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════
export default function PracticePad() {
  const [data, setData] = useState(() => loadData());
  const [mode, setMode] = useState(() => localStorage.getItem(THEME_KEY) || "dark");
  const [view, setView] = useState("categories"); // categories | groups | detail | quiz
  const [selCatId, setSelCatId] = useState(null);
  const [selId, setSelId] = useState(null);
  const [qMode, setQMode] = useState(null);
  const [qKey, setQKey] = useState(0);

  useEffect(() => { saveData(data); }, [data]);
  useEffect(() => { localStorage.setItem(THEME_KEY, mode); }, [mode]);

  const t = themes[mode];
  const st = makeStyles(t);
  const folder = data.folders.find((f) => f.id === selId);
  const fWords = useMemo(() => data.wordPairs.filter((w) => w.folderId === selId), [data.wordPairs, selId]);
  const fImgs = useMemo(() => data.imageItems.filter((i) => i.folderId === selId), [data.imageItems, selId]);
  const catFolders = useMemo(() => data.folders.filter((f) => f.categoryId === selCatId), [data.folders, selCatId]);

  // Category CRUD
  const addCat = (c) => setData((d) => ({ ...d, categories: [c, ...d.categories] }));
  const delCat = (id) => setData((d) => ({
    ...d,
    categories: d.categories.filter((c) => c.id !== id),
    folders: d.folders.filter((f) => f.categoryId !== id),
    wordPairs: d.wordPairs.filter((w) => !d.folders.find((f) => f.categoryId === id && f.id === w.folderId)),
    imageItems: d.imageItems.filter((i) => !d.folders.find((f) => f.categoryId === id && f.id === i.folderId)),
  }));
  const renameCat = (id, name) => setData((d) => ({ ...d, categories: d.categories.map((c) => c.id === id ? { ...c, name } : c) }));

  // Folder/group CRUD
  const addFolder = (f) => setData((d) => ({ ...d, folders: [f, ...d.folders] }));
  const delFolder = (id) => setData((d) => ({ folders: d.folders.filter((f) => f.id !== id), wordPairs: d.wordPairs.filter((w) => w.folderId !== id), imageItems: d.imageItems.filter((i) => i.folderId !== id), categories: d.categories }));
  const addWords = (p) => setData((d) => ({ ...d, wordPairs: [...d.wordPairs, ...p] }));
  const delWord = (id) => setData((d) => ({ ...d, wordPairs: d.wordPairs.filter((w) => w.id !== id) }));
  const updateWord = (id, changes) => setData((d) => ({ ...d, wordPairs: d.wordPairs.map((w) => w.id === id ? { ...w, ...changes } : w) }));
  const addImgs = (items) => setData((d) => ({ ...d, imageItems: [...d.imageItems, ...items] }));
  const delImg = (id) => setData((d) => ({ ...d, imageItems: d.imageItems.filter((i) => i.id !== id) }));
  const updateImg = (id, changes) => setData((d) => ({ ...d, imageItems: d.imageItems.map((i) => i.id === id ? { ...i, ...changes } : i) }));

  const openCat = (id) => { setSelCatId(id); setView("groups"); };
  const openFolder = (id) => { setSelId(id); setView("detail"); };
  const goBack = () => {
    if (view === "quiz") { setView("detail"); setQMode(null); }
    else if (view === "detail") { setView("groups"); setSelId(null); }
    else if (view === "groups") { setView("categories"); setSelCatId(null); }
  };
  const startQuiz = (m) => { setQMode(m); setQKey((k) => k + 1); setView("quiz"); };
  const toggleMode = () => setMode((m) => m === "dark" ? "light" : "dark");

  return (
    <ThemeCtx.Provider value={t}>
      <style>{`*, *::before, *::after { box-sizing: border-box; } body { margin: 0; } @media (max-width: 600px) { .pp-grid { grid-template-columns: 1fr !important; } }`}</style>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={st.page}>
        <div style={st.container}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button onClick={toggleMode} title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 20, padding: "6px 14px", cursor: "pointer", color: t.textSec, display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, fontFamily: "'DM Sans', sans-serif", transition: "all 0.25s" }}>
              {mode === "dark" ? <IcMoon size={14} /> : <IcSun size={14} />}
              {mode === "dark" ? "Dark" : "Light"}
            </button>
          </div>

          {view === "categories" && <CategoryList categories={data.categories} folders={data.folders} wordPairs={data.wordPairs} imageItems={data.imageItems} onSelect={openCat} onAdd={addCat} onDelete={delCat} onRename={renameCat} />}
          {view === "groups" && <GroupList category={data.categories.find((c) => c.id === selCatId)} folders={catFolders} wordPairs={data.wordPairs} imageItems={data.imageItems} onSelect={openFolder} onAdd={(f) => addFolder({ ...f, categoryId: selCatId })} onDelete={delFolder} onBack={goBack} />}
          {view === "detail" && folder && <FolderDetail folder={folder} words={fWords} images={fImgs} onBack={goBack} onStartQuiz={startQuiz} onAddWords={addWords} onDeleteWord={delWord} onUpdateWord={updateWord} onAddImages={addImgs} onDeleteImage={delImg} onUpdateImage={updateImg} />}
          {view === "quiz" && qMode === "translate" && folder && <TranslateQuiz key={qKey} folder={folder} words={fWords} onBack={goBack} onUpdateWord={updateWord} />}
          {view === "quiz" && qMode === "match" && folder && <MatchQuiz key={qKey} folder={folder} words={fWords} onBack={goBack} />}
          {view === "quiz" && qMode === "image-match" && <ImageMatchQuiz key={qKey} images={fImgs} onBack={goBack} />}
          {view === "quiz" && qMode === "image-write" && <ImageWriteQuiz key={qKey} images={fImgs} onBack={goBack} />}
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════
// CATEGORY LIST (top level)
// ═══════════════════════════════════════════════════════════════
function CategoryList({ categories, folders, wordPairs, imageItems, onSelect, onAdd, onDelete, onRename }) {
  const t = useT(), st = makeStyles(t);
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");

  const create = () => { if (!name.trim()) return; onAdd({ id: uid(), name: name.trim(), createdAt: new Date().toISOString() }); setName(""); setShow(false); };
  const saveRename = () => { if (!editName.trim()) return; onRename(editId, editName.trim()); setEditId(null); };

  return (
    <div style={st.col}>
      <div style={{ ...st.row, justifyContent: "space-between", marginBottom: 8 }}>
        <div><h1 style={st.h1}>PracticePad</h1><p style={{ ...st.sub, marginTop: 4 }}>Organize your practice into folders</p></div>
        <Btn onClick={() => setShow(true)}><IcFolder size={16} /> New Folder</Btn>
      </div>
      {categories.length === 0 ? (
        <div style={{ ...st.card, textAlign: "center", padding: "48px 24px", borderStyle: "dashed" }}>
          <p style={{ fontSize: 32, margin: "0 0 8px" }}>📁</p>
          <p style={{ ...st.h3, marginBottom: 4 }}>No folders yet</p>
          <p style={{ ...st.sub, marginBottom: 16 }}>Create a folder to organize your practice groups</p>
          <Btn variant="outline" onClick={() => setShow(true)}><IcFolder size={16} /> Create Folder</Btn>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {categories.map((c) => {
            const grps = folders.filter((f) => f.categoryId === c.id);
            const totalItems = grps.reduce((sum, f) => sum + (f.type === "language" ? wordPairs.filter((w) => w.folderId === f.id).length : imageItems.filter((i) => i.folderId === f.id).length), 0);
            return (
              <div key={c.id} onClick={() => onSelect(c.id)} style={{ ...st.card, cursor: "pointer", position: "relative" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.primaryBorder; e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = "none"; }}>
                <div style={{ ...st.row, justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontSize: 24 }}>📁</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={(e) => { e.stopPropagation(); setEditId(c.id); setEditName(c.name); }}
                      style={{ background: "none", border: "none", color: t.textMut, cursor: "pointer", padding: 4, opacity: 0.5, transition: "opacity 0.15s" }}
                      onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.5}>✏️</button>
                    <button onClick={(e) => { e.stopPropagation(); if (grps.length > 0 ? confirm(`Delete "${c.name}" and its ${grps.length} group(s)?`) : true) onDelete(c.id); }}
                      style={{ background: "none", border: "none", color: t.textMut, cursor: "pointer", padding: 4, opacity: 0.5, transition: "opacity 0.15s" }}
                      onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.5}><IcTrash size={14} /></button>
                  </div>
                </div>
                {editId === c.id ? (
                  <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setEditId(null); }}
                      style={{ ...st.input, flex: 1, fontSize: 13, padding: "6px 8px" }} autoFocus />
                    <Btn small icon style={{ width: 28, height: 28, padding: 0 }} onClick={saveRename}><IcCheck size={14} /></Btn>
                  </div>
                ) : (
                  <h3 style={{ ...st.h3, marginBottom: 4 }}>{c.name}</h3>
                )}
                <div style={{ ...st.row, marginTop: 8, gap: 6 }}>
                  <span style={st.badge}>{grps.length} {grps.length === 1 ? "group" : "groups"}</span>
                  <span style={st.badge}>{totalItems} {totalItems === 1 ? "item" : "items"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Dlg open={show} onClose={() => setShow(false)}>
        <h2 style={{ ...st.h2, marginBottom: 4 }}>Create Folder</h2>
        <p style={{ ...st.sub, marginBottom: 20 }}>Folders help you organize practice groups by topic or subject.</p>
        <div style={st.col}>
          <div><label style={st.label}>Folder Name</label><input style={st.input} placeholder="e.g. Spanish, Biology, Music..." value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} autoFocus /></div>
        </div>
        <div style={{ ...st.row, justifyContent: "flex-end", marginTop: 20, gap: 8 }}>
          <Btn variant="ghost" onClick={() => setShow(false)}>Cancel</Btn>
          <Btn disabled={!name.trim()} onClick={create}>Create Folder</Btn>
        </div>
      </Dlg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GROUP LIST (inside a category)
// ═══════════════════════════════════════════════════════════════
function GroupList({ category, folders, wordPairs, imageItems, onSelect, onAdd, onDelete, onBack }) {
  const t = useT(), st = makeStyles(t);
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("language");
  const [lf, setLf] = useState("");
  const [lt, setLt] = useState("");

  const create = () => {
    if (!name.trim()) return;
    onAdd({ id: uid(), name: name.trim(), type, langFrom: type === "language" ? lf.trim() : null, langTo: type === "language" ? lt.trim() : null, createdAt: new Date().toISOString() });
    setName(""); setLf(""); setLt(""); setShow(false);
  };

  return (
    <div style={st.col}>
      <div style={{ ...st.row, justifyContent: "space-between", marginBottom: 8 }}>
        <div style={st.row}>
          <Btn variant="ghost" icon onClick={onBack}><IcBack /></Btn>
          <div><h1 style={st.h1}>{category?.name || "Groups"}</h1><p style={{ ...st.sub, marginTop: 4 }}>{folders.length} {folders.length === 1 ? "group" : "groups"}</p></div>
        </div>
        <Btn onClick={() => setShow(true)}><IcPlus size={16} /> New Group</Btn>
      </div>
      {folders.length === 0 ? (
        <div style={{ ...st.card, textAlign: "center", padding: "48px 24px", borderStyle: "dashed" }}>
          <p style={{ fontSize: 32, margin: "0 0 8px" }}>📂</p>
          <p style={{ ...st.h3, marginBottom: 4 }}>No groups yet</p>
          <p style={{ ...st.sub, marginBottom: 16 }}>Create your first practice group in this folder</p>
          <Btn variant="outline" onClick={() => setShow(true)}><IcPlus size={16} /> Create Group</Btn>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {folders.map((f) => {
            const cnt = f.type === "language" ? wordPairs.filter((w) => w.folderId === f.id).length : imageItems.filter((i) => i.folderId === f.id).length;
            return (
              <div key={f.id} onClick={() => onSelect(f.id)} style={{ ...st.card, cursor: "pointer", position: "relative" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.primaryBorder; e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = "none"; }}>
                <div style={{ ...st.row, justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontSize: 24 }}>{f.type === "language" ? "🌐" : "🖼️"}</span>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(f.id); }}
                    style={{ background: "none", border: "none", color: t.textMut, cursor: "pointer", padding: 4, opacity: 0.5, transition: "opacity 0.15s" }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.5}>
                    <IcTrash size={14} />
                  </button>
                </div>
                <h3 style={{ ...st.h3, marginBottom: 4 }}>{f.name}</h3>
                <p style={st.sub}>{f.type === "language" ? `${f.langFrom} → ${f.langTo}` : "Image Match"}</p>
                <div style={{ ...st.row, marginTop: 10, gap: 6 }}><span style={st.badge}>{cnt} {cnt === 1 ? "item" : "items"}</span></div>
              </div>
            );
          })}
        </div>
      )}
      <Dlg open={show} onClose={() => setShow(false)}>
        <h2 style={{ ...st.h2, marginBottom: 4 }}>Create Practice Group</h2>
        <p style={{ ...st.sub, marginBottom: 20 }}>Set up a new group for language or image study.</p>
        <div style={st.col}>
          <div><label style={st.label}>Group Name</label><input style={st.input} placeholder="e.g. Animals, Food, Colors..." value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label style={st.label}>Type</label>
            <div style={{ ...st.row, gap: 8 }}>
              <Btn variant={type === "language" ? "primary" : "outline"} onClick={() => setType("language")} style={{ flex: 1 }}>🌐 Language</Btn>
              <Btn variant={type === "image_match" ? "primary" : "outline"} onClick={() => setType("image_match")} style={{ flex: 1 }}>🖼️ Image Match</Btn>
            </div>
          </div>
          {type === "language" && (
            <div style={st.grid2}>
              <div><label style={st.label}>From Language</label><input style={st.input} placeholder="e.g. English" value={lf} onChange={(e) => setLf(e.target.value)} /></div>
              <div><label style={st.label}>To Language</label><input style={st.input} placeholder="e.g. Spanish" value={lt} onChange={(e) => setLt(e.target.value)} /></div>
            </div>
          )}
        </div>
        <div style={{ ...st.row, justifyContent: "flex-end", marginTop: 20, gap: 8 }}>
          <Btn variant="ghost" onClick={() => setShow(false)}>Cancel</Btn>
          <Btn disabled={!name.trim()} onClick={create}>Create Group</Btn>
        </div>
      </Dlg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FOLDER DETAIL
// ═══════════════════════════════════════════════════════════════
function FolderDetail({ folder, words, images, onBack, onStartQuiz, onAddWords, onDeleteWord, onUpdateWord, onAddImages, onDeleteImage, onUpdateImage }) {
  const t = useT(), st = makeStyles(t);
  const [wf, setWf] = useState(""); const [wt, setWt] = useState("");
  const [showBP, setShowBP] = useState(false);
  const [showBI, setShowBI] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editUrl, setEditUrl] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [editWId, setEditWId] = useState(null);
  const [editWFrom, setEditWFrom] = useState("");
  const [editWTo, setEditWTo] = useState("");
  const [previewImg, setPreviewImg] = useState(null);

  const addWord = () => { if (!wf.trim() || !wt.trim()) return; onAddWords([{ id: uid(), folderId: folder.id, wordFrom: wf.trim(), wordTo: wt.trim() }]); setWf(""); setWt(""); };
  const canT = words.length >= 1, canM = words.length >= 5, canIM = images.length >= 5;

  const startEditWord = (p) => { setEditWId(p.id); setEditWFrom(p.wordFrom); setEditWTo(p.wordTo); };
  const saveEditWord = () => { if (!editWFrom.trim() || !editWTo.trim()) return; onUpdateWord(editWId, { wordFrom: editWFrom.trim(), wordTo: editWTo.trim() }); setEditWId(null); };

  const startEdit = (it) => { setEditId(it.id); setEditUrl(it.imageUrl); setEditAnswer(it.answer); };
  const [editSaving, setEditSaving] = useState(false);
  const saveEdit = async () => {
    if (!editUrl.trim() || !editAnswer.trim()) return;
    const url = editUrl.trim();
    const currentImg = images.find((i) => i.id === editId);
    if (url !== currentImg?.imageUrl) {
      setEditSaving(true);
      const { dataUrl, brightness } = await processUrl(url);
      onUpdateImage(editId, { imageUrl: dataUrl, brightness, answer: editAnswer.trim() });
      setEditSaving(false);
    } else {
      onUpdateImage(editId, { answer: editAnswer.trim() });
    }
    setEditId(null);
  };
  const cancelEdit = () => setEditId(null);

  return (
    <div style={st.col}>
      <div style={st.row}>
        <Btn variant="ghost" icon onClick={onBack}><IcBack /></Btn>
        <div style={{ flex: 1 }}><h2 style={st.h2}>{folder.name}</h2><p style={st.sub}>{folder.type === "language" ? `${folder.langFrom} → ${folder.langTo}` : "Image Practice"}</p></div>
        <span style={st.badge}>{folder.type === "language" ? words.length : images.length} items</span>
      </div>

      <div style={st.cardHi}>
        <h3 style={{ ...st.h3, marginBottom: 4 }}>Start Practice</h3>
        <p style={{ ...st.sub, marginBottom: 14 }}>Choose a practice mode to begin studying</p>
        <div style={{ ...st.row, flexWrap: "wrap", gap: 8 }}>
          {folder.type === "language" && <>
            <Btn disabled={!canT} onClick={() => onStartQuiz("translate")}>✍️ Writing Practice</Btn>
            <Btn variant="outline" disabled={!canM} onClick={() => onStartQuiz("match")}>🔀 Matching Practice</Btn>
          </>}
          {folder.type === "image_match" && <>
            <Btn disabled={images.length < 1} onClick={() => onStartQuiz("image-write")}>✍️ Writing Practice</Btn>
            <Btn variant="outline" disabled={!canIM} onClick={() => onStartQuiz("image-match")}>🖼️ Image Match</Btn>
          </>}
        </div>
        {folder.type === "language" && !canT && <p style={{ ...st.sub, marginTop: 10 }}>Add at least 1 word pair to start writing practice.</p>}
        {folder.type === "language" && canT && !canM && <p style={{ ...st.sub, marginTop: 10 }}>Add at least 5 word pairs to unlock matching.</p>}
        {folder.type === "image_match" && images.length < 1 && <p style={{ ...st.sub, marginTop: 10 }}>Add at least 1 image to start writing practice.</p>}
        {folder.type === "image_match" && images.length >= 1 && !canIM && <p style={{ ...st.sub, marginTop: 10 }}>Add at least 5 images to unlock image match.</p>}
      </div>

      {folder.type === "language" && (
        <div style={st.card}>
          <div style={{ ...st.row, justifyContent: "space-between", marginBottom: 14 }}>
            <div><h3 style={st.h3}>Word Pairs</h3><p style={st.sub}>Add {folder.langFrom} → {folder.langTo} translations</p></div>
            <Btn variant="outline" small onClick={() => setShowBP(true)}>📋 Bulk Paste</Btn>
          </div>
          <div style={{ ...st.row, gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <input style={{ ...st.input, flex: "1 1 140px" }} placeholder={folder.langFrom || "Word"} value={wf} onChange={(e) => setWf(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWord()} />
            <input style={{ ...st.input, flex: "1 1 140px" }} placeholder={folder.langTo || "Translation"} value={wt} onChange={(e) => setWt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWord()} />
            <Btn icon disabled={!wf.trim() || !wt.trim()} onClick={addWord}><IcPlus /></Btn>
          </div>
          {words.length > 0 ? (
            <div style={{ maxHeight: 320, overflowY: "auto", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg }}>
              {words.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: editWId === p.id ? "8px 10px" : "10px 14px", borderBottom: `1px solid ${t.border}`, transition: "background 0.15s", background: editWId === p.id ? t.primaryBg : "transparent" }}>
                  {editWId === p.id ? (<>
                    <input value={editWFrom} onChange={(e) => setEditWFrom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEditWord()} style={{ ...st.input, flex: 1, fontSize: 13, padding: "6px 8px" }} autoFocus />
                    <span style={{ color: t.textMut, fontSize: 12 }}>→</span>
                    <input value={editWTo} onChange={(e) => setEditWTo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEditWord()} style={{ ...st.input, flex: 1, fontSize: 13, padding: "6px 8px" }} />
                    <Btn small icon style={{ width: 28, height: 28, padding: 0 }} onClick={saveEditWord}><IcCheck size={14} /></Btn>
                    <button onClick={() => setEditWId(null)} style={{ background: "none", border: "none", color: t.textMut, cursor: "pointer", padding: 4 }}><IcX size={14} /></button>
                  </>) : (<>
                    <span onDoubleClick={() => startEditWord(p)} style={{ flex: 1, fontSize: 13, fontWeight: 500, cursor: "default" }} title="Double-click to edit">{p.wordFrom}</span>
                    <span style={{ color: t.textMut, fontSize: 12 }}>→</span>
                    <span onDoubleClick={() => startEditWord(p)} style={{ flex: 1, fontSize: 13, cursor: "default" }} title="Double-click to edit">{p.wordTo}</span>
                    <button onClick={() => onDeleteWord(p.id)} style={{ background: "none", border: "none", color: t.textMut, cursor: "pointer", padding: 4, opacity: 0.4 }}
                      onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.4}><IcX size={14} /></button>
                  </>)}
                </div>
              ))}
            </div>
          ) : <div style={{ textAlign: "center", padding: "32px 16px", border: `1px dashed ${t.border}`, borderRadius: 8 }}><p style={st.sub}>No words yet. Add one above or use Bulk Paste.</p></div>}
        </div>
      )}

      {folder.type === "image_match" && (
        <div style={st.card}>
          <div style={{ ...st.row, justifyContent: "space-between", marginBottom: 14 }}>
            <div><h3 style={st.h3}>Image Items</h3><p style={st.sub}>Add images via URL or upload files</p></div>
            <Btn variant="outline" small onClick={() => setShowBI(true)}>📤 Add Images</Btn>
          </div>
          {images.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {images.map((it) => (
                <div key={it.id} style={{ borderRadius: 10, border: `1px solid ${editId === it.id ? t.primary : t.border}`, overflow: "hidden", background: t.bg, transition: "border-color 0.15s" }}>
                  {editId === it.id ? (
                    <div style={{ padding: 10 }}>
                      <label style={{ ...st.label, fontSize: 11 }}>Image URL</label>
                      <input style={{ ...st.input, fontSize: 11, padding: "6px 8px", marginBottom: 6 }} value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder="https://..." />
                      <label style={{ ...st.label, fontSize: 11 }}>Answer</label>
                      <input style={{ ...st.input, fontSize: 11, padding: "6px 8px", marginBottom: 8 }} value={editAnswer} onChange={(e) => setEditAnswer(e.target.value)} />
                      <div style={{ display: "flex", gap: 4 }}>
                        <Btn small disabled={editSaving} style={{ flex: 1, padding: "4px 8px", fontSize: 11 }} onClick={saveEdit}>{editSaving ? "..." : "Save"}</Btn>
                        <Btn small variant="ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={cancelEdit}>Cancel</Btn>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div onClick={() => setPreviewImg(it)} style={{ cursor: "pointer" }}>
                        <ImgBox src={it.imageUrl} brightness={it.brightness} height={100} fit="cover" />
                      </div>
                      <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.answer}</span>
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          <button onClick={() => startEdit(it)} style={{ background: "none", border: "none", color: t.textMut, cursor: "pointer", padding: 2, opacity: 0.4 }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.4}>✏️</button>
                          <button onClick={() => onDeleteImage(it.id)} style={{ background: "none", border: "none", color: t.textMut, cursor: "pointer", padding: 2, opacity: 0.4 }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.4}><IcTrash size={12} /></button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : <div style={{ textAlign: "center", padding: "32px 16px", border: `1px dashed ${t.border}`, borderRadius: 8 }}><p style={st.sub}>No images yet. Click "Add Images" to get started.</p></div>}
        </div>
      )}

      {previewImg && (() => {
        const pi = images.findIndex((i) => i.id === previewImg.id);
        const hasPrev = pi > 0, hasNext = pi < images.length - 1;
        const goPrev = (e) => { e.stopPropagation(); if (hasPrev) setPreviewImg(images[pi - 1]); };
        const goNext = (e) => { e.stopPropagation(); if (hasNext) setPreviewImg(images[pi + 1]); };
        return (
          <div onClick={() => setPreviewImg(null)} onKeyDown={(e) => { if (e.key === "Escape") setPreviewImg(null); if (e.key === "ArrowLeft") { e.stopPropagation(); if (hasPrev) setPreviewImg(images[pi - 1]); } if (e.key === "ArrowRight") { e.stopPropagation(); if (hasNext) setPreviewImg(images[pi + 1]); } }} tabIndex={0} ref={(el) => el?.focus()}
            style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 24, outline: "none" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", cursor: "default", display: "flex", alignItems: "center", gap: 16 }}>
              <button onClick={goPrev} disabled={!hasPrev} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, color: hasPrev ? "#fff" : "rgba(255,255,255,0.2)", cursor: hasPrev ? "pointer" : "default", fontSize: 20, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
              <div style={{ ...checkerStyle(t, previewImg.brightness), borderRadius: 12, overflow: "hidden", border: "2px solid rgba(255,255,255,0.2)", display: "inline-block" }}>
                <img src={previewImg.imageUrl} alt={previewImg.answer} style={{ width: "auto", height: "min(60vh, 320px)", objectFit: "contain", display: "block" }} />
              </div>
              <button onClick={goNext} disabled={!hasNext} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, color: hasNext ? "#fff" : "rgba(255,255,255,0.2)", cursor: hasNext ? "pointer" : "default", fontSize: 20, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
            </div>
            <p style={{ color: "#fff", fontSize: 16, fontWeight: 600, marginTop: 14, fontFamily: "'DM Sans', sans-serif" }}>{previewImg.answer}</p>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 6, fontFamily: "'DM Sans', sans-serif" }}>{pi + 1} / {images.length} · Click outside or press Esc to close</p>
          </div>
        );
      })()}

      <BulkPasteDlg open={showBP} onClose={() => setShowBP(false)} folder={folder} onAdd={onAddWords} />
      <BulkImageDlg open={showBI} onClose={() => setShowBI(false)} folder={folder} onAdd={onAddImages} />
    </div>
  );
}

// ─── Bulk Paste Dialog ───────────────────────────────────────
function BulkPasteDlg({ open, onClose, folder, onAdd }) {
  const t = useT(), st = makeStyles(t);
  const [wt, setWt] = useState(""); const [mt, setMt] = useState("");
  const wl = wt.split("\n").filter((l) => l.trim()); const ml = mt.split("\n").filter((l) => l.trim());
  const cnt = Math.min(wl.length, ml.length);
  const mis = wl.length !== ml.length && wl.length > 0 && ml.length > 0;

  const go = () => {
    if (cnt === 0) return;
    const pairs = []; for (let i = 0; i < cnt; i++) pairs.push({ id: uid(), folderId: folder.id, wordFrom: wl[i].trim(), wordTo: ml[i].trim() });
    onAdd(pairs); setWt(""); setMt(""); onClose();
  };

  return (
    <Dlg open={open} onClose={onClose} wide>
      <h2 style={{ ...st.h2, marginBottom: 4 }}>Bulk Paste Words</h2>
      <p style={{ ...st.sub, marginBottom: 20 }}>Paste words on the left, meanings on the right. Matched by line number.</p>
      <div style={st.grid2}>
        <div><label style={st.label}>{folder.langFrom || "Words"} (one per line)</label><textarea style={st.textarea} placeholder={"cat\ndog\nhouse"} value={wt} onChange={(e) => setWt(e.target.value)} /><p style={{ ...st.sub, marginTop: 4, fontSize: 12 }}>{wl.length} words</p></div>
        <div><label style={st.label}>{folder.langTo || "Meanings"} (one per line)</label><textarea style={st.textarea} placeholder={"gato\nperro\ncasa"} value={mt} onChange={(e) => setMt(e.target.value)} /><p style={{ ...st.sub, marginTop: 4, fontSize: 12 }}>{ml.length} meanings</p></div>
      </div>
      {mis && <div style={{ marginTop: 10, padding: "8px 12px", background: t.warningBg, border: `1px solid rgba(217,119,6,0.2)`, borderRadius: 8 }}><p style={{ fontSize: 12, color: t.warning, margin: 0 }}>⚠️ Line count mismatch — only first {cnt} pairs imported.</p></div>}
      {cnt > 0 && (
        <div style={{ marginTop: 14 }}><label style={st.label}>Preview ({cnt} pairs)</label>
          <div style={{ maxHeight: 140, overflowY: "auto", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg }}>
            {Array.from({ length: Math.min(cnt, 10) }, (_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: `1px solid ${t.border}`, fontSize: 12 }}>
                <span style={{ color: t.textMut, width: 24 }}>{i + 1}.</span><span style={{ flex: 1, fontWeight: 500 }}>{wl[i]}</span><span style={{ color: t.textMut }}>→</span><span style={{ flex: 1 }}>{ml[i]}</span>
              </div>))}
            {cnt > 10 && <div style={{ padding: "6px 12px", fontSize: 12, color: t.textMut }}>... and {cnt - 10} more</div>}
          </div>
        </div>
      )}
      <div style={{ ...st.row, justifyContent: "flex-end", marginTop: 20, gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={cnt === 0} onClick={go}>Import {cnt} Pairs</Btn>
      </div>
    </Dlg>
  );
}

// ─── Bulk Image Upload Dialog ────────────────────────────────
function BulkImageDlg({ open, onClose, folder, onAdd }) {
  const t = useT(), st = makeStyles(t);
  const [tab, setTab] = useState("url"); // "url" | "file"
  // URL mode
  const [urlText, setUrlText] = useState("");
  const [ansText, setAnsText] = useState("");
  // File mode
  const [imgs, setImgs] = useState([]);
  const [fAnsText, setFAnsText] = useState("");
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef(null);
  const [dragIdx, setDragIdx] = useState(null);

  const urls = urlText.split("\n").filter((l) => l.trim());
  const answers = ansText.split("\n").filter((l) => l.trim());
  const fAnswers = fAnsText.split("\n").filter((l) => l.trim());

  // URL import
  const canImportUrl = urls.length > 0 && answers.length === urls.length;
  const [urlProcessing, setUrlProcessing] = useState(false);
  const doImportUrl = async () => {
    if (!canImportUrl) return;
    setUrlProcessing(true);
    const items = [];
    for (let i = 0; i < urls.length; i++) {
      const { dataUrl, brightness } = await processUrl(urls[i].trim());
      items.push({ id: uid(), folderId: folder.id, imageUrl: dataUrl, brightness, answer: answers[i].trim() });
    }
    onAdd(items);
    setUrlProcessing(false);
    setUrlText(""); setAnsText(""); onClose();
  };

  // File handling
  const handleFiles = async (fl) => {
    const files = Array.from(fl); if (!files.length) return;
    setProcessing(true);
    const items = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      try { const { dataUrl, brightness } = await processImage(f); items.push({ id: uid(), dataUrl, brightness, name: f.name }); }
      catch (e) { console.warn("Skip:", f.name, e); }
    }
    setImgs((p) => [...p, ...items]);
    setProcessing(false);
  };

  const move = (from, to) => {
    if (to < 0 || to >= imgs.length) return;
    setImgs((p) => { const n = [...p]; const [it] = n.splice(from, 1); n.splice(to, 0, it); return n; });
  };
  const onDS = (i) => setDragIdx(i);
  const onDO = (e, i) => { e.preventDefault(); if (dragIdx !== null && dragIdx !== i) { move(dragIdx, i); setDragIdx(i); } };
  const onDE = () => setDragIdx(null);

  const canImportFile = imgs.length > 0 && fAnswers.length === imgs.length;
  const doImportFile = () => {
    if (!canImportFile) return;
    onAdd(imgs.map((img, i) => ({ id: uid(), folderId: folder.id, imageUrl: img.dataUrl, brightness: img.brightness, answer: fAnswers[i].trim() })));
    setImgs([]); setFAnsText(""); onClose();
  };

  const reset = () => { setUrlText(""); setAnsText(""); setImgs([]); setFAnsText(""); };

  if (!open) return null;

  const tabStyle = (active) => ({
    padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
    border: "none", borderBottom: `2px solid ${active ? t.primary : "transparent"}`,
    background: "none", color: active ? t.text : t.textMut, transition: "all 0.15s",
    fontFamily: "'DM Sans', sans-serif",
  });

  return (
    <Dlg open={open} onClose={() => { onClose(); reset(); }} wide>
      <h2 style={{ ...st.h2, marginBottom: 4 }}>Add Images</h2>
      <p style={{ ...st.sub, marginBottom: 12 }}>Paste image URLs or upload files from your device.</p>

      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${t.border}`, marginBottom: 16 }}>
        <button style={tabStyle(tab === "url")} onClick={() => setTab("url")}>🔗 Paste URLs</button>
        <button style={tabStyle(tab === "file")} onClick={() => setTab("file")}>📁 Upload Files</button>
      </div>

      {tab === "url" && <>
        <div style={st.grid2}>
          <div>
            <label style={st.label}>Image URLs (one per line)</label>
            <textarea style={st.textarea} placeholder={"https://example.com/cat.png\nhttps://example.com/dog.png\nhttps://example.com/house.png"} value={urlText} onChange={(e) => setUrlText(e.target.value)} />
            <p style={{ ...st.sub, marginTop: 4, fontSize: 12 }}>{urls.length} URLs</p>
          </div>
          <div>
            <label style={st.label}>Answers (one per line, same order)</label>
            <textarea style={st.textarea} placeholder={"cat\ndog\nhouse"} value={ansText} onChange={(e) => setAnsText(e.target.value)} />
            <p style={{ ...st.sub, marginTop: 4, fontSize: 12 }}>{answers.length} answers{answers.length !== urls.length && urls.length > 0 && answers.length > 0 ? <span style={{ color: t.warning }}> — must match URL count</span> : ""}</p>
          </div>
        </div>
        {canImportUrl && (
          <div style={{ marginTop: 14 }}><label style={st.label}>Preview ({urls.length} items)</label>
            <div style={{ maxHeight: 140, overflowY: "auto", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg }}>
              {urls.slice(0, 8).map((u, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: `1px solid ${t.border}`, fontSize: 12 }}>
                  <span style={{ color: t.textMut, width: 24 }}>{i + 1}.</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: t.textSec }}>{u.trim()}</span>
                  <span style={{ color: t.textMut }}>→</span>
                  <span style={{ fontWeight: 600 }}>{answers[i]}</span>
                </div>
              ))}
              {urls.length > 8 && <div style={{ padding: "6px 12px", fontSize: 12, color: t.textMut }}>... and {urls.length - 8} more</div>}
            </div>
          </div>
        )}
        <div style={{ ...st.row, justifyContent: "flex-end", marginTop: 20, gap: 8 }}>
          <Btn variant="ghost" onClick={() => { onClose(); reset(); }}>Cancel</Btn>
          <Btn disabled={!canImportUrl || urlProcessing} onClick={doImportUrl}>{urlProcessing ? `Processing ${urls.length} images...` : `Import ${urls.length} Items`}</Btn>
        </div>
      </>}

      {tab === "file" && <>
        <div onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = t.primary; }}
          onDragLeave={(e) => { e.currentTarget.style.borderColor = t.border; }}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = t.border; handleFiles(e.dataTransfer.files); }}
          style={{ border: `2px dashed ${t.border}`, borderRadius: 12, padding: "32px 20px", textAlign: "center", cursor: "pointer", transition: "border-color 0.15s", marginBottom: 16 }}>
          <p style={{ fontSize: 28, margin: "0 0 6px" }}>📤</p>
          <p style={{ ...st.h3, marginBottom: 4 }}>{processing ? "Processing images..." : "Click or drag images here"}</p>
          <p style={st.sub}>{processing ? `${imgs.length} ready so far` : "Supports JPG, PNG, GIF, WebP — select multiple"}</p>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {imgs.length > 0 && (
          <div style={st.grid2}>
            <div><label style={st.label}>Images — drag to reorder ({imgs.length})</label>
              <div style={st.col}>
                {imgs.map((img, idx) => (
                  <div key={img.id} draggable onDragStart={() => onDS(idx)} onDragOver={(e) => onDO(e, idx)} onDragEnd={onDE}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, border: `1px solid ${dragIdx === idx ? t.primary : t.border}`, background: dragIdx === idx ? t.primaryBg : t.bg, cursor: "grab", transition: "border-color 0.15s" }}>
                    <span style={{ fontSize: 11, color: t.textMut, width: 20 }}>{idx + 1}</span>
                    <div style={{ borderRadius: 4, overflow: "hidden", flexShrink: 0 }}><ImgBox src={img.dataUrl} brightness={img.brightness} height={36} style={{ width: 48 }} /></div>
                    <span style={{ flex: 1, fontSize: 11, color: t.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{img.name}</span>
                    <div style={{ display: "flex", gap: 2 }}>
                      <button onClick={() => move(idx, idx - 1)} disabled={idx === 0} style={{ background: "none", border: "none", color: idx === 0 ? t.textMut : t.textSec, cursor: "pointer", padding: 1 }}><IcUp size={14} /></button>
                      <button onClick={() => move(idx, idx + 1)} disabled={idx === imgs.length - 1} style={{ background: "none", border: "none", color: idx === imgs.length - 1 ? t.textMut : t.textSec, cursor: "pointer", padding: 1 }}><IcDown size={14} /></button>
                      <button onClick={() => setImgs((p) => p.filter((i) => i.id !== img.id))} style={{ background: "none", border: "none", color: t.textMut, cursor: "pointer", padding: 1 }}><IcX size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div><label style={st.label}>Answers (one per line)</label>
              <textarea style={{ ...st.textarea, minHeight: Math.max(140, imgs.length * 42) }} placeholder={imgs.map((_, i) => `Answer for image ${i + 1}`).join("\n")} value={fAnsText} onChange={(e) => setFAnsText(e.target.value)} />
              <p style={{ ...st.sub, marginTop: 4, fontSize: 12 }}>{fAnswers.length} / {imgs.length} answers{fAnswers.length !== imgs.length && fAnswers.length > 0 ? <span style={{ color: t.warning }}> — must match image count</span> : ""}</p>
            </div>
          </div>
        )}
        <div style={{ ...st.row, justifyContent: "flex-end", marginTop: 20, gap: 8 }}>
          <Btn variant="ghost" onClick={() => { onClose(); reset(); }}>Cancel</Btn>
          <Btn disabled={!canImportFile || processing} onClick={doImportFile}>Import {imgs.length} Items</Btn>
        </div>
      </>}
    </Dlg>
  );
}

// ═══════════════════════════════════════════════════════════════
// TRANSLATE QUIZ
// ═══════════════════════════════════════════════════════════════
function TranslateQuiz({ folder, words, onBack, onUpdateWord }) {
  const t = useT(), st = makeStyles(t);
  const total = words.length;
  const [q, setQ] = useState(() => shuffle([...words]).map((w) => ({ ...w, _review: false })));
  const [idx, setIdx] = useState(0);
  const [ans, setAns] = useState("");
  const [hint, setHint] = useState(null);
  const [fb, setFb] = useState(null);
  const [hints, setHints] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [correctAttempts, setCorrectAttempts] = useState(0);
  const [done, setDone] = useState(0);
  const [hinted, setHinted] = useState(false);
  const reviewedIds = useRef(new Set());
  const [t0] = useState(Date.now());
  const [fin, setFin] = useState(false);
  const [reviewGate, setReviewGate] = useState(false);
  const ref = useRef(null);
  const cur = q[idx];

  // Inline edit state
  const [editing, setEditing] = useState(false);
  const [eFrom, setEFrom] = useState("");
  const [eTo, setETo] = useState("");

  const startEdit = () => {
    if (fb) return;
    setEditing(true); setEFrom(cur.wordFrom); setETo(cur.wordTo);
  };
  const saveEdit = () => {
    if (!eFrom.trim() || !eTo.trim()) return;
    const newFrom = eFrom.trim(), newTo = eTo.trim();
    onUpdateWord(cur.id, { wordFrom: newFrom, wordTo: newTo });
    setQ((qq) => qq.map((item) => item.id === cur.id ? { ...item, wordFrom: newFrom, wordTo: newTo } : item));
    setEditing(false);
  };
  const cancelEdit = () => setEditing(false);

  useEffect(() => { if (!fin && !editing && !reviewGate) setTimeout(() => ref.current?.focus(), 50); }, [idx, fb, fin, editing, reviewGate]);
  const adv = useCallback(() => {
    setFb(null); setHint(null); setHinted(false); setAns("");
    const nextIdx = idx + 1;
    if (nextIdx >= q.length) { setFin(true); return; }
    // Show gate when transitioning from original to review items
    if (!q[idx]._review && q[nextIdx]._review) { setIdx(nextIdx); setReviewGate(true); }
    else setIdx(nextIdx);
  }, [idx, q]);
  useEffect(() => { if ((fb === "ok" || fb === "no") && !editing) { const tm = setTimeout(adv, fb === "ok" ? 1000 : 2000); return () => clearTimeout(tm); } }, [fb, adv, editing]);

  const addToReview = () => {
    const itemId = cur.id;
    if (!reviewedIds.current.has(itemId)) {
      reviewedIds.current.add(itemId);
      setQ((qq) => [...qq, { ...cur, _review: true }]);
    }
  };

  const submit = (e) => {
    e.preventDefault(); if (!ans.trim() || fb) return;
    setAttempts((c) => c + 1);
    if (ans.trim().toLowerCase() === cur.wordTo.toLowerCase()) {
      setFb("ok"); setCorrectAttempts((c) => c + 1);
      if (!cur._review) setDone((c) => c + 1);
    } else {
      setFb("no"); addToReview();
    }
  };
  const mkHint = (w) => w.split("").map((c, i) => (i === 0 || i === w.length - 1) ? c : c === " " ? " " : Math.random() > 0.4 ? "_" : c).join("");
  const doHint = () => { if (!hinted) { setHints((c) => c + 1); setHinted(true); addToReview(); } setHint(mkHint(cur.wordTo)); };

  if (fin) return <Results stats={{ totalAttempts: attempts, correctAttempts, hintsUsed: hints, totalTime: Math.round((Date.now() - t0) / 1000) }} mode="translate" onBack={onBack} />;
  if (!cur) return null;

  if (reviewGate) {
    const reviewCount = q.length - idx;
    return (
      <div style={st.col}>
        <div style={st.row}><Btn variant="ghost" icon onClick={onBack}><IcBack /></Btn><div style={{ flex: 1 }}><h2 style={{ ...st.h2, fontSize: 17 }}>Writing Practice</h2><p style={st.sub}>{folder.langFrom} → {folder.langTo}</p></div></div>
        <div style={{ ...st.card, textAlign: "center", padding: "48px 24px" }}>
          <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: t.warningBg, marginBottom: 16 }}>
            <span style={{ fontSize: 32 }}>🔄</span>
          </div>
          <h2 style={{ ...st.h2, marginBottom: 8 }}>Review Your Mistakes</h2>
          <p style={{ ...st.sub, marginBottom: 6 }}>You've completed all the original items.</p>
          <p style={{ ...st.sub, marginBottom: 24 }}>Now let's revisit the <strong style={{ color: t.warning }}>{reviewCount}</strong> {reviewCount === 1 ? "item" : "items"} you got wrong or used hints on.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Btn variant="ghost" onClick={() => setFin(true)}>Skip Review</Btn>
            <Btn onClick={() => setReviewGate(false)}>Continue →</Btn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={st.col}>
      <div style={st.row}><Btn variant="ghost" icon onClick={onBack}><IcBack /></Btn><div style={{ flex: 1 }}><h2 style={{ ...st.h2, fontSize: 17 }}>Writing Practice</h2><p style={st.sub}>{folder.langFrom} → {folder.langTo}</p></div><span style={{ fontSize: 13, color: t.textSec }}>{done}/{total}</span></div>
      <Prog value={total > 0 ? (done / total) * 100 : 0} />
      <div style={{ ...st.card, textAlign: "center", padding: "48px 24px" }}>
        {cur._review && <div style={{ display: "inline-block", padding: "4px 12px", background: t.warningBg, border: `1px solid rgba(217,119,6,0.2)`, borderRadius: 6, marginBottom: 14, fontSize: 12, fontWeight: 600, color: t.warning }}>🔄 Review Mistakes</div>}
        <p style={{ ...st.sub, marginBottom: 8 }}>Translate from {folder.langFrom}:</p>
        {editing ? (
          <div style={{ maxWidth: 360, margin: "0 auto 24px", padding: 16, background: t.primaryBg, border: `1px solid ${t.primaryBorder}`, borderRadius: 12 }}>
            <p style={{ ...st.sub, marginBottom: 10, fontSize: 11 }}>Editing word pair</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <div style={{ flex: 1 }}><label style={{ ...st.label, fontSize: 11 }}>{folder.langFrom}</label><input value={eFrom} onChange={(e) => setEFrom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} style={{ ...st.input, fontSize: 14, padding: "8px 10px" }} autoFocus /></div>
              <span style={{ color: t.textMut, fontSize: 12, marginTop: 18 }}>→</span>
              <div style={{ flex: 1 }}><label style={{ ...st.label, fontSize: 11 }}>{folder.langTo}</label><input value={eTo} onChange={(e) => setETo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} style={{ ...st.input, fontSize: 14, padding: "8px 10px" }} /></div>
            </div>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <Btn variant="ghost" small onClick={cancelEdit}>Cancel</Btn>
              <Btn small disabled={!eFrom.trim() || !eTo.trim()} onClick={saveEdit}><IcCheck size={14} /> Save</Btn>
            </div>
          </div>
        ) : (
          <p onDoubleClick={startEdit} title="Double-click to edit" style={{ fontSize: 36, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", margin: "0 0 24px", letterSpacing: -0.5, cursor: "default", userSelect: "none" }}>{cur.wordFrom}</p>
        )}
        {hint && <div style={{ display: "inline-block", padding: "8px 20px", background: t.warningBg, border: `1px solid rgba(217,119,6,0.2)`, borderRadius: 8, marginBottom: 20, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.2em", fontSize: 15 }}>{hint}</div>}
        <form onSubmit={submit} style={{ maxWidth: 420, margin: "0 auto" }}>
          <input ref={ref} value={ans} onChange={(e) => setAns(e.target.value)} placeholder={`Write in ${folder.langTo}...`} disabled={!!fb} autoComplete="off" autoCapitalize="off"
            style={{ ...st.input, textAlign: "center", fontSize: 17, padding: "12px 16px", marginBottom: 12, borderColor: fb === "ok" ? t.success : fb === "no" ? t.danger : t.border, background: fb === "ok" ? t.successBg : fb === "no" ? t.dangerBg : t.bg }} />
          {fb === "ok" && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: t.success, fontWeight: 600, marginBottom: 8 }}><IcCheck size={18} /> Correct!</div>}
          {fb === "no" && <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: t.danger, fontSize: 13 }}><IcX size={14} /> Incorrect. Answer: <strong>{cur.wordTo}</strong></div>
            <p style={{ ...st.sub, marginTop: 6, fontSize: 11 }}>Moving on...</p>
          </div>}
          {!fb && <div style={{ ...st.row, gap: 8 }}><Btn style={{ flex: 1 }} disabled={!ans.trim()} onClick={submit}>Check Answer</Btn><Btn variant="outline" onClick={doHint}><IcEye size={16} /> Hint</Btn></div>}
        </form>
        <p style={{ ...st.sub, marginTop: 24, fontSize: 12 }}>{q.length - idx - 1} remaining</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MATCH QUIZ
// ═══════════════════════════════════════════════════════════════
function MatchQuiz({ folder, words, onBack }) {
  const t = useT(), st = makeStyles(t);
  const all = useRef(shuffle([...words]));
  const [ni, setNi] = useState(5);
  const [left, setLeft] = useState([]); const [right, setRight] = useState([]);
  const [sL, setSL] = useState(null); const [sR, setSR] = useState(null);
  const [matched, setMatched] = useState(0); const [tot, setTot] = useState(0); const [cor, setCor] = useState(0);
  const [t0] = useState(Date.now()); const [fin, setFin] = useState(false); const [flash, setFlash] = useState(null);

  useEffect(() => {
    const init = all.current.slice(0, 5);
    setLeft(init.map((p) => ({ id: `l-${p.id}`, text: p.wordFrom, pid: p.id, m: false })));
    setRight(shuffle(init.map((p) => ({ id: `r-${p.id}`, text: p.wordTo, pid: p.id, m: false }))));
  }, []);

  const repl = useCallback((pid) => {
    if (ni >= all.current.length) { setLeft((p) => p.filter((s) => s.pid !== pid)); setRight((p) => p.filter((s) => s.pid !== pid)); return; }
    const np = all.current[ni]; setNi((i) => i + 1);
    setTimeout(() => {
      setLeft((p) => p.map((s) => s.pid === pid ? { id: `l-${np.id}`, text: np.wordFrom, pid: np.id, m: false } : s));
      setRight((p) => shuffle(p.map((s) => s.pid === pid ? { id: `r-${np.id}`, text: np.wordTo, pid: np.id, m: false } : s)));
    }, 500);
  }, [ni]);

  useEffect(() => {
    if (!sL || !sR) return;
    const li = left.find((s) => s.id === sL), ri = right.find((s) => s.id === sR);
    if (!li || !ri) return; setTot((c) => c + 1);
    if (li.pid === ri.pid) {
      setCor((c) => c + 1); const nm = matched + 1;
      setLeft((p) => p.map((s) => s.id === sL ? { ...s, m: true } : s));
      setRight((p) => p.map((s) => s.id === sR ? { ...s, m: true } : s));
      setMatched(nm); setSL(null); setSR(null);
      setTimeout(() => { nm >= all.current.length ? setFin(true) : repl(li.pid); }, 2000);
    } else { setFlash({ l: sL, r: sR }); setTimeout(() => { setFlash(null); setSL(null); setSR(null); }, 500); }
  }, [sL, sR]);

  if (fin) return <Results stats={{ totalAttempts: tot, correctAttempts: cor, hintsUsed: 0, totalTime: Math.round((Date.now() - t0) / 1000) }} mode="match" onBack={onBack} />;

  const slot = (sel, sl, flashK) => ({
    width: "100%", padding: "14px 16px", borderRadius: 10, fontSize: 14, fontWeight: 500, textAlign: "center",
    cursor: sl.m ? "default" : "pointer", border: "1px solid", transition: "all 0.15s", fontFamily: "'DM Sans', sans-serif",
    background: sl.m ? t.successBg : sel === sl.id ? t.primaryBg : flashK === sl.id ? t.dangerBg : t.bg,
    borderColor: sl.m ? "rgba(34,197,94,0.3)" : sel === sl.id ? t.primary : flashK === sl.id ? t.danger : t.border,
    color: sl.m ? t.success : sel === sl.id ? t.primaryLight : t.text, opacity: sl.m ? 0.5 : 1,
  });

  return (
    <div style={st.col}>
      <div style={st.row}><Btn variant="ghost" icon onClick={onBack}><IcBack /></Btn><div style={{ flex: 1 }}><h2 style={{ ...st.h2, fontSize: 17 }}>Matching Practice</h2><p style={st.sub}>Click matching pairs</p></div><span style={{ fontSize: 13, color: t.textSec }}>{matched}/{all.current.length}</span></div>
      <Prog value={(matched / all.current.length) * 100} />
      <div style={st.grid2}>
        <div style={st.col}><p style={{ ...st.label, textAlign: "center" }}>{folder.langFrom || "Term"}</p>
          {left.map((sl) => <button key={sl.id} disabled={sl.m || !!flash} onClick={() => setSL(sL === sl.id ? null : sl.id)} style={slot(sL, sl, flash?.l)}>{sl.text}</button>)}
        </div>
        <div style={st.col}><p style={{ ...st.label, textAlign: "center" }}>{folder.langTo || "Answer"}</p>
          {right.map((sl) => <button key={sl.id} disabled={sl.m || !!flash} onClick={() => setSR(sR === sl.id ? null : sl.id)} style={slot(sR, sl, flash?.r)}>{sl.text}</button>)}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMAGE MATCH QUIZ
// ═══════════════════════════════════════════════════════════════
function ImageMatchQuiz({ images, onBack }) {
  const t = useT(), st = makeStyles(t);
  const all = useRef(shuffle([...images]));
  const [ni, setNi] = useState(5);
  const [iSlots, setI] = useState([]); const [aSlots, setA] = useState([]);
  const [sI, setSI] = useState(null); const [sA, setSA] = useState(null);
  const [matched, setMatched] = useState(0); const [tot, setTot] = useState(0); const [cor, setCor] = useState(0);
  const [t0] = useState(Date.now()); const [fin, setFin] = useState(false); const [flash, setFlash] = useState(null);

  useEffect(() => {
    const init = all.current.slice(0, 5);
    setI(init.map((it) => ({ id: `i-${it.id}`, url: it.imageUrl, br: it.brightness, iid: it.id, m: false })));
    setA(shuffle(init.map((it) => ({ id: `a-${it.id}`, text: it.answer, iid: it.id, m: false }))));
  }, []);

  const repl = useCallback((iid) => {
    if (ni >= all.current.length) { setI((p) => p.filter((s) => s.iid !== iid)); setA((p) => p.filter((s) => s.iid !== iid)); return; }
    const np = all.current[ni]; setNi((i) => i + 1);
    setTimeout(() => {
      setI((p) => p.map((s) => s.iid === iid ? { id: `i-${np.id}`, url: np.imageUrl, br: np.brightness, iid: np.id, m: false } : s));
      setA((p) => shuffle(p.map((s) => s.iid === iid ? { id: `a-${np.id}`, text: np.answer, iid: np.id, m: false } : s)));
    }, 500);
  }, [ni]);

  useEffect(() => {
    if (!sI || !sA) return;
    const ii = iSlots.find((s) => s.id === sI), ai = aSlots.find((s) => s.id === sA);
    if (!ii || !ai) return; setTot((c) => c + 1);
    if (ii.iid === ai.iid) {
      setCor((c) => c + 1); const nm = matched + 1;
      setI((p) => p.map((s) => s.id === sI ? { ...s, m: true } : s));
      setA((p) => p.map((s) => s.id === sA ? { ...s, m: true } : s));
      setMatched(nm); setSI(null); setSA(null);
      setTimeout(() => { nm >= all.current.length ? setFin(true) : repl(ii.iid); }, 2000);
    } else { setFlash({ i: sI, a: sA }); setTimeout(() => { setFlash(null); setSI(null); setSA(null); }, 500); }
  }, [sI, sA]);

  if (fin) return <Results stats={{ totalAttempts: tot, correctAttempts: cor, hintsUsed: 0, totalTime: Math.round((Date.now() - t0) / 1000) }} mode="match" onBack={onBack} />;

  return (
    <div style={st.col}>
      <div style={st.row}><Btn variant="ghost" icon onClick={onBack}><IcBack /></Btn><div style={{ flex: 1 }}><h2 style={{ ...st.h2, fontSize: 17 }}>Image Match</h2><p style={st.sub}>Match images to answers</p></div><span style={{ fontSize: 13, color: t.textSec }}>{matched}/{all.current.length}</span></div>
      <Prog value={(matched / all.current.length) * 100} />
      <div style={st.grid2}>
        <div style={st.col}><p style={{ ...st.label, textAlign: "center" }}>Images</p>
          {iSlots.map((sl) => (
            <button key={sl.id} disabled={sl.m || !!flash} onClick={() => setSI(sI === sl.id ? null : sl.id)}
              style={{ borderRadius: 10, overflow: "hidden", cursor: sl.m ? "default" : "pointer", border: `2px solid ${sl.m ? "rgba(34,197,94,0.3)" : sI === sl.id ? t.primary : flash?.i === sl.id ? t.danger : t.border}`, opacity: sl.m ? 0.5 : 1, transition: "all 0.15s", background: "none", padding: 0 }}>
              <ImgBox src={sl.url} brightness={sl.br} height={90} fit="cover" />
            </button>
          ))}
        </div>
        <div style={st.col}><p style={{ ...st.label, textAlign: "center" }}>Answers</p>
          {aSlots.map((sl) => (
            <button key={sl.id} disabled={sl.m || !!flash} onClick={() => setSA(sA === sl.id ? null : sl.id)}
              style={{
                width: "100%", height: 90, display: "flex", alignItems: "center", justifyContent: "center",
                padding: "14px 16px", borderRadius: 10, fontSize: 14, fontWeight: 600, textAlign: "center",
                cursor: sl.m ? "default" : "pointer", transition: "all 0.15s", fontFamily: "'DM Sans', sans-serif",
                background: sl.m ? t.successBg : sA === sl.id ? t.primaryBg : flash?.a === sl.id ? t.dangerBg : t.bg,
                border: `1px solid ${sl.m ? "rgba(34,197,94,0.3)" : sA === sl.id ? t.primary : flash?.a === sl.id ? t.danger : t.border}`,
                color: sl.m ? t.success : sA === sl.id ? t.primaryLight : t.text, opacity: sl.m ? 0.5 : 1,
              }}>{sl.text}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMAGE WRITE QUIZ
// ═══════════════════════════════════════════════════════════════
function ImageWriteQuiz({ images, onBack }) {
  const t = useT(), st = makeStyles(t);
  const total = images.length;
  const [q, setQ] = useState(() => shuffle([...images]).map((i) => ({ ...i, _review: false })));
  const [idx, setIdx] = useState(0);
  const [ans, setAns] = useState("");
  const [hint, setHint] = useState(null);
  const [fb, setFb] = useState(null);
  const [hints, setHints] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [correctAttempts, setCorrectAttempts] = useState(0);
  const [done, setDone] = useState(0);
  const [hinted, setHinted] = useState(false);
  const reviewedIds = useRef(new Set());
  const [t0] = useState(Date.now());
  const [fin, setFin] = useState(false);
  const [reviewGate, setReviewGate] = useState(false);
  const ref = useRef(null);
  const cur = q[idx];

  useEffect(() => { if (!fin && !reviewGate) setTimeout(() => ref.current?.focus(), 50); }, [idx, fb, fin, reviewGate]);
  const adv = useCallback(() => {
    setFb(null); setHint(null); setHinted(false); setAns("");
    const nextIdx = idx + 1;
    if (nextIdx >= q.length) { setFin(true); return; }
    if (!q[idx]._review && q[nextIdx]._review) { setIdx(nextIdx); setReviewGate(true); }
    else setIdx(nextIdx);
  }, [idx, q]);
  useEffect(() => { if (fb === "ok" || fb === "no") { const tm = setTimeout(adv, fb === "ok" ? 1000 : 2000); return () => clearTimeout(tm); } }, [fb, adv]);

  const addToReview = () => {
    const itemId = cur.id;
    if (!reviewedIds.current.has(itemId)) {
      reviewedIds.current.add(itemId);
      setQ((qq) => [...qq, { ...cur, _review: true }]);
    }
  };

  const submit = (e) => {
    e.preventDefault(); if (!ans.trim() || fb) return;
    setAttempts((c) => c + 1);
    if (ans.trim().toLowerCase() === cur.answer.toLowerCase()) {
      setFb("ok"); setCorrectAttempts((c) => c + 1);
      if (!cur._review) setDone((c) => c + 1);
    } else {
      setFb("no"); addToReview();
    }
  };
  const mkHint = (w) => w.split("").map((c, i) => (i === 0 || i === w.length - 1) ? c : c === " " ? " " : Math.random() > 0.4 ? "_" : c).join("");
  const doHint = () => { if (!hinted) { setHints((c) => c + 1); setHinted(true); addToReview(); } setHint(mkHint(cur.answer)); };

  if (fin) return <Results stats={{ totalAttempts: attempts, correctAttempts, hintsUsed: hints, totalTime: Math.round((Date.now() - t0) / 1000) }} mode="translate" onBack={onBack} />;
  if (!cur) return null;

  if (reviewGate) {
    const reviewCount = q.length - idx;
    return (
      <div style={st.col}>
        <div style={st.row}><Btn variant="ghost" icon onClick={onBack}><IcBack /></Btn><div style={{ flex: 1 }}><h2 style={{ ...st.h2, fontSize: 17 }}>Image Writing Practice</h2><p style={st.sub}>Type the answer for each image</p></div></div>
        <div style={{ ...st.card, textAlign: "center", padding: "48px 24px" }}>
          <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: t.warningBg, marginBottom: 16 }}>
            <span style={{ fontSize: 32 }}>🔄</span>
          </div>
          <h2 style={{ ...st.h2, marginBottom: 8 }}>Review Your Mistakes</h2>
          <p style={{ ...st.sub, marginBottom: 6 }}>You've completed all the original items.</p>
          <p style={{ ...st.sub, marginBottom: 24 }}>Now let's revisit the <strong style={{ color: t.warning }}>{reviewCount}</strong> {reviewCount === 1 ? "item" : "items"} you got wrong or used hints on.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Btn variant="ghost" onClick={() => setFin(true)}>Skip Review</Btn>
            <Btn onClick={() => setReviewGate(false)}>Continue →</Btn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={st.col}>
      <div style={st.row}><Btn variant="ghost" icon onClick={onBack}><IcBack /></Btn><div style={{ flex: 1 }}><h2 style={{ ...st.h2, fontSize: 17 }}>Image Writing Practice</h2><p style={st.sub}>Type the answer for each image</p></div><span style={{ fontSize: 13, color: t.textSec }}>{done}/{total}</span></div>
      <Prog value={total > 0 ? (done / total) * 100 : 0} />
      <div style={{ ...st.card, textAlign: "center", padding: "32px 24px" }}>
        {cur._review && <div style={{ display: "inline-block", padding: "4px 12px", background: t.warningBg, border: `1px solid rgba(217,119,6,0.2)`, borderRadius: 6, marginBottom: 14, fontSize: 12, fontWeight: 600, color: t.warning }}>🔄 Review Mistakes</div>}
        <p style={{ ...st.sub, marginBottom: 12 }}>What is this?</p>
        <div style={{ maxWidth: 360, margin: "0 auto 24px", borderRadius: 12, overflow: "hidden", border: `1px solid ${t.border}` }}>
          <ImgBox src={cur.imageUrl} brightness={cur.brightness} height={240} fit="contain" />
        </div>
        {hint && <div style={{ display: "inline-block", padding: "8px 20px", background: t.warningBg, border: `1px solid rgba(217,119,6,0.2)`, borderRadius: 8, marginBottom: 20, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.2em", fontSize: 15 }}>{hint}</div>}
        <form onSubmit={submit} style={{ maxWidth: 420, margin: "0 auto" }}>
          <input ref={ref} value={ans} onChange={(e) => setAns(e.target.value)} placeholder="Type your answer..." disabled={!!fb} autoComplete="off" autoCapitalize="off"
            style={{ ...st.input, textAlign: "center", fontSize: 17, padding: "12px 16px", marginBottom: 12, borderColor: fb === "ok" ? t.success : fb === "no" ? t.danger : t.border, background: fb === "ok" ? t.successBg : fb === "no" ? t.dangerBg : t.bg }} />
          {fb === "ok" && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: t.success, fontWeight: 600, marginBottom: 8 }}><IcCheck size={18} /> Correct!</div>}
          {fb === "no" && <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: t.danger, fontSize: 13 }}><IcX size={14} /> Incorrect. Answer: <strong>{cur.answer}</strong></div>
            <p style={{ ...st.sub, marginTop: 6, fontSize: 11 }}>Moving on...</p>
          </div>}
          {!fb && <div style={{ ...st.row, gap: 8 }}><Btn style={{ flex: 1 }} disabled={!ans.trim()} onClick={submit}>Check Answer</Btn><Btn variant="outline" onClick={doHint}><IcEye size={16} /> Hint</Btn></div>}
        </form>
        <p style={{ ...st.sub, marginTop: 24, fontSize: 12 }}>{q.length - idx - 1} remaining</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════
function Results({ stats, mode, onBack }) {
  const t = useT(), st = makeStyles(t);
  const acc = stats.totalAttempts > 0 ? Math.round((stats.correctAttempts / stats.totalAttempts) * 100) : 0;
  const m = Math.floor(stats.totalTime / 60), sc = stats.totalTime % 60;
  const ts = m > 0 ? `${m}m ${sc}s` : `${sc}s`;
  const col = acc >= 80 ? t.success : acc >= 50 ? t.warning : t.danger;

  const row = (icon, label, val, det, valCol) => (
    <div style={{ display: "flex", alignItems: "center", padding: "14px 16px", background: t.bg, borderRadius: 10 }}>
      <span style={{ fontSize: 20, width: 36, textAlign: "center", flexShrink: 0 }}>{icon}</span>
      <span style={{ width: 80, fontSize: 13, color: t.textSec, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, fontSize: 20, fontWeight: 700, textAlign: "center", color: valCol || t.text }}>{val}</span>
      <span style={{ width: 100, fontSize: 12, color: t.textMut, textAlign: "right", flexShrink: 0 }}>{det}</span>
    </div>
  );

  return (
    <div style={{ ...st.col, maxWidth: 520, margin: "0 auto" }}>
      <div style={st.row}><Btn variant="ghost" icon onClick={onBack}><IcBack /></Btn><h2 style={{ ...st.h2, fontSize: 17 }}>Practice Complete</h2></div>
      <div style={{ ...st.card, textAlign: "center", padding: "32px 24px" }}>
        <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: t.primaryBg, marginBottom: 12 }}><IcTrophy size={32} /></div>
        <h2 style={{ ...st.h2, marginBottom: 20 }}>{mode === "translate" ? "Writing" : "Matching"} Results</h2>
        <div style={st.col}>
          {row("🎯", "Accuracy", `${acc}%`, `${stats.correctAttempts} / ${stats.totalAttempts} attempts`, col)}
          {row("⏱️", "Time", ts, stats.correctAttempts > 0 ? `~${Math.round(stats.totalTime / stats.correctAttempts)}s per correct` : "")}
          {mode === "translate" && row("👁️", "Hints Used", stats.hintsUsed, stats.hintsUsed === 0 ? "No hints needed!" : "")}
        </div>
        <Btn onClick={onBack} style={{ marginTop: 20, width: "100%" }}>Back to Group</Btn>
      </div>
    </div>
  );
}