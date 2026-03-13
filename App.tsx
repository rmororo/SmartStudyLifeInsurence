
import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, QuestionData, ExamSession, HistoryEntry, UserProfile, GlobalStats } from './types';
import { analyzeQuestionImage } from './services/geminiService';
import { getAllSavedExams, saveExamToLocal, deleteExamFromLocal, getGlobalStats } from './services/storageService';
import ExamView from './components/ExamView';
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, db, doc, setDoc, getDoc } from './src/firebase';

const REQUEST_SPACING = 5000; 
const CACHE_KEY = 'exam_ai_cache_trilingual_v1';
const HISTORY_KEY = 'exam_history_v1';

interface ProcessLog {
  fileName: string;
  status: 'pending' | 'cached' | 'ai' | 'error';
  message: string;
}

const App: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [status, setStatus] = useState<AppStatus>(AppStatus.SETUP);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [savedExams, setSavedExams] = useState<ExamSession[]>([]);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [currentFilePath, setCurrentFilePath] = useState("");
  const [logs, setLogs] = useState<ProcessLog[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  
  // States para controle de duplicatas
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [duplicatesFound, setDuplicatesFound] = useState<number>(0);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [folderName, setFolderName] = useState("");

  const questionsRef = useRef<QuestionData[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser: any) => {
      setUser(currentUser);
      if (currentUser) {
        await syncUserProfile(currentUser);
        loadInitialData();
      } else {
        setStatus(AppStatus.SETUP);
      }
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      loadInitialData();
    }
  }, [status, user]);

  const syncUserProfile = async (currentUser: any) => {
    const userRef = doc(db, 'users', currentUser.uid);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      const newProfile: UserProfile = {
        uid: currentUser.uid,
        email: currentUser.email || '',
        displayName: currentUser.displayName || '',
        photoURL: currentUser.photoURL || '',
        totalExams: 0,
        averageScore: 0,
        lastExamDate: new Date().toISOString()
      };
      await setDoc(userRef, newProfile);
      setUserProfile(newProfile);
    } else {
      setUserProfile(userSnap.data() as UserProfile);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setStatus(AppStatus.SETUP);
  };

  const loadInitialData = async () => {
    if (!user) return;
    try {
      const exams = await getAllSavedExams();
      setSavedExams(exams);
      
      const stats = await getGlobalStats();
      setGlobalStats(stats);
    } catch (e) { console.error(e); }
  };

  const saveToHistory = (finalSession: ExamSession) => {
    const newEntry: HistoryEntry = {
      id: finalSession.id,
      date: new Date().toLocaleString('pt-BR'),
      folderName: finalSession.folderName,
      score: finalSession.score,
      total: finalSession.questions.length,
      accuracy: Math.round((finalSession.score / finalSession.questions.length) * 100)
    };
    const updatedHistory = [newEntry, ...history];
    setHistory(updatedHistory);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files) as (File & { webkitRelativePath?: string })[];
    const validImageFiles = fileArray.filter(file => 
      file.type.startsWith('image/png') || file.type.startsWith('image/jpeg')
    );
    
    if (validImageFiles.length === 0) return;

    const name = validImageFiles[0].webkitRelativePath?.split('/')[0] || "Simulado Local";
    setFolderName(name);

    // Checar duplicatas antes de começar
    const cacheRaw = localStorage.getItem(CACHE_KEY);
    const cache = cacheRaw ? JSON.parse(cacheRaw) : {};
    
    let dups = 0;
    validImageFiles.forEach(f => {
      const id = `${f.name}_${f.size}`;
      if (cache[id]) dups++;
    });

    if (dups > 0) {
      setDuplicatesFound(dups);
      setPendingFiles(validImageFiles);
      setShowDuplicateModal(true);
    } else {
      startProcessing(validImageFiles, false);
    }
  };

  const startProcessing = async (files: File[], forceRefresh: boolean) => {
    setShowDuplicateModal(false);
    setStatus(AppStatus.LOADING);
    setProcessedCount(0);
    setTotalToProcess(files.length);
    setLogs([]);
    questionsRef.current = [];

    const cacheRaw = localStorage.getItem(CACHE_KEY);
    const cache = forceRefresh ? {} : (cacheRaw ? JSON.parse(cacheRaw) : {});

    for (const file of files) {
      const cacheId = `${file.name}_${file.size}`;
      setCurrentFilePath(file.name);
      
      const newLog: ProcessLog = { fileName: file.name, status: 'pending', message: 'Aguardando...' };
      setLogs(prev => [newLog, ...prev].slice(0, 50));

      try {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });

        let result;
        if (cache[cacheId] && !forceRefresh) {
          result = cache[cacheId];
          setLogs(prev => prev.map(l => l.fileName === file.name ? { ...l, status: 'cached', message: 'Recuperado do Banco Local' } : l));
        } else {
          setLogs(prev => prev.map(l => l.fileName === file.name ? { ...l, status: 'pending', message: 'Analisando via Gemini AI...' } : l));
          result = await analyzeQuestionImage(base64);
          cache[cacheId] = result;
          localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
          setLogs(prev => prev.map(l => l.fileName === file.name ? { ...l, status: 'ai', message: 'Processado por IA com Sucesso' } : l));
          await new Promise(r => setTimeout(r, REQUEST_SPACING));
        }

        questionsRef.current.push({
          id: `q-${Math.random().toString(36).substr(2, 9)}`,
          image: base64,
          texts: { question: result.question, options: result.options },
          correctAnswer: result.correctAnswer,
          explanations: result.explanations
        });
      } catch (err: any) {
        console.error("Processing error for", file.name, err);
        const errorMessage = err.message || "Erro desconhecido";
        setLogs(prev => prev.map(l => l.fileName === file.name ? { ...l, status: 'error', message: `Erro: ${errorMessage}` } : l));
      } finally {
        setProcessedCount(prev => prev + 1);
      }
    }

    try {
      const newSession: ExamSession = {
        id: Date.now().toString(),
        folderName,
        questions: [...questionsRef.current],
        currentIndex: 0,
        score: 0,
        answers: {},
        isFinished: false,
        isStillLoading: false
      };

      await saveExamToLocal(newSession);
      setSession(newSession);
      setStatus(AppStatus.EXAM);
    } catch (err: any) {
      console.error("Error creating session:", err);
      // Even if saving fails, let the user take the exam
      const fallbackSession: ExamSession = {
        id: Date.now().toString(),
        folderName,
        questions: [...questionsRef.current],
        currentIndex: 0,
        score: 0,
        answers: {},
        isFinished: false,
        isStillLoading: false
      };
      setSession(fallbackSession);
      setStatus(AppStatus.EXAM);
    }
  };

  const reset = () => {
    setStatus(AppStatus.SETUP);
    setSession(null);
    setProcessedCount(0);
    setLogs([]);
    questionsRef.current = [];
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Modal de Duplicatas */}
      {showDuplicateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-[2.5rem] p-10 max-w-lg w-full shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-3xl flex items-center justify-center mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h3 className="text-2xl font-black mb-2 text-slate-900">Questões Repetidas!</h3>
            <p className="text-slate-500 mb-8 leading-relaxed">
              Encontramos <strong>{duplicatesFound} imagens</strong> que já foram processadas anteriormente. Deseja usar os dados salvos no seu laptop ou processar tudo novamente pela IA?
            </p>
            <div className="flex flex-col gap-3">
              <button onClick={() => startProcessing(pendingFiles, false)} className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-indigo-700 transition-all flex justify-between items-center px-6">
                <span>PULAR DUPLICATAS (RECOMENDADO)</span>
                <span className="text-[10px] bg-white/20 px-2 py-1 rounded">FAST</span>
              </button>
              <button onClick={() => startProcessing(pendingFiles, true)} className="w-full bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl hover:bg-slate-200 transition-all">
                PROCESSAR TUDO NOVAMENTE
              </button>
              <button onClick={() => setShowDuplicateModal(false)} className="w-full text-slate-400 font-bold py-2 mt-2">CANCELAR</button>
            </div>
          </div>
        </div>
      )}

      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3 cursor-pointer" onClick={reset}>
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg transition-transform hover:scale-105">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5a18.022 18.022 0 01-3.827-5.802M10.474 11c1.171 1.027 2.687 1.75 4.526 2.148M9 16c.143.03.284.06.425.088m8.711-2.088a14.39 14.39 0 01-2.417-1.428" /></svg>
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-800 tracking-tight leading-none">TrilingualPro</h1>
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div> On-Premise Engine
              </span>
            </div>
          </div>
          {user ? (
            <div className="flex items-center gap-4">
              <button onClick={() => setStatus(AppStatus.STATS)} className="text-sm font-bold text-indigo-600 hover:text-indigo-800">Estatísticas</button>
              <div className="flex items-center gap-2">
                <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-slate-200" />
                <button onClick={handleLogout} className="text-sm font-bold text-slate-400 hover:text-rose-500">Sair</button>
              </div>
            </div>
          ) : (
            <button onClick={handleLogin} className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold text-sm shadow-md hover:bg-indigo-700 transition-all">Entrar com Google</button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4">
        {isAuthLoading ? (
          <div className="py-40 flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-slate-400 font-bold animate-pulse">Verificando autenticação...</p>
          </div>
        ) : !user ? (
          <div className="py-20 text-center max-w-2xl mx-auto">
            <div className="w-24 h-24 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            </div>
            <h2 className="text-5xl font-black mb-6 tracking-tight text-slate-900 leading-tight">Estude com Inteligência Artificial.</h2>
            <p className="text-xl text-slate-500 mb-12 leading-relaxed">Para salvar seus simulados, acompanhar sua evolução e acessar o ranking global, você precisa estar conectado.</p>
            <button onClick={handleLogin} className="group relative bg-indigo-600 text-white px-12 py-5 rounded-[2rem] font-black text-xl shadow-2xl hover:bg-indigo-700 transition-all hover:scale-105 active:scale-95 flex items-center gap-4 mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 488 512" fill="currentColor"><path d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"/></svg>
              ENTRAR COM GOOGLE
            </button>
            <p className="mt-8 text-slate-400 text-sm font-medium">Seus dados são processados de forma segura e privada.</p>
          </div>
        ) : status === AppStatus.SETUP ? (
          <div className="py-12 grid grid-cols-1 lg:grid-cols-12 gap-12">
            <div className="lg:col-span-5">
              <div className="sticky top-28">
                <h2 className="text-4xl font-black mb-6 tracking-tight text-slate-900 leading-tight">Estudos sem Retrabalho.</h2>
                <p className="text-lg text-slate-500 mb-8 leading-relaxed">O sistema detecta automaticamente se uma imagem já foi enviada e utiliza o cache local para evitar custos desnecessários com a IA.</p>
                <div className="bg-white p-10 rounded-[2.5rem] shadow-xl border border-slate-100">
                  <label className="inline-block cursor-pointer group w-full text-center">
                    <div className="mb-6 w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto group-hover:scale-110 transition-transform"><svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg></div>
                    <span className="bg-indigo-600 group-hover:bg-indigo-700 text-white font-black py-4 px-10 rounded-2xl shadow-xl transition-all block text-base">Processar Pasta</span>
                    <input type="file" {...({ webkitdirectory: "true", directory: "true" } as any)} multiple onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              </div>
            </div>
            <div className="lg:col-span-7">
               <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Simulados Salvos no Laptop ({savedExams.length})</h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {savedExams.map(exam => (
                    <div key={exam.id} onClick={() => { setSession(exam); setStatus(AppStatus.EXAM); }} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl transition-all cursor-pointer group relative overflow-hidden">
                       <div className="flex justify-between mb-4">
                          <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg></div>
                          <button onClick={async (e) => { e.stopPropagation(); await deleteExamFromLocal(exam.id); loadInitialData(); }} className="text-slate-200 hover:text-rose-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                       </div>
                       <h4 className="font-bold text-slate-800 truncate">{exam.folderName}</h4>
                       <p className="text-[10px] font-black text-indigo-500 uppercase mt-2 tracking-tighter">{exam.questions.length} Questões Prontas</p>
                    </div>
                  ))}
               </div>
            </div>
          </div>
        ) : null}

        {status === AppStatus.LOADING && (
          <div className="py-20 max-w-4xl mx-auto">
             <div className="flex gap-12 items-start">
                <div className="w-1/3 sticky top-32 text-center">
                   <div className="w-32 h-32 mx-auto mb-6 relative">
                      <svg className="w-full h-full -rotate-90">
                        <circle cx="64" cy="64" r="50" className="stroke-slate-100 fill-none stroke-[8]" />
                        <circle cx="64" cy="64" r="50" className="stroke-indigo-600 fill-none stroke-[8] transition-all duration-500" style={{ strokeDasharray: 314, strokeDashoffset: 314 - (314 * processedCount / totalToProcess) }} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center font-black">{Math.round((processedCount/totalToProcess)*100)}%</div>
                   </div>
                   <h3 className="text-2xl font-black mb-2">Processando...</h3>
                   <p className="text-slate-400 font-bold text-xs uppercase mb-6">{processedCount} de {totalToProcess} Arquivos</p>
                   
                   {processedCount === totalToProcess && (
                     <button 
                       onClick={() => setStatus(AppStatus.EXAM)}
                       className="w-full bg-emerald-500 text-white font-black py-3 rounded-xl shadow-lg hover:bg-emerald-600 transition-all animate-bounce mb-4"
                     >
                       INICIAR SIMULADO
                     </button>
                   )}

                   <button 
                     onClick={reset}
                     className="text-slate-400 hover:text-slate-600 font-bold text-sm underline underline-offset-4"
                   >
                     Cancelar e Voltar
                   </button>
                </div>

                <div className="w-2/3 bg-white rounded-[2.5rem] border border-slate-100 shadow-xl overflow-hidden">
                   <div className="p-6 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Log de Auditoria Local</h4>
                      <div className="flex gap-2">
                         <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                         <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                         <div className="w-2 h-2 rounded-full bg-slate-300"></div>
                      </div>
                   </div>
                   <div className="h-[400px] overflow-y-auto p-4 space-y-2">
                      {logs.map((log, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 text-[11px] animate-in slide-in-from-right-2">
                           <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${log.status === 'cached' ? 'bg-emerald-500' : log.status === 'ai' ? 'bg-indigo-500' : log.status === 'error' ? 'bg-rose-500' : 'bg-slate-300 animate-pulse'}`}></div>
                              <span className="font-bold text-slate-700 truncate max-w-[150px]">{log.fileName}</span>
                           </div>
                           <span className={`font-black uppercase tracking-tighter ${log.status === 'cached' ? 'text-emerald-600' : log.status === 'ai' ? 'text-indigo-600' : 'text-slate-400'}`}>{log.message}</span>
                        </div>
                      ))}
                   </div>
                </div>
             </div>
          </div>
        )}

        {status === AppStatus.EXAM && session && (
          <ExamView question={session.questions[session.currentIndex]} currentIndex={session.currentIndex} totalQuestions={session.questions.length} onAnswer={(s) => { const correct = s === session.questions[session.currentIndex].correctAnswer; setSession(prev => prev ? ({ ...prev, score: correct ? prev.score + 1 : prev.score, answers: { ...prev.answers, [prev.questions[prev.currentIndex].id]: s } }) : null); }} onNext={() => { if (session.currentIndex + 1 >= session.questions.length) { saveToHistory(session); setStatus(AppStatus.RESULT); } else { setSession(prev => prev ? ({ ...prev, currentIndex: prev.currentIndex + 1 }) : null); } }} />
        )}

        {status === AppStatus.STATS && globalStats && (
          <div className="py-12">
            <div className="flex justify-between items-end mb-12">
              <div>
                <h2 className="text-4xl font-black tracking-tight">Sua Performance</h2>
                <p className="text-slate-500">Análise detalhada e comparação global.</p>
              </div>
              <button onClick={() => setStatus(AppStatus.SETUP)} className="text-indigo-600 font-bold">Voltar</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              <div className="bg-white p-8 rounded-[2.5rem] shadow-lg border border-slate-100">
                <div className="text-slate-400 text-[10px] font-black uppercase mb-2">Seus Simulados</div>
                <div className="text-4xl font-black">{userProfile?.totalExams || 0}</div>
              </div>
              <div className="bg-white p-8 rounded-[2.5rem] shadow-lg border border-slate-100">
                <div className="text-slate-400 text-[10px] font-black uppercase mb-2">Sua Média</div>
                <div className="text-4xl font-black text-indigo-600">{Math.round(userProfile?.averageScore || 0)}%</div>
              </div>
              <div className="bg-white p-8 rounded-[2.5rem] shadow-lg border border-slate-100">
                <div className="text-slate-400 text-[10px] font-black uppercase mb-2">Média Global</div>
                <div className="text-4xl font-black text-emerald-500">{globalStats.averageGlobalScore}%</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100">
                <h3 className="text-xl font-black mb-6">Top Performers</h3>
                <div className="space-y-4">
                  {globalStats.topPerformers.map((p, i) => (
                    <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                      <div className="flex items-center gap-4">
                        <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-black">{i+1}</div>
                        <span className="font-bold text-slate-700">{p.name}</span>
                      </div>
                      <span className="font-black text-indigo-600">{p.score}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100 flex flex-col justify-center items-center text-center">
                <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-3xl flex items-center justify-center mb-6">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h3 className="text-2xl font-black mb-2">Você está no topo!</h3>
                <p className="text-slate-500 leading-relaxed">Sua precisão é {Math.round(userProfile?.averageScore || 0) > globalStats.averageGlobalScore ? 'superior' : 'inferior'} à média da comunidade.</p>
              </div>
            </div>
          </div>
        )}

        {status === AppStatus.RESULT && session && (
          <div className="py-20 max-w-2xl mx-auto text-center">
            <div className="bg-white p-12 rounded-[3rem] shadow-2xl border border-slate-100">
              <div className="text-6xl mb-8">✅</div>
              <h2 className="text-4xl font-black mb-4">Simulado Concluído</h2>
              <p className="text-slate-500 mb-12">Um relatório detalhado foi enviado para <strong>{user?.email}</strong></p>
              <div className="grid grid-cols-2 gap-6 mb-12">
                <div className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100"><div className="text-5xl font-black text-slate-900">{session.score}</div><div className="text-[10px] font-bold text-slate-400 uppercase mt-2">Acertos</div></div>
                <div className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100"><div className="text-5xl font-black text-slate-900">{Math.round((session.score/session.questions.length)*100)}%</div><div className="text-[10px] font-bold text-slate-400 uppercase mt-2">Precisão</div></div>
              </div>
              <button onClick={reset} className="w-full bg-slate-900 text-white font-black py-5 rounded-2xl shadow-lg text-lg">Voltar ao Início</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
