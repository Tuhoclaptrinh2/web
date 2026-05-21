import React, { useState, useEffect, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { 
  ArrowRightLeft, Settings2, BookOpen, UserCircle, 
  Plus, Trash2, Copy, Check, Sparkles, Loader2, Play,
  Zap, Save, Download, Upload, Key, X, Folder, Edit2, Clock, ChevronDown, ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PronounRule, RuleMapping } from './types';
import { translateNovelText, extractRulesFromTranslation, extractRulesFromContext } from './lib/gemini';

const GENRES: string[] = [
  "Action", "Adult", "Adventure", "Comedy", "Crossdressing", "Dark Comedy", 
  "Depiction of Cruelty", "Drama", "Ecchi", "Fantasy", "Gender Bender", "Gore", 
  "Harem", "Historical", "Horror", "Josei", "Magical Girl", "Martial Arts", 
  "Mature", "Misunderstanding", "MTL", "Mystery", "No Romance", "Psychological", 
  "Pure Love", "R15", "Revenge", "Romance", "School Life", "Sci-fi", "Seinen", 
  "Shoujo", "Shoujo Ai", "Shounen", "Slice of Life", "Smut", "Straight", 
  "Supernatural", "System", "Tragedy", "Wuxia", "Xianxia", "Xuanhuan", "Yuri"
];

export interface TranslationHistory {
  id: string;
  title: string;
  date: number;
  sourceText: string;
  translatedText: string;
}

export interface TranslationProject {
  id: string;
  name: string;
  sourceLanguage?: string;
  genres: string[];
  names: RuleMapping[];
  pronouns: PronounRule[];
  history?: TranslationHistory[];
}

export default function App() {
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("gemini-2.5-flash");
  const [copied, setCopied] = useState(false);
  const [modelQuotaStatus, setModelQuotaStatus] = useState<Record<string, 'ok' | 'quota_exceeded'>>({});

  const abortControllerRef = useRef<AbortController | null>(null);

  // Context Tab State
  const [activeTab, setActiveTab] = useState<'translate' | 'batch' | 'context' | 'history'>('translate');
  const [contextText, setContextText] = useState("");
  const [isExtractingContext, setIsExtractingContext] = useState(false);
  const [extractedPronouns, setExtractedPronouns] = useState<{ speaker: string, listener: string, selfPronoun: string, otherPronoun: string }[]>([]);

  // Batch Translation State
  const [batchChapters, setBatchChapters] = useState<{id: string, title: string, content: string, translated: string, status: 'pending' | 'translating' | 'done' | 'error'}[]>([]);
  const [batchRange, setBatchRange] = useState({ from: '', to: '' });
  const [isBatchTranslating, setIsBatchTranslating] = useState(false);
  const batchAbortControllerRef = useRef<AbortController | null>(null);

  // Settings State & Projects Management
  const [projects, setProjects] = useState<TranslationProject[]>(() => {
    const saved = localStorage.getItem('tien_dich_projects');
    if (saved) return JSON.parse(saved);
    
    // Migration from old app state
    const oldGenres = JSON.parse(localStorage.getItem('tien_dich_genres') || '["Xianxia"]');
    const oldNames = JSON.parse(localStorage.getItem('tien_dich_names') || '[{"id": "1", "zh": "林动", "vi": "Lâm Động"}]');
    const oldPronouns = JSON.parse(localStorage.getItem('tien_dich_pronouns') || '[{"id": "1", "speaker": "Sư phụ", "listener": "Đồ đệ", "selfPronoun": "vi sư", "otherPronoun": "ngươi"}]');
    
    return [{
      id: Date.now().toString(),
      name: 'Dự án Mặc định',
      genres: oldGenres,
      names: oldNames,
      pronouns: oldPronouns
    }];
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    return localStorage.getItem('tien_dich_active_project') || "";
  });

  useEffect(() => {
    if (!activeProjectId && projects.length > 0) {
      setActiveProjectId(projects[0].id);
    }
    localStorage.setItem('tien_dich_active_project', activeProjectId);
  }, [activeProjectId, projects]);

  useEffect(() => {
    try {
      // Create a safe copy of projects to strip out any accidental React DOM Events 
      // that might be stored inside the state (caused an older bug)
      const safeProjects = projects.map(p => ({
        ...p,
        names: (p.names || []).map(n => ({
          ...n,
          zh: typeof n.zh === 'string' ? n.zh : '',
          vi: typeof n.vi === 'string' ? n.vi : ''
        })),
        pronouns: (p.pronouns || []).map(pr => ({
          ...pr,
          speaker: typeof pr.speaker === 'string' ? pr.speaker : '',
          listener: typeof pr.listener === 'string' ? pr.listener : '',
          selfPronoun: typeof pr.selfPronoun === 'string' ? pr.selfPronoun : '',
          otherPronoun: typeof pr.otherPronoun === 'string' ? pr.otherPronoun : ''
        }))
      }));
      localStorage.setItem('tien_dich_projects', JSON.stringify(safeProjects));
    } catch (e) {
      console.error("Local storage sync error:", e);
    }
  }, [projects]);

  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0] || { id: '', name: '', genres: [], names: [], pronouns: [] };
  
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const updateActiveProject = (updates: Partial<TranslationProject>) => {
    setProjects(projects.map(p => p.id === activeProjectId ? { ...p, ...updates } : p));
  };

  const selectedGenres = activeProject.genres || [];
  const setSelectedGenres = (genresOrFn: string[] | ((prev: string[]) => string[])) => {
    const newGenres = typeof genresOrFn === 'function' ? genresOrFn(activeProject.genres || []) : genresOrFn;
    updateActiveProject({ genres: newGenres });
  };

  const names = activeProject.names || [];
  const setNames = (namesOrFn: RuleMapping[] | ((prev: RuleMapping[]) => RuleMapping[])) => {
    const newNames = typeof namesOrFn === 'function' ? namesOrFn(activeProject.names || []) : namesOrFn;
    updateActiveProject({ names: newNames });
  };

  const pronouns = activeProject.pronouns || [];
  const setPronouns = (pronounsOrFn: PronounRule[] | ((prev: PronounRule[]) => PronounRule[])) => {
    const newPronouns = typeof pronounsOrFn === 'function' ? pronounsOrFn(activeProject.pronouns || []) : pronounsOrFn;
    updateActiveProject({ pronouns: newPronouns });
  };
  const [suggestedNames, setSuggestedNames] = useState<{ zh: string; vi: string }[]>([]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(true);
  const [isAppConfigOpen, setIsAppConfigOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isNamesExpanded, setIsNamesExpanded] = useState(true);
  const [isPronounsExpanded, setIsPronounsExpanded] = useState(true);

  useEffect(() => {
    import('./lib/gemini').then(m => {
      setApiKeyInput(m.getCustomApiKey());
    });
  }, []);

  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    type: 'create' | 'rename' | 'delete' | 'alert';
    title: string;
    description: string;
    inputValue: string;
    onConfirm: (val?: string) => void;
  }>({
    isOpen: false,
    type: 'alert',
    title: '',
    description: '',
    inputValue: '',
    onConfirm: () => {}
  });

  const showAlert = (message: string) => {
    setDialogState({
      isOpen: true,
      type: 'alert',
      title: 'Thông báo',
      description: message,
      inputValue: '',
      onConfirm: () => setDialogState(prev => ({ ...prev, isOpen: false }))
    });
  };

  const saveApiKey = async () => {
    const m = await import('./lib/gemini');
    m.setCustomApiKey(apiKeyInput.trim());
    setIsAppConfigOpen(false);
    showAlert("Đã lưu API Key thành công!");
  };

  // Projects Helpers
  const createNewProject = () => {
    setDialogState({
      isOpen: true,
      type: 'create',
      title: 'Tạo Dự Án Mới',
      description: 'Nhập tên cho dự án dịch thuật mới:',
      inputValue: '',
      onConfirm: (val) => {
        if (!val?.trim()) return;
        const newProject: TranslationProject = {
          id: Date.now().toString(),
          name: val.trim(),
          genres: ["Xianxia"],
          names: [],
          pronouns: []
        };
        setProjects(prev => [...prev, newProject]);
        setActiveProjectId(newProject.id);
        setDialogState(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const renameProject = () => {
    setDialogState({
      isOpen: true,
      type: 'rename',
      title: 'Đổi Tên Dự Án',
      description: 'Nhập tên mới cho dự án:',
      inputValue: activeProject.name,
      onConfirm: (val) => {
        if (!val?.trim()) return;
        updateActiveProject({ name: val.trim() });
        setDialogState(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const deleteProject = () => {
    if (projects.length <= 1) {
      showAlert("Phải có ít nhất 1 dự án để ứng dụng hoạt động.");
      return;
    }
    setDialogState({
      isOpen: true,
      type: 'delete',
      title: 'Xóa Dự Án',
      description: `Bạn có chắc muốn xóa dự án "${activeProject.name}"? Mọi thiết lập của dự án này sẽ bị mất.`,
      inputValue: '',
      onConfirm: () => {
        const newProjects = projects.filter(p => p.id !== activeProjectId);
        setProjects(newProjects);
        setActiveProjectId(newProjects[0].id);
        setDialogState(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Helpers cho Dynamic Rules
  const addName = (zh?: string | any, vi?: string | any) => {
    const safeZh = typeof zh === 'string' ? zh : '';
    const safeVi = typeof vi === 'string' ? vi : '';
    setNames([...names, { id: Date.now().toString(), zh: safeZh, vi: safeVi }]);
  };
  
  const moveSuggestedToNames = (index: number) => {
    const item = suggestedNames[index];
    addName(item.zh, item.vi);
    setSuggestedNames(suggestedNames.filter((_, i) => i !== index));
  };
  const removeName = (id: string) => setNames(names.filter(n => n.id !== id));
  const updateName = (id: string, field: 'zh'|'vi', value: string) => {
    setNames(names.map(n => n.id === id ? { ...n, [field]: value } : n));
  };

  const clearHistory = () => {
    setDialogState({
      isOpen: true,
      type: 'delete',
      title: 'Xóa Toàn Bộ Lịch Sử',
      description: 'Bạn có chắc chắn muốn xóa tất cả lịch sử dịch của dự án này không? Thao tác này không thể hoàn tác.',
      inputValue: '',
      onConfirm: () => {
        updateActiveProject({ history: [] });
        setDialogState(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const deleteHistoryItem = (historyId: string) => {
    updateActiveProject({ history: (activeProject.history || []).filter(h => h.id !== historyId) });
  };
  const addPronoun = () => setPronouns([...pronouns, { id: Date.now().toString(), speaker: '', listener: '', selfPronoun: '', otherPronoun: '' }]);
  const removePronoun = (id: string) => setPronouns(pronouns.filter(p => p.id !== id));
  const updatePronoun = (id: string, field: keyof PronounRule, value: string) => {
     setPronouns(pronouns.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const toggleGenre = (g: string) => {
    if (selectedGenres.includes(g)) {
      setSelectedGenres(selectedGenres.filter(x => x !== g));
    } else {
      setSelectedGenres([...selectedGenres, g]);
    }
  };

  const exportPronouns = () => {
    // Sanitize pronouns to prevent any circular reference issues
    const safePronouns = pronouns.map(p => ({
      ...p,
      speaker: typeof p.speaker === 'string' ? p.speaker : '',
      listener: typeof p.listener === 'string' ? p.listener : '',
      selfPronoun: typeof p.selfPronoun === 'string' ? p.selfPronoun : '',
      otherPronoun: typeof p.otherPronoun === 'string' ? p.otherPronoun : ''
    }));
    const jsonString = JSON.stringify(safePronouns, null, 2);
    const blob = new Blob([jsonString], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tien-dich-xung-ho-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportProject = () => {
    const jsonString = JSON.stringify(activeProject, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeProject.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        
        if (parsed.id && parsed.name && Array.isArray(parsed.names)) {
          setProjects(prev => [...prev, parsed]);
          setActiveProjectId(parsed.id);
          showAlert(`Đã nhập dự án "${parsed.name}" thành công!`);
        } else {
          showAlert("File dự án không hợp lệ.");
        }
      } catch (error) {
        showAlert("Có lỗi khi đọc file dự án.");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const importPronouns = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        
        let newPronouns = [];
        if (Array.isArray(parsed)) {
          newPronouns = parsed;
        } else if (parsed.pronouns && Array.isArray(parsed.pronouns)) { // backwards compatibility
          newPronouns = parsed.pronouns;
        }

        if (newPronouns.length > 0) {
          setPronouns(prev => {
             const newArr = [...prev];
             newPronouns.forEach((item: any) => {
               if(!newArr.some(p => p.speaker === item.speaker && p.listener === item.listener)) {
                  newArr.push({ ...item, id: Date.now().toString() + Math.random().toString(36).substring(7) });
               }
             });
             return newArr;
          });
          showAlert("Đã nhập quy tắc xưng hô thành công!");
        } else {
          showAlert("Không tìm thấy quy tắc xưng hô trong file.");
        }
      } catch (error) {
        showAlert("Có lỗi khi đọc file. Đảm bảo bạn đang chọn đúng file txt xưng hô.");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const exportNames = () => {
    // Sanitize names to prevent any circular reference issues
    const safeNames = names.map(n => ({
      ...n,
      zh: typeof n.zh === 'string' ? n.zh : '',
      vi: typeof n.vi === 'string' ? n.vi : ''
    }));
    const jsonString = JSON.stringify(safeNames, null, 2);
    const blob = new Blob([jsonString], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tien-dich-danh-tu-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importNames = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        
        let newNames = [];
        if (Array.isArray(parsed)) {
          newNames = parsed;
        } else if (parsed.names && Array.isArray(parsed.names)) { // backwards compatibility
          newNames = parsed.names;
        }

        if (newNames.length > 0) {
          setNames(prev => {
             const newArr = [...prev];
             newNames.forEach((item: any) => {
               if(!newArr.some(n => n.zh === item.zh && n.vi === item.vi)) {
                  newArr.push({ ...item, id: Date.now().toString() + Math.random().toString(36).substring(7) });
               }
             });
             return newArr;
          });
          showAlert("Đã nhập danh từ riêng thành công!");
        } else {
          showAlert("Không tìm thấy danh từ riêng trong file.");
        }
      } catch (error) {
        showAlert("Có lỗi khi đọc file. Đảm bảo bạn đang chọn đúng file txt danh từ.");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleStopTranslate = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTranslating(false);
  };

const parseEpub = async (file: File) => {
    try {
      const zip = await JSZip.loadAsync(file);
      
      let opfPath = '';
      const containerFile = zip.file("META-INF/container.xml");
      if (containerFile) {
        const containerXml = await containerFile.async("string");
        const parser = new DOMParser();
        const doc = parser.parseFromString(containerXml, "text/xml");
        const rootfile = doc.querySelector("rootfile");
        if (rootfile) {
          opfPath = rootfile.getAttribute("full-path") || '';
        }
      }
      
      if (!opfPath) throw new Error("Could not find OPF file in EPUB");

      const opfContent = await zip.file(opfPath)?.async("string");
      if (!opfContent) throw new Error("Could not read OPF file");
      
      const parser = new DOMParser();
      const opfDoc = parser.parseFromString(opfContent, "text/xml");
      
      const manifest = opfDoc.querySelector("manifest");
      const spine = opfDoc.querySelector("spine");
      if (!manifest || !spine) throw new Error("Invalid OPF format");
      
      const itemMap = new Map();
      manifest.querySelectorAll("item").forEach(item => {
        itemMap.set(item.getAttribute("id"), item.getAttribute("href"));
      });
      
      const itemrefs = spine.querySelectorAll("itemref");
      const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
      const chapters: { id: string, title: string, content: string, translated: string, status: 'pending' | 'translating' | 'done' | 'error' }[] = [];
      
      for (let i = 0; i < itemrefs.length; i++) {
        const idref = itemrefs[i].getAttribute("idref");
        const href = itemMap.get(idref);
        if (href) {
          const filePath = opfDir + href;
          const htmlFile = zip.file(filePath);
          if (htmlFile) {
            const htmlContent = await htmlFile.async("string");
            const htmlDoc = parser.parseFromString(htmlContent, "text/html");
            if (htmlDoc.body) {
                htmlDoc.body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li').forEach(tag => {
                   tag.appendChild(htmlDoc.createTextNode('\n'));
                });
                htmlDoc.body.querySelectorAll('br').forEach(tag => {
                   tag.replaceWith(htmlDoc.createTextNode('\n'));
                });
            }
            
            const textContent = htmlDoc.body ? htmlDoc.body.textContent || '' : htmlDoc.documentElement.textContent || '';
            const cleanedText = textContent.split('\n').map(line => line.trim()).filter(line => line.length > 0).join('\n').trim();
            
            if (cleanedText) {
              const h1 = htmlDoc.querySelector("h1, h2, h3");
              const titleTag = htmlDoc.querySelector("title");
              let title = h1 ? h1.textContent?.trim() : titleTag?.textContent?.trim();
              if (!title) title = `Chương ${chapters.length + 1}`;
              
              chapters.push({
                id: Date.now() + Math.random().toString(),
                title: title.substring(0, 100).replace(/\n/g, ' '),
                content: cleanedText,
                translated: '',
                status: 'pending'
              });
            }
          }
        }
      }
      return chapters;
    } catch (e) {
      console.error("EPUB Parse Error:", e);
      alert("Lỗi khi đọc file EPUB.");
      return [];
    }
  };

  const handleBatchFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.epub')) {
      const chapters = await parseEpub(file);
      if (chapters.length > 0) {
        setBatchChapters(chapters);
      }
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parts = text.split(/(?=^第[0-9零一二三四五六七八九十百千]+[章回节卷]|^\s*Chương\s*\d+|^\s*Chapter\s*\d+)/im);
      
      const chapters = [];
      if (parts.length <= 1) {
        const lines = text.split('\n');
        let current = '';
        for(let line of lines) {
           current += line + '\n';
           if (current.length > 5000) {
              chapters.push({ id: Date.now() + Math.random().toString(), title: `Phần ${chapters.length + 1}`, content: current, translated: '', status: 'pending' as const });
              current = '';
           }
        }
        if (current.trim()) {
           chapters.push({ id: Date.now() + Math.random().toString(), title: `Phần ${chapters.length + 1}`, content: current, translated: '', status: 'pending' as const });
        }
      } else {
        if (parts[0].trim()) {
           chapters.push({ id: Date.now() + Math.random().toString(), title: 'Mở đầu', content: parts[0], translated: '', status: 'pending' as const });
        }
        for(let j = 1; j < parts.length; j++) {
           const content = parts[j];
           const titleMatch = content.match(/^(.*)(\n|$)/);
           const title = titleMatch ? titleMatch[1].trim() : `Chương ${j}`;
           chapters.push({ id: Date.now() + Math.random().toString(), title, content, translated: '', status: 'pending' as const });
        }
      }
      setBatchChapters(chapters.filter(c => c.content.trim().length > 0));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleStartBatchTranslate = async () => {
    if (isBatchTranslating || batchChapters.length === 0) return;
    setIsBatchTranslating(true);
    batchAbortControllerRef.current = new AbortController();

    // Reset error chapters to pending
    let currentChapters = [...batchChapters].map(c => c.status === 'error' ? { ...c, status: 'pending' as const } : c);
    setBatchChapters(currentChapters);

    const fromIndex = batchRange.from ? Math.max(0, parseInt(batchRange.from) - 1) : 0;
    const toIndex = batchRange.to && parseInt(batchRange.to) > 0 ? Math.min(currentChapters.length - 1, parseInt(batchRange.to) - 1) : Math.max(0, currentChapters.length - 1);

    for (let i = fromIndex; i <= toIndex && i < currentChapters.length; i++) {
      if (batchAbortControllerRef.current?.signal.aborted) break;
      if (currentChapters[i].status === 'done') continue;

      setBatchChapters(prev => {
         const next = [...prev];
         next[i].status = 'translating';
         return next;
      });

      try {
        const contentToTranslate = currentChapters[i].content;
        const currentActiveProject = projectsRef.current.find(p => p.id === activeProjectId) || projectsRef.current[0] || { id: '', name: '', genres: [], names: [], pronouns: [] };
        
        const result = await translateNovelText(
          contentToTranslate,
          currentActiveProject.genres || [],
          currentActiveProject.names || [],
          currentActiveProject.pronouns || [],
          (chunk) => {
             setBatchChapters(prev => {
                const updated = [...prev];
                updated[i].translated = chunk;
                return updated;
             });
          },
          selectedModel,
          batchAbortControllerRef.current?.signal,
          currentActiveProject.sourceLanguage
        );

        setBatchChapters(prev => {
          const updated = [...prev];
          updated[i].translated = result;
          updated[i].status = 'done';
          return updated;
        });
        currentChapters[i].status = 'done';

        // Automatically extract names and pronouns after translation
        try {
          const resultData = await extractRulesFromTranslation(contentToTranslate, result, selectedModel, currentActiveProject.sourceLanguage);
          
          setSuggestedNames(prev => {
            const newArr = [...prev];
            resultData.names.forEach(s => {
              if (!(currentActiveProject.names || []).some(n => n.vi === s.vi || (s.zh && n.zh === s.zh)) &&
                  !newArr.some(r => r.vi === s.vi || (s.zh && r.zh === s.zh))) {
                 newArr.push({ zh: s.zh || "", vi: s.vi });
              }
            });
            return newArr;
          });

          setSuggestedPronouns(prev => {
            const newArr = [...prev];
            resultData.pronouns.forEach(s => {
               if (!(currentActiveProject.pronouns || []).some(p => p.speaker === s.speaker || p.listener === s.listener) &&
                   !newArr.some(p => typeof p === 'object' && p !== null && 'speaker' in p ? (p as any).speaker === s.speaker || (p as any).listener === s.listener : false)) {
                  newArr.push(s);
               }
            });
            return newArr;
          });
        } catch (err) {
          console.error("Batch extraction error: ", err);
        }
        
        await new Promise(r => setTimeout(r, 1000));
      } catch (err: any) {
        if (err.name === 'AbortError') break;
        console.error(err);
        
        // Check for Quota or Rate Limit errors
        if (err?.message && (err.message.toLowerCase().includes('quota') || err.message.includes('429'))) {
           alert("Hệ thống phát hiện lỗi giới hạn API (Quota Exceeded / Too Many Requests). Quá trình dịch sẽ tạm dừng. Vui lòng thử lại sau hoặc đổi API Key khác.");
        }

        setBatchChapters(prev => {
          const updated = [...prev];
          updated[i].status = 'error';
          return updated;
        });
        currentChapters[i].status = 'error';
        break; 
      }
    }
    setIsBatchTranslating(false);
    batchAbortControllerRef.current = null;
  };

  const handleStopBatchTranslate = () => {
    if (batchAbortControllerRef.current) {
      batchAbortControllerRef.current.abort();
      batchAbortControllerRef.current = null;
    }
    setIsBatchTranslating(false);
  };

  const handleExportBatch = () => {
    const completedChapters = batchChapters.filter(c => c.status === 'done');
    
    if (completedChapters.length === 0) {
       alert("Chưa có chương nào được dịch xong để xuất.");
       return;
    }

    const fullText = completedChapters.map(c => {
      const trans = c.translated ? c.translated.trim() : c.content.trim();
      return `${c.title}\n\n${trans}\n\n`;
    }).join('');
    
    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `[Dịch] ${activeProject.name || 'Truyen'}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleTranslate = async () => {
    if (!sourceText.trim()) return;
    setIsTranslating(true);
    
    abortControllerRef.current = new AbortController();
    
    try {
      setTranslatedText("");
      const result = await translateNovelText(
        sourceText,
        selectedGenres,
        names,
        pronouns,
        (chunkText) => {
          setTranslatedText(chunkText);
        },
        selectedModel,
        abortControllerRef.current?.signal,
        activeProject.sourceLanguage
      );
      const formattedResult = result;
      setTranslatedText(formattedResult);
      setModelQuotaStatus(prev => ({ ...prev, [selectedModel]: 'ok' }));

      if (!formattedResult.trim()) {
        throw new Error("Bản dịch trả về trống. Có thể đoạn văn bị Google Gemini chặn (do vi phạm chính sách) hoặc lỗi API. Bạn thử cắt ngắn văn bản hoặc thử lại nhé.");
      }

      // Save history
      let chapterNum = "?";
      const chapterRegex = /(?:chương|đệ|chapter)\s*(?:thứ\s*)?(\d+)/i;
      const cnChapterRegex = /第\s*(\d+)\s*章/;
      
      const match = formattedResult.match(chapterRegex) || sourceText.match(cnChapterRegex) || sourceText.match(chapterRegex);
      if (match && match[1]) {
        chapterNum = match[1];
      } else {
        const firstLine = formattedResult.split('\n')[0] || "";
        const m = firstLine.match(/(?:chương|đệ)\s+([^\s:]+)/i);
        if (m && m[1]) {
          chapterNum = m[1].replace(/[-_,.]$/, '');
        }
      }

      const title = chapterNum !== "?" 
        ? `Dịch chương ${chapterNum} của dự án ${activeProject.name}`
        : `Dịch bản thảo của dự án ${activeProject.name}`;

      const newHistoryItem: TranslationHistory = {
        id: Date.now().toString(),
        title: title,
        date: Date.now(),
        sourceText: sourceText,
        translatedText: formattedResult
      };
      updateActiveProject({ history: [newHistoryItem, ...(activeProject.history || [])].slice(0, 50) });

      // Automatically extract names and pronouns after translation
      const resultData = await extractRulesFromTranslation(sourceText, formattedResult, selectedModel, activeProject.sourceLanguage);
      
      setSuggestedNames(prev => {
        const newArr = [...prev];
        resultData.names.forEach(s => {
          if (!names.some(n => n.vi === s.vi || (s.zh && n.zh === s.zh)) &&
              !newArr.some(r => r.vi === s.vi || (s.zh && r.zh === s.zh))) {
             newArr.push({ zh: s.zh || "", vi: s.vi });
          }
        });
        return newArr;
      });

      setExtractedPronouns(prev => {
        const newArr = [...prev];
        resultData.pronouns.forEach(p => {
          if (!pronouns.some(existing => existing.speaker === p.speaker && existing.listener === p.listener) &&
              !newArr.some(existing => existing.speaker === p.speaker && existing.listener === p.listener)) {
            newArr.push(p);
          }
        });
        return newArr;
      });
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) {
        console.log('Translation aborted by user');
        // keep partial text
      } else {
        const errMsg = error?.message?.toLowerCase() || "";
        if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('đã hết giới hạn api')) {
          setModelQuotaStatus(prev => ({ ...prev, [selectedModel]: 'quota_exceeded' }));
          showAlert(`Lỗi: Model ${selectedModel} đã hết hạn mức sử dụng (Quota exceeded). Vui lòng đổi model khác hoặc thiết lập API Key Gemini của riêng bạn.`);
          setIsAppConfigOpen(true);
        } else {
          showAlert("Đã xảy ra lỗi khi phiên dịch: " + (error?.message || "Vui lòng kiểm tra lại cấu hình."));
        }
      }
    } finally {
      setIsTranslating(false);
      abortControllerRef.current = null;
    }
  };

  const handleCopy = async () => {
    if (!translatedText) return;
    
    // Đảm bảo xuống dòng đồng nhất
    const textToCopyPlain = translatedText.replace(/\r?\n/g, '\n');
    
    try {
      // Dùng thẻ <br/> để không bị mất bất kỳ dòng trống nào khi dán sang các editor HTML (như Word, web)
      const htmlCopied = `<div>${translatedText.replace(/\r?\n/g, '<br/>')}</div>`;
      const clipboardItem = new ClipboardItem({
        'text/plain': new Blob([textToCopyPlain], { type: 'text/plain' }),
        'text/html': new Blob([htmlCopied], { type: 'text/html' })
      });
      await navigator.clipboard.write([clipboardItem]);
    } catch(e) {
      // Fallback
      await navigator.clipboard.writeText(textToCopyPlain);
    }
    
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExtractContext = async () => {
    if (!contextText.trim()) return;
    setIsExtractingContext(true);
    try {
      const result = await extractRulesFromContext(contextText, selectedModel, activeProject.sourceLanguage);
      setModelQuotaStatus(prev => ({ ...prev, [selectedModel]: 'ok' }));
      
      setSuggestedNames(prev => {
        const newArr = [...prev];
        result.names.forEach((s: { zh?: string, vi: string }) => {
          if (!names.some(n => n.vi === s.vi || (s.zh && n.zh === s.zh)) &&
              !newArr.some(r => r.vi === s.vi || (s.zh && r.zh === s.zh))) {
             newArr.push({ zh: s.zh || "", vi: s.vi });
          }
        });
        return newArr;
      });
      
      setExtractedPronouns(prev => {
        const newArr = [...prev];
        result.pronouns.forEach(p => {
          if (!pronouns.some(existing => existing.speaker === p.speaker && existing.listener === p.listener) &&
              !newArr.some(existing => existing.speaker === p.speaker && existing.listener === p.listener)) {
            newArr.push(p);
          }
        });
        return newArr;
      });
    } catch (error: any) {
      const errMsg = error?.message?.toLowerCase() || "";
      if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('đã hết giới hạn api')) {
        setModelQuotaStatus(prev => ({ ...prev, [selectedModel]: 'quota_exceeded' }));
        showAlert(`Lỗi: Model ${selectedModel} đã hết hạn mức sử dụng (Quota exceeded). Vui lòng đổi model khác hoặc thiết lập API Key Gemini của riêng bạn.`);
        setIsAppConfigOpen(true);
      } else {
        showAlert("Đã xảy ra lỗi khi trích xuất quy tắc.");
      }
    } finally {
      setIsExtractingContext(false);
    }
  };

  const moveExtractedPronounToRules = (index: number) => {
    const item = extractedPronouns[index];
    setPronouns([...pronouns, { 
      id: Date.now().toString(), 
      ...item
    }]);
    setExtractedPronouns(extractedPronouns.filter((_, i) => i !== index));
  };

  const batchFromIndex = batchRange.from ? Math.max(0, parseInt(batchRange.from) - 1) : 0;
  const batchToIndex = batchRange.to && parseInt(batchRange.to) > 0 ? Math.min(batchChapters.length - 1, parseInt(batchRange.to) - 1) : Math.max(0, batchChapters.length - 1);
  const filteredBatchChapters = batchChapters.length > 0 ? batchChapters.slice(batchFromIndex, batchToIndex + 1) : [];
  const chaptersToTranslateCount = filteredBatchChapters.filter(c => c.status !== 'done').length;

  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] font-sans selection:bg-amber-500/30 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-[#222] px-6 flex items-center justify-between bg-[#0a0a0a] sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-gradient-to-br from-amber-500 to-red-600 rounded-lg text-black">
            <span className="font-bold text-xl">T</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            Novel Translator <span className="text-amber-500 text-xs font-mono ml-1 px-1.5 py-0.5 border border-amber-500/30 rounded">PRO</span>
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden sm:flex items-center gap-2 text-sm text-[#888]">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-[#111] text-[#888] text-sm border border-[#333] rounded px-2 py-1 focus:outline-none focus:border-amber-500/50"
            >
              {[
                  "gemini-2.5-flash",
                  "gemini-2.5-flash-lite",
                  "gemini-3.1-flash-lite"
              ].map(model => (
                <option key={model} value={model}>
                  {model} {modelQuotaStatus[model] === 'quota_exceeded' ? '❌' : '✅'}
                </option>
              ))}
            </select>
          </div>
          
          <button 
            onClick={() => setIsAppConfigOpen(true)}
            className="p-2 rounded-full text-[#888] hover:text-white hover:bg-[#222] transition-colors"
            title="Cài đặt hệ thống"
          >
            <Key className="w-4 h-4" />
          </button>

          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`px-5 py-2 rounded-full text-sm font-bold flex items-center gap-2 transition-colors ${
              isSettingsOpen ? 'bg-amber-500 text-black hover:bg-amber-400' : 'bg-white text-black hover:bg-amber-500'
            }`}
          >
            <Settings2 className="w-4 h-4" />
            <span className="hidden sm:inline">Cấu hình dịch</span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row h-full w-full overflow-hidden">
        
        {/* Left/Top Sidebar: Control Center */}
        <AnimatePresence initial={false}>
          {isSettingsOpen && (
            <motion.aside 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 340, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-r border-[#222] bg-[#0a0a0a] overflow-y-auto flex-shrink-0"
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            >
              <div className="w-72 p-5 flex flex-col gap-6">
                
                {/* Project Select */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Folder className="w-4 h-4 text-amber-500" />
                      <h2 className="text-[10px] uppercase tracking-[0.2em] text-amber-500 font-bold block">Quản lý Dự án</h2>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={activeProjectId}
                        onChange={(e) => setActiveProjectId(e.target.value)}
                        className="flex-1 bg-[#111] border border-[#333] text-sm text-white rounded px-2 py-1.5 focus:outline-none focus:border-amber-500/50"
                      >
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={createNewProject} className="flex-1 py-1.5 border border-[#333] hover:border-green-500/50 text-xs text-[#aaa] hover:text-green-400 rounded transition-colors flex items-center justify-center gap-1" title="Tạo dự án mới">
                        <Plus className="w-3.5 h-3.5" /> Tạo
                      </button>
                      <button onClick={renameProject} className="flex-1 py-1.5 border border-[#333] hover:border-amber-500/50 text-xs text-[#aaa] hover:text-amber-400 rounded transition-colors flex items-center justify-center gap-1" title="Đổi tên dự án">
                        <Edit2 className="w-3 h-3" /> Sửa
                      </button>
                      <button onClick={deleteProject} className="flex-1 py-1.5 border border-[#333] hover:border-red-500/50 text-xs text-[#aaa] hover:text-red-400 rounded transition-colors flex items-center justify-center gap-1" title="Xóa dự án">
                        <Trash2 className="w-3 h-3" /> Xóa
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={exportProject} className="flex-1 py-1.5 border border-[#333] hover:border-amber-500/50 text-xs text-[#aaa] hover:text-amber-400 rounded transition-colors flex items-center justify-center gap-1">
                         <Download className="w-3 h-3" /> Xuất
                      </button>
                      <label className="flex-1 py-1.5 border border-[#333] hover:border-emerald-500/50 text-xs text-[#aaa] hover:text-emerald-400 rounded transition-colors flex items-center justify-center gap-1 cursor-pointer">
                         <Upload className="w-3 h-3" /> Nhập
                         <input type="file" accept=".json" className="hidden" onChange={importProject} />
                      </label>
                    </div>
                  </div>
                </div>

                <hr className="border-[#222]" />

                {/* Source Language Select */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="w-4 h-4 text-amber-500" />
                    <h2 className="text-[10px] uppercase tracking-[0.2em] text-amber-500 font-bold block">Ngôn ngữ gốc</h2>
                  </div>
                  <select
                    value={activeProject.sourceLanguage || "Tiếng Trung"}
                    onChange={(e) => updateActiveProject({ sourceLanguage: e.target.value })}
                    className="w-full bg-[#111] border border-[#333] text-sm text-white rounded px-2 py-1.5 focus:outline-none focus:border-amber-500/50"
                  >
                    <option value="Tiếng Trung">Tiếng Trung</option>
                    <option value="Tiếng Hàn">Tiếng Hàn</option>
                    <option value="Tiếng Nhật">Tiếng Nhật</option>
                  </select>
                </div>

                <hr className="border-[#222]" />

                {/* Genre Select */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="w-4 h-4 text-amber-500" />
                    <h2 className="text-[10px] uppercase tracking-[0.2em] text-amber-500 font-bold block">Thể loại bối cảnh</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {GENRES.map(g => {
                      const isSelected = selectedGenres.includes(g);
                      return (
                        <button
                          key={g}
                          onClick={() => toggleGenre(g)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                            isSelected 
                              ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' 
                              : 'bg-[#151515] border-[#333] text-[#888] hover:border-[#555] hover:text-[#ccc]'
                          }`}
                        >
                          {g}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Pronoun Rules */}
                <div>
                  <div 
                    className="flex items-center justify-between mb-3 text-[#aaa] cursor-pointer hover:text-amber-500 transition-colors"
                    onClick={() => setIsPronounsExpanded(!isPronounsExpanded)}
                  >
                    <div className="flex items-center gap-2">
                      {isPronounsExpanded ? <ChevronDown className="w-4 h-4 text-amber-500" /> : <ChevronUp className="w-4 h-4 text-amber-500" />}
                      <UserCircle className="w-4 h-4 text-amber-500" />
                      <h2 className="text-[10px] uppercase tracking-[0.2em] text-amber-500 font-bold block">Đại từ xưng hô</h2>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); addPronoun(); }} 
                      className="p-1 hover:bg-[#1a1a1a] rounded-md text-amber-500 transition-colors border border-transparent hover:border-amber-500/30"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <AnimatePresence>
                    {isPronounsExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <p className="text-[11px] text-[#888] mb-2 leading-relaxed mt-1">Quy định cách nhân vật xưng hô với nhau (Ai gọi Ai là gì)</p>
                        
                        <div className="space-y-2">
                    {pronouns.map((rule) => (
                      <div key={rule.id} className="flex flex-col gap-2 p-2 bg-[#151515] border border-[#222] rounded-md relative">
                        <div className="flex gap-2">
                          <input 
                            type="text" placeholder="Người nói (A)" 
                            value={rule.speaker} onChange={(e) => updatePronoun(rule.id, 'speaker', e.target.value)}
                            className="flex-1 min-w-0 bg-[#050505] border border-[#333] rounded px-2 py-1.5 text-xs outline-none focus:border-amber-500/50"
                          />
                          <span className="text-[#555] text-[10px] flex items-center shrink-0 uppercase tracking-wider font-semibold">Nói Vị...</span>
                          <input 
                            type="text" placeholder="Người nghe (B)" 
                            value={rule.listener} onChange={(e) => updatePronoun(rule.id, 'listener', e.target.value)}
                            className="flex-1 min-w-0 bg-[#050505] border border-[#333] rounded px-2 py-1.5 text-xs outline-none focus:border-amber-500/50"
                          />
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 mt-1">
                          <div className="flex-1 flex items-center bg-[#0a0a0a] border border-[#222] rounded overflow-hidden focus-within:border-amber-500/50">
                            <span className="text-[10px] text-amber-500/80 px-2 uppercase font-bold shrink-0">Xưng:</span>
                            <input 
                              type="text" placeholder="Vd: tại hạ" 
                              value={rule.selfPronoun} onChange={(e) => updatePronoun(rule.id, 'selfPronoun', e.target.value)}
                              className="flex-1 w-full bg-transparent border-none py-1.5 pr-2 text-xs outline-none text-white placeholder:text-[#444]"
                            />
                          </div>
                          <div className="flex-1 flex items-center bg-[#0a0a0a] border border-[#222] rounded overflow-hidden focus-within:border-amber-500/50">
                            <span className="text-[10px] text-amber-500/80 px-2 uppercase font-bold shrink-0">Hô:</span>
                            <input 
                              type="text" placeholder="Vd: các hạ" 
                              value={rule.otherPronoun} onChange={(e) => updatePronoun(rule.id, 'otherPronoun', e.target.value)}
                              className="flex-1 w-full bg-transparent border-none py-1.5 pr-2 text-xs outline-none text-white placeholder:text-[#444]"
                            />
                          </div>
                        </div>
                        <button onClick={() => removePronoun(rule.id)} className="absolute -right-2 -top-2 p-1 text-[#555] opacity-50 hover:opacity-100 hover:text-red-400 bg-[#151515] rounded-full border border-[#333] transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {pronouns.length === 0 && (
                      <div className="text-[11px] text-[#555] text-center p-3 bg-[#151515] rounded-md border border-[#222]">
                        Chưa có quy tắc xưng hô nào.
                      </div>
                    )}
                  </div>
                  <div className="pt-2">
                    <div className="flex gap-2">
                      <button onClick={exportPronouns} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-[#151515] border border-[#222] hover:border-amber-500/50 hover:text-amber-500 rounded text-xs transition-colors text-[#888]">
                        <Download className="w-3.5 h-3.5" /> Xuất xưng hô
                      </button>
                      <label className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-[#151515] border border-[#222] hover:border-amber-500/50 hover:text-amber-500 rounded text-xs transition-colors cursor-pointer text-[#888]">
                        <Upload className="w-3.5 h-3.5" /> Nhập (.txt)
                        <input type="file" accept=".txt" className="hidden" onChange={importPronouns} />
                      </label>
                    </div>
                  </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Specific Nouns */}
                <div>
                  <div 
                    className="flex items-center justify-between mb-3 text-[#aaa] cursor-pointer hover:text-amber-500 transition-colors"
                    onClick={() => setIsNamesExpanded(!isNamesExpanded)}
                  >
                    <div className="flex items-center gap-2">
                      {isNamesExpanded ? <ChevronDown className="w-4 h-4 text-amber-500" /> : <ChevronUp className="w-4 h-4 text-amber-500" />}
                      <BookOpen className="w-4 h-4 text-amber-500" />
                      <h2 className="text-[10px] uppercase tracking-[0.2em] text-amber-500 font-bold block">Danh từ riêng</h2>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); addName(); }}
                      className="p-1 hover:bg-[#1a1a1a] rounded-md text-amber-500 transition-colors border border-transparent hover:border-amber-500/30"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <AnimatePresence>
                    {isNamesExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <p className="text-[11px] text-[#888] mb-2 leading-relaxed mt-1">Cố định dịch tên nhân vật, địa danh, chiêu thức.</p>
                        
                        <div className="space-y-2">
                    {names.map((rule) => (
                      <div key={rule.id} className="flex gap-2">
                        <input 
                          type="text" placeholder="Từ gốc" 
                          value={rule.zh} onChange={(e) => updateName(rule.id, 'zh', e.target.value)}
                          className="flex-1 min-w-0 bg-[#151515] border border-[#222] rounded-md px-3 py-2 text-xs outline-none focus:border-amber-500/50"
                        />
                        <input 
                          type="text" placeholder="Tiếng Việt" 
                          value={rule.vi} onChange={(e) => updateName(rule.id, 'vi', e.target.value)}
                          className="flex-1 min-w-0 bg-[#151515] border border-[#222] rounded-md px-3 py-2 text-xs outline-none focus:border-amber-500/50"
                        />
                        <button onClick={() => removeName(rule.id)} className="p-2 text-[#555] hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {names.length === 0 && (
                      <div className="text-[11px] text-[#555] text-center p-3 bg-[#151515] rounded-md border border-[#222]">
                        Chưa có danh từ riêng nào.
                      </div>
                    )}
                  </div>
                  <div className="pt-2">
                    <div className="flex gap-2">
                      <button onClick={exportNames} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-[#151515] border border-[#333] hover:border-amber-500/50 hover:text-amber-500 rounded text-xs transition-colors text-[#888]">
                        <Download className="w-3.5 h-3.5" /> Xuất danh từ
                      </button>
                      <label className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-[#151515] border border-[#333] hover:border-amber-500/50 hover:text-amber-500 rounded text-xs transition-colors cursor-pointer text-[#888]">
                        <Upload className="w-3.5 h-3.5" /> Nhập (.txt)
                        <input type="file" accept=".txt" className="hidden" onChange={importNames} />
                      </label>
                    </div>
                  </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Suggested Names Section */}
                <AnimatePresence>
                  {suggestedNames.length > 0 && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="space-y-3 pt-4 border-t border-amber-500/10"
                    >
                      <div className="flex items-center justify-between text-slate-300">
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-amber-500 animate-pulse" />
                          <h2 className="text-[10px] uppercase tracking-[0.2em] text-amber-500 font-bold block">Gợi ý từ bản dịch</h2>
                        </div>
                        <button 
                          onClick={() => setSuggestedNames([])} 
                          className="text-[10px] text-[#555] hover:text-white uppercase transition-colors"
                        >
                          Xóa hết
                        </button>
                      </div>
                      <p className="text-[10px] text-[#666] leading-relaxed italic">AI đã phát hiện các danh từ sau. Chọn {<Plus className="inline w-3 h-3"/>} để lưu vào quy định.</p>
                      
                      <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                        {suggestedNames.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-amber-500/5 rounded border border-amber-500/10 group">
                            <div className="flex flex-col">
                              <span className="text-[11px] text-white font-medium">{item.vi}</span>
                              <span className="text-[9px] text-amber-500/50">{item.zh}</span>
                            </div>
                            <button 
                              onClick={() => moveSuggestedToNames(idx)}
                              className="p-1.5 bg-[#0a0a0a] border border-[#333] rounded hover:border-amber-500/50 hover:text-amber-500 transition-all shadow-sm"
                              title="Thêm vào danh sách chính thức"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Suggested Pronouns Section */}
                <AnimatePresence>
                  {extractedPronouns.length > 0 && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="space-y-3 pt-4 border-t border-amber-500/10"
                    >
                      <div className="flex items-center justify-between text-slate-300">
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-emerald-500 animate-pulse" />
                          <h2 className="text-[10px] uppercase tracking-[0.2em] text-emerald-500 font-bold block">Gợi ý xưng hô</h2>
                        </div>
                        <button 
                          onClick={() => setExtractedPronouns([])} 
                          className="text-[10px] text-[#555] hover:text-white uppercase transition-colors"
                        >
                          Xóa hết
                        </button>
                      </div>
                      
                      <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                        {extractedPronouns.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-emerald-500/5 rounded border border-emerald-500/10 group">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] text-amber-500/80">{item.speaker} → {item.listener}</span>
                              <span className="text-[11px] text-white font-medium">Xưng: {item.selfPronoun} | Hô: {item.otherPronoun}</span>
                            </div>
                            <button 
                              onClick={() => moveExtractedPronounToRules(idx)}
                              className="p-1.5 bg-[#0a0a0a] border border-[#333] rounded hover:border-emerald-500/50 hover:text-emerald-500 transition-all shadow-sm"
                              title="Thêm vào danh sách chính thức"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Translation Workspace */}
        <section className="flex-1 flex flex-col pt-[1px] bg-[#222] overflow-y-auto">
          {/* Top Tab Bar */}
          <div className="flex items-center justify-center p-4 bg-[#0a0a0a] border-b border-[#333]">
            <div className="flex bg-[#151515] p-1 rounded-full border border-[#222]">
              <button 
                onClick={() => setActiveTab('translate')}
                className={`px-6 py-2 rounded-full text-sm font-semibold transition-colors ${activeTab === 'translate' ? 'bg-[#333] text-white shadow-sm' : 'text-[#888] hover:text-[#ccc]'}`}
              >
                🪄 Dịch Thuật
              </button>
              <button 
                onClick={() => setActiveTab('batch')}
                className={`px-6 py-2 rounded-full text-sm font-semibold transition-colors ${activeTab === 'batch' ? 'bg-[#333] text-white shadow-sm' : 'text-[#888] hover:text-[#ccc]'}`}
              >
                📚 Dịch File
              </button>
              <button 
                onClick={() => setActiveTab('context')}
                className={`px-6 py-2 rounded-full text-sm font-semibold transition-colors ${activeTab === 'context' ? 'bg-[#333] text-white shadow-sm' : 'text-[#888] hover:text-[#ccc]'}`}
              >
                🧠 Rút Trích Quy Tắc
              </button>
              <button 
                onClick={() => setActiveTab('history')}
                className={`px-6 py-2 rounded-full text-sm font-semibold transition-colors ${activeTab === 'history' ? 'bg-[#333] text-white shadow-sm' : 'text-[#888] hover:text-[#ccc]'}`}
              >
                📜 Lịch Sử Dịch
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-4 relative max-w-5xl mx-auto w-full px-4 py-8 md:px-8">
            {activeTab === 'translate' && (
              <>
                {/* Source Area */}
                <div className="flex flex-col h-[280px] md:h-[320px] bg-[#050505] p-6 lg:p-8 border border-[#333] rounded-xl shadow-lg relative">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-mono text-[#555] uppercase">Source: {activeProject.sourceLanguage || "Tiếng Trung"}</span>
                    <span className="text-[#555] text-xs">
                      {sourceText.trim() ? sourceText.trim().split(/\s+/).length : 0} words | {sourceText.length} chars
                    </span>
                  </div>
                  <textarea
                    className="flex-1 w-full bg-transparent border-none resize-none text-lg leading-relaxed text-[#ccc] focus:outline-none"
                    placeholder="Dán chương truyện nguồn vào đây..."
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
                    spellCheck="false"
                  />
                </div>

                {/* Translate Button Central */}
                <div className="flex justify-center -my-2 z-20 relative">
                  {isTranslating ? (
                    <button 
                      onClick={handleStopTranslate}
                      className="pointer-events-auto bg-red-900/80 hover:bg-red-800 transition-colors text-white px-8 py-3 rounded-full shadow-[0_0_20px_rgba(220,38,38,0.3)] flex items-center font-bold text-sm border border-red-500/50"
                    >
                      <Loader2 className="w-5 h-5 mr-2 animate-spin text-red-300" />
                      Dừng Dịch...
                    </button>
                  ) : (
                    <button 
                      onClick={handleTranslate}
                      disabled={!sourceText.trim()}
                      className="pointer-events-auto bg-amber-500 hover:bg-amber-400 transition-colors text-black px-8 py-3 rounded-full shadow-[0_0_20px_rgba(245,158,11,0.2)] disabled:opacity-50 disabled:shadow-none flex items-center font-bold text-sm"
                    >
                      <ArrowRightLeft className="w-5 h-5 mr-2" />
                      Dịch Nội Dung
                    </button>
                  )}
                </div>

                {/* Result Area */}
                <div className="flex flex-col h-[320px] md:h-[450px] bg-[#080808] p-6 lg:p-8 relative border border-[#333] rounded-xl shadow-lg">
                  <div className="flex items-center justify-between mb-4 relative z-10">
                    <span className="text-[10px] font-mono text-amber-500 uppercase">Target: Vietnamese (Advanced)</span>
                    <div className="flex gap-3 items-center">
                      <span className="text-[#555] text-xs">
                        {translatedText.trim() ? translatedText.trim().split(/\s+/).length : 0} words | {translatedText.length} chars
                      </span>
                      {isTranslating && <Loader2 className="w-4 h-4 animate-spin text-amber-500" />}
                      <button 
                        onClick={handleCopy}
                        disabled={!translatedText}
                        className="flex items-center gap-1.5 text-xs text-[#888] hover:text-white disabled:text-[#444] transition-colors"
                      >
                        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        <span>{copied ? 'Đã sao chép' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 w-full relative overflow-y-auto">
                    {!translatedText && !isTranslating && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-[#555] pointer-events-none text-center">
                        <p className="text-[#888] font-medium text-sm">Waiting for input...</p>
                        <p className="text-[11px] mt-2 max-w-xs leading-relaxed text-[#555]">Hệ thống sẽ áp dụng cấu trúc ngữ pháp và từ vựng chuyên ngành theo bộ quy tắc đã chọn.</p>
                      </div>
                    )}
                    
                    {/* Render Result (Preserving basic whitespace) */}
                    {translatedText && (
                      <div className="text-lg leading-relaxed text-[#eee] whitespace-pre-wrap">
                        {translatedText}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'batch' && (
              <div className="flex-1 flex flex-col gap-6 relative max-w-5xl mx-auto w-full px-4 md:px-8 overflow-y-auto pb-8">
                <div className="bg-[#050505] p-6 lg:p-8 border border-[#333] rounded-xl shadow-lg">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <Folder className="w-5 h-5 text-amber-500" />
                      Dịch Tệp Hàng Loạt
                    </h2>
                    <div className="flex gap-4 items-center">
                      {batchChapters.length > 0 && (
                        <>
                          <div className="flex items-center gap-2 mr-2">
                            <span className="text-sm text-[#888]">Từ chương:</span>
                            <input 
                              type="number" 
                              min="1" 
                              max={batchChapters.length}
                              value={batchRange.from} 
                              onChange={(e) => setBatchRange(prev => ({...prev, from: e.target.value}))}
                              placeholder="1"
                              className="w-16 bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-amber-500 text-center"
                            />
                            <span className="text-sm text-[#888]">Đến:</span>
                            <input 
                              type="number" 
                              min="1" 
                              max={batchChapters.length}
                              value={batchRange.to} 
                              onChange={(e) => setBatchRange(prev => ({...prev, to: e.target.value}))}
                              placeholder={batchChapters.length.toString()}
                              className="w-16 bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-amber-500 text-center"
                            />
                          </div>
                          {isBatchTranslating ? (
                            <button 
                              onClick={handleStopBatchTranslate}
                              className="px-6 py-2 rounded-md font-bold text-white bg-red-900/80 hover:bg-red-800 border border-red-500/50 flex items-center shadow-[0_0_15px_rgba(220,38,38,0.3)] transition-all"
                            >
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Dừng Dịch
                            </button>
                          ) : (
                            <button 
                              onClick={handleStartBatchTranslate}
                              className="px-6 py-2 rounded-md font-bold text-black bg-amber-500 hover:bg-amber-400 flex items-center shadow-[0_0_15px_rgba(245,158,11,0.2)] transition-all"
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Bắt Đầu Dịch ({chaptersToTranslateCount} chương)
                            </button>
                          )}
                          <button 
                            onClick={handleExportBatch}
                            className="px-6 py-2 rounded-md font-bold text-white bg-[#222] hover:bg-[#333] border border-[#444] flex items-center transition-all"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Xuất TXT
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mb-6 flex flex-col gap-2">
                    <label className="flex items-center gap-3 cursor-pointer bg-[#111] hover:bg-[#1a1a1a] border border-[#333] rounded-lg p-6 text-center transition-colors">
                      <Upload className="w-6 h-6 text-amber-500 mx-auto mb-2" />
                      <div className="flex-1 text-left ml-4">
                        <span className="block text-sm font-bold text-white">Tải lên tệp truyện (.txt, .epub)</span>
                        <span className="block text-xs text-[#888] mt-1">Hệ thống có thể chia chương TXT hoặc trích xuất nội dung từ EPUB.</span>
                      </div>
                      <input 
                        type="file" 
                        accept=".txt,.epub" 
                        onChange={handleBatchFileSelect} 
                        className="hidden" 
                      />
                    </label>
                  </div>

                  {batchChapters.length > 0 && (
                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                      {filteredBatchChapters.map((chapter, idx) => (
                        <div key={chapter.id} className="border border-[#222] rounded-lg bg-[#0a0a0a] overflow-hidden">
                          <div className="flex items-center justify-between p-4 bg-[#111] border-b border-[#222]">
                            <h3 className="font-bold text-sm text-white">{chapter.title}</h3>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-[#666]">{chapter.content.length} ký tự</span>
                              <span className={`text-xs font-bold px-2 py-1 rounded
                                ${chapter.status === 'done' ? 'bg-green-900/30 text-green-400' :
                                  chapter.status === 'translating' ? 'bg-amber-900/30 text-amber-400' :
                                  chapter.status === 'error' ? 'bg-red-900/30 text-red-400' :
                                  'bg-[#222] text-[#888]'}`}
                              >
                                {chapter.status === 'done' ? 'Đã dịch' :
                                 chapter.status === 'translating' ? 'Đang dịch...' :
                                 chapter.status === 'error' ? 'Lỗi' : 'Chờ dịch'}
                              </span>
                            </div>
                          </div>
                          {(chapter.status === 'translating' || chapter.status === 'done') && chapter.translated && (
                            <div className="p-4 text-sm text-[#ccc] bg-[#050505] max-h-40 overflow-y-auto whitespace-pre-wrap">
                              {chapter.translated.substring(0, 300)}
                              {chapter.translated.length > 300 && <span className="text-[#888]">...</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {batchChapters.length === 0 && (
                     <div className="text-center py-12 text-[#555]">
                        <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p className="text-sm">Chưa có tệp nào được tải lên.</p>
                     </div>
                  )}
                </div>
              </div>
            )}
            
            {activeTab === 'context' && (
              <>
                {/* Extract Rules Area */}
                <div className="flex-1 flex flex-col h-[600px] bg-[#050505] p-6 lg:p-8 border border-[#333] rounded-xl shadow-lg relative">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-mono text-emerald-500 uppercase">Context Extraction</span>
                    <span className="text-[#555] text-xs">{contextText.length} chars</span>
                  </div>
                  <p className="text-xs text-[#888] mb-4">
                    Dán một đoạn hoặc một chương đã dịch vào đây. AI sẽ phân tích văn cảnh để tìm ra danh từ riêng và quy tắc xưng hô cho bạn. Các quy tắc sẽ được cập nhật vào "Gợi ý" ở phần Cấu Hình.
                  </p>
                  <textarea
                    className="flex-1 w-full bg-transparent border-none resize-none text-lg leading-relaxed text-[#ccc] focus:outline-none mb-6"
                    placeholder="Dán đoạn truyện dịch ở đây..."
                    value={contextText}
                    onChange={(e) => setContextText(e.target.value)}
                    spellCheck="false"
                  />
                  <div className="flex items-center justify-center">
                    <button 
                      onClick={handleExtractContext}
                      disabled={isExtractingContext || !contextText.trim()}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition-all flex items-center font-bold"
                    >
                      {isExtractingContext ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin mr-2" />
                          Đang phân tích...
                        </>
                      ) : (
                        <>
                          <Zap className="w-5 h-5 mr-2" />
                          Rút Lấy Quy Tắc
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'history' && (
              <div className="flex-1 flex flex-col h-[600px] bg-[#050505] p-6 lg:p-8 border border-[#333] rounded-xl shadow-lg relative overflow-y-auto">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-[10px] font-mono text-amber-500 uppercase">Translation History</span>
                  <div className="flex gap-4 items-center">
                    {activeProject.history && activeProject.history.length > 0 && (
                      <button onClick={clearHistory} className="text-xs text-red-500 hover:text-red-400 font-semibold px-2 py-1 rounded bg-[rgba(255,0,0,0.1)] hover:bg-[rgba(255,0,0,0.2)] transition-colors">
                        Xóa Tất Cả
                      </button>
                    )}
                    <span className="text-[#555] text-xs">{(activeProject.history || []).length} mục</span>
                  </div>
                </div>
                {(!activeProject.history || activeProject.history.length === 0) ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-[#555]">
                    <Clock className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-sm">Chưa có lịch sử dịch nào cho dự án này.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activeProject.history.map((item, idx) => (
                      <div key={item.id} className="bg-[#0a0a0a] border border-[#222] rounded-lg p-4 group">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-bold text-white text-md">{item.title}</h3>
                          <span className="text-xs text-[#666]">{new Date(item.date).toLocaleString()}</span>
                        </div>
                        <div className="flex gap-4 mt-2 justify-between items-center">
                          <button 
                            onClick={() => {
                              setSourceText(item.sourceText);
                              setTranslatedText(item.translatedText);
                              setActiveTab('translate');
                            }}
                            className="text-xs text-amber-500 hover:text-amber-400 font-semibold p-1.5 -ml-1.5 hover:bg-[#222] rounded transition-colors"
                          >
                            Tải lại vào Trình dịch
                          </button>
                          <button
                            onClick={() => deleteHistoryItem(item.id)}
                            className="text-xs text-red-500 hover:text-red-400 font-semibold opacity-50 group-hover:opacity-100 transition-opacity p-1.5 -mr-1.5 hover:bg-[rgba(255,0,0,0.1)] rounded"
                          >
                            Xóa
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Status Bar */}
          <footer className="h-6 bg-amber-600 text-black px-4 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider shrink-0">
            <span>Novel Translator Pro Engine Active</span>
            <span>API Status: Stable</span>
          </footer>
        </section>

      </main>

      {/* App Config Modal */}
      <AnimatePresence>
        {isAppConfigOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-[#0a0a0a] border border-[#222] rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="flex items-center justify-between p-4 border-b border-[#222]">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-amber-500" />
                  Cài đặt hệ thống
                </h3>
                <button 
                  onClick={() => setIsAppConfigOpen(false)}
                  className="text-[#888] hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-[#ccc] mb-2">Gemini API Key</label>
                  <input 
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="Nhập API Key của bạn (bỏ trống để dùng mặc định)"
                    className="w-full bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                  />
                  <p className="text-xs text-[#666] mt-2">
                    Key này sẽ lưu ở thiết bị của bạn. Chỉ nhập key nếu bạn báo lỗi hết hạn mức hoặc muốn dùng riêng.
                  </p>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button 
                    onClick={() => setIsAppConfigOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-[#888] hover:text-white transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button 
                    onClick={saveApiKey}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded font-medium text-sm transition-colors flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" /> Lưu thông tin
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dialogState.isOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#111] border border-[#333] p-6 rounded-xl shadow-2xl max-w-sm w-full"
            >
              <h3 className="text-lg font-bold text-white mb-2">{dialogState.title}</h3>
              <p className="text-sm text-[#888] mb-4">{dialogState.description}</p>
              
              {(dialogState.type === 'create' || dialogState.type === 'rename') && (
                <input 
                  type="text" 
                  value={dialogState.inputValue}
                  onChange={(e) => setDialogState(prev => ({ ...prev, inputValue: e.target.value }))}
                  className="w-full bg-[#050505] border border-[#333] text-white rounded px-3 py-2 mb-4 focus:outline-none focus:border-amber-500"
                  placeholder="Nhập tên tại đây..."
                  autoFocus
                />
              )}
              
              <div className="flex justify-end gap-3 mt-6">
                {dialogState.type !== 'alert' && (
                  <button 
                    onClick={() => setDialogState(prev => ({ ...prev, isOpen: false }))}
                    className="px-4 py-2 text-sm font-medium text-[#888] hover:text-white transition-colors"
                  >
                    Hủy bỏ
                  </button>
                )}
                <button 
                  onClick={() => dialogState.onConfirm(dialogState.inputValue)}
                  className={`px-4 py-2 rounded font-medium text-sm transition-colors flex items-center gap-2 ${
                    dialogState.type === 'delete' 
                      ? 'bg-red-500 hover:bg-red-400 text-white' 
                      : 'bg-amber-500 hover:bg-amber-400 text-black'
                  }`}
                >
                  {dialogState.type === 'alert' ? 'Đóng' : 'Xác nhận'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

