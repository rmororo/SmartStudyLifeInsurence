
import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, QuestionData, ExamSession, HistoryEntry } from './types';
import { analyzeQuestionImage } from './services/geminiService';
import ExamView from './components/ExamView';

const MAX_CONCURRENT_REQUESTS = 1;
const REQUEST_SPACING = 5000; 

const CACHE_KEY = 'exam_ai_cache_trilingual_v1';
const HISTORY_KEY = 'exam_history_v1';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.SETUP);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [cacheHits, setCacheHits] = useState(0);
  const [currentFilePath, setCurrentFilePath] = useState("");
  const [isRateLimited, setIsRateLimited] = useState(false);
  
  const questionsRef = useRef<QuestionData[]>([]);

  useEffect(() => {
    const savedHistory = localStorage.getItem(HISTORY_KEY);
    if (savedHistory) {
      try { setHistory(JSON.parse(savedHistory)); } catch (e) {}
    }
  }, []);

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

    setStatus(AppStatus.LOADING);
    setIsRateLimited(false);
    setProcessedCount(0);
    setCacheHits(0);
    questionsRef.current = [];

    const fileArray = Array.from(files) as (File & { webkitRelativePath?: string })[];
    const validImageFiles = fileArray.filter(file => 
      file.type.startsWith('image/png') || file.type.startsWith('image/jpeg')
    );
    
    setTotalToProcess(validImageFiles.length);
    if (validImageFiles.length === 0) {
      setStatus(AppStatus.SETUP);
      return;
    }

    const folderName = validImageFiles[0].webkitRelativePath?.split('/')[0] || "Simulado Local";

    const processBatch = async () => {
      const queue = [...validImageFiles];
      const cacheRaw = localStorage.getItem(CACHE_KEY);
      const cache = cacheRaw ? JSON.parse(cacheRaw) : {};

      const processFile = async () => {
        while (queue.length > 0) {
          const file = queue.shift();
          if (!file) break;
          const cacheId = `${file.name}_${file.size}`; // Impressão digital do arquivo
          setCurrentFilePath(file.name);

          try {
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve) => {
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(file);
            });

            let result;
            if (cache[cacheId]) {
              result = cache[cacheId];
              setCacheHits(prev => prev + 1);
            } else {
              result = await analyzeQuestionImage(base64);
              cache[cacheId] = result;
              localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
              await new Promise(r => setTimeout(r, REQUEST_SPACING));
            }

            const newQuestion: QuestionData = {
              id: `q-${Math.random().toString(36).substr(2, 9)}`,
              image: base64,
              texts: {
                question: result.question,
                options: result.options
              },
              correctAnswer: result.correctAnswer,
              explanations: result.explanations
            };

            questionsRef.current.push(newQuestion);
            setSession(prev => prev ? { ...prev, questions: [...questionsRef.current] } : null);
          } catch (err: any) {
            if (err.message?.includes("429")) setIsRateLimited(true);
          } finally {
            setProcessedCount(prev => prev + 1);
          }
        }
      };

      await processFile();
      setSession(prev => prev ? { ...prev, isStillLoading: false } : null);
      if (status === AppStatus.LOADING && questionsRef.current.length > 0) startExam(folderName);
    };
    processBatch();
  };

  const startExam = (folderName: string) => {
    setSession({
      id: Date.now().toString(),
      folderName,
      questions: [...questionsRef.current],
      currentIndex: 0,
      score: 0,
      answers: {},
      isFinished: false,
      isStillLoading: processedCount < totalToProcess
    });
    setStatus(AppStatus.EXAM);
  };

  const reset = () => {
    setStatus(AppStatus.SETUP);
    setSession(null);
    setProcessedCount(0);
    setCacheHits(0);
    setIsRateLimited(false);
    questionsRef.current = [];
  };

  const progressPercent = totalToProcess > 0 ? Math.round((processedCount / totalToProcess) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3 cursor-pointer" onClick={reset}>
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5a18.022 18.022 0 01-3.827-5.802M10.474 11c1.171 1.027 2.687 1.75 4.526 2.148M9 16c.143.03.284.06.425.088m8.711-2.088a14.39 14.39 0 01-2.417-1.428" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-800 tracking-tight leading-none">TrilingualPro</h1>
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Local-First AI Exam</span>
            </div>
          </div>
          <div className="flex gap-4">
            {status === AppStatus.SETUP && history.length > 0 && (
              <button onClick={() => setStatus(AppStatus.HISTORY)} className="text-sm font-bold text-slate-600 hover:text-indigo-600 flex items-center gap-1 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Histórico
              </button>
            )}
            {status !== AppStatus.SETUP && (
              <button onClick={reset} className="text-sm font-bold text-slate-400 hover:text-rose-500 transition-colors">Sair</button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4">
        {status === AppStatus.SETUP && (
          <div className="py-20 text-center">
            <h2 className="text-5xl font-black mb-6 tracking-tight text-slate-900">Estudos em Laptop.</h2>
            <p className="text-xl text-slate-500 mb-12 max-w-2xl mx-auto leading-relaxed">
              O sistema armazena os resultados no seu navegador. Re-selecione a pasta para carregar as imagens sem gastar sua cota de IA.
            </p>
            <div className="bg-white p-12 rounded-[2.5rem] shadow-xl border border-slate-100 max-w-xl mx-auto mb-16">
              <label className="inline-block cursor-pointer group w-full">
                <div className="mb-6 w-20 h-20 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                </div>
                <span className="bg-indigo-600 group-hover:bg-indigo-700 text-white font-black py-5 px-12 rounded-2xl shadow-xl transition-all block text-lg">Selecionar Pasta Local</span>
                <input type="file" {...({ webkitdirectory: "true", directory: "true" } as any)} multiple onChange={handleFileUpload} className="hidden" />
              </label>
              <div className="mt-8 flex justify-center gap-6 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Cache Ativo</span>
                <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500"></div> On-Premise Ready</span>
              </div>
            </div>
          </div>
        )}

        {status === AppStatus.HISTORY && (
          <div className="py-12 max-w-4xl mx-auto">
             <button onClick={() => setStatus(AppStatus.SETUP)} className="text-indigo-600 font-bold mb-6 flex items-center gap-2">← Voltar</button>
             <h2 className="text-3xl font-black mb-8 text-slate-900">Histórico</h2>
             <div className="space-y-4">
               {history.map(entry => (
                 <div key={entry.id} className="bg-white p-6 rounded-3xl border border-slate-100 flex justify-between items-center shadow-sm">
                   <div>
                     <p className="text-[10px] font-black text-indigo-400 uppercase mb-1 tracking-widest">{entry.date}</p>
                     <h4 className="font-bold text-lg text-slate-800">{entry.folderName}</h4>
                   </div>
                   <div className="text-right">
                     <div className="text-2xl font-black text-slate-900">{entry.accuracy}%</div>
                   </div>
                 </div>
               ))}
             </div>
          </div>
        )}

        {status === AppStatus.LOADING && (
          <div className="py-32 text-center max-w-xl mx-auto">
            <div className="relative w-32 h-32 mx-auto mb-10">
              <svg className="w-full h-full -rotate-90">
                <circle cx="64" cy="64" r="50" className="stroke-slate-100 fill-none stroke-[8]" />
                <circle cx="64" cy="64" r="50" className="stroke-indigo-600 fill-none stroke-[8] transition-all duration-500" style={{ strokeDasharray: 314, strokeDashoffset: 314 - (314 * progressPercent / 100), strokeLinecap: 'round' }} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-black text-xl">{progressPercent}%</div>
            </div>

            <h3 className="text-3xl font-black mb-3 text-slate-900">Carregando Simulado...</h3>
            <p className="text-slate-500 font-medium mb-4">Arquivos: {processedCount} / {totalToProcess}</p>
            
            <div className="flex justify-center gap-4 mb-10">
               <div className="bg-emerald-50 text-emerald-600 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest">
                 Recuperados do Cache: {cacheHits}
               </div>
               <div className="bg-blue-50 text-blue-600 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest">
                 Novos via IA: {processedCount - cacheHits}
               </div>
            </div>

            {processedCount >= 1 && (
              <button onClick={() => startExam(session?.folderName || "Simulado")} className="bg-indigo-600 text-white font-black py-5 px-12 rounded-2xl shadow-2xl animate-bounce">
                INICIAR ({processedCount})
              </button>
            )}
          </div>
        )}

        {status === AppStatus.EXAM && session && (
          <ExamView 
            question={session.questions[session.currentIndex]}
            currentIndex={session.currentIndex}
            totalQuestions={session.questions.length}
            onAnswer={(s) => {
              const correct = s === session.questions[session.currentIndex].correctAnswer;
              setSession(prev => prev ? ({ ...prev, score: correct ? prev.score + 1 : prev.score, answers: { ...prev.answers, [prev.questions[prev.currentIndex].id]: s } }) : null);
            }}
            onNext={() => {
              if (session.currentIndex + 1 >= session.questions.length) {
                saveToHistory(session);
                setStatus(AppStatus.RESULT);
              } else {
                setSession(prev => prev ? ({ ...prev, currentIndex: prev.currentIndex + 1 }) : null);
              }
            }}
          />
        )}

        {status === AppStatus.RESULT && session && (
          <div className="py-20 max-w-2xl mx-auto text-center">
            <div className="bg-white p-12 rounded-[3rem] shadow-2xl border border-slate-100">
              <div className="text-6xl mb-8">🎯</div>
              <h2 className="text-4xl font-black mb-4">Simulado Finalizado</h2>
              <div className="grid grid-cols-2 gap-6 my-12">
                <div className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100">
                  <div className="text-5xl font-black text-slate-900">{session.score}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Acertos</div>
                </div>
                <div className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100">
                  <div className="text-5xl font-black text-slate-900">{Math.round((session.score / session.questions.length) * 100)}%</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Precisão</div>
                </div>
              </div>
              <button onClick={reset} className="w-full bg-indigo-600 text-white font-black py-5 rounded-2xl shadow-lg text-lg">
                Voltar ao Início
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
