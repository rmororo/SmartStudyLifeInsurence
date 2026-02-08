
import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, QuestionData, ExamSession, HistoryEntry } from './types';
import { analyzeQuestionImage } from './services/geminiService';
import ExamView from './components/ExamView';

// Reduced to 1 for maximum stability on Free Tier (which often allows only a few RPM)
const MAX_CONCURRENT_REQUESTS = 1;
// Spacing of 5 seconds ensures we stay below 12 RPM (most free tiers allow 15 RPM for Flash)
const REQUEST_SPACING = 5000; 

const CACHE_KEY = 'exam_ai_cache_trilingual_v1';
const HISTORY_KEY = 'exam_history_v1';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.SETUP);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [currentFilePath, setCurrentFilePath] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    setIsRateLimited(false);
    setProcessedCount(0);
    questionsRef.current = [];

    const fileArray = Array.from(files) as (File & { webkitRelativePath?: string })[];
    const validImageFiles = fileArray.filter(file => 
      file.type.startsWith('image/png') || file.type.startsWith('image/jpeg')
    );
    
    setTotalToProcess(validImageFiles.length);
    if (validImageFiles.length === 0) {
      setError("Nenhuma imagem válida encontrada.");
      setStatus(AppStatus.SETUP);
      return;
    }

    const folderName = validImageFiles[0].webkitRelativePath?.split('/')[0] || "Simulado Trilingue";

    const processBatch = async () => {
      const queue = [...validImageFiles];
      const workers = [];
      const cacheRaw = localStorage.getItem(CACHE_KEY);
      const cache = cacheRaw ? JSON.parse(cacheRaw) : {};

      const worker = async () => {
        while (queue.length > 0) {
          const file = queue.shift();
          if (!file) break;
          const cacheId = `${file.name}_${file.size}`;
          setCurrentFilePath(file.webkitRelativePath || file.name);

          try {
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve) => {
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(file);
            });

            let result;
            if (cache[cacheId]) {
              result = cache[cacheId];
              // Small delay for UI smoothness even with cache
              await new Promise(r => setTimeout(r, 200));
            } else {
              result = await analyzeQuestionImage(base64);
              cache[cacheId] = result;
              localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
              // Mandatory spacing to stay within RPM limits
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
            console.error(`Error processing ${file.name}:`, err);
            const msg = err.message || "";
            if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
              setIsRateLimited(true);
            }
          } finally {
            setProcessedCount(prev => prev + 1);
          }
        }
      };

      for (let i = 0; i < Math.min(MAX_CONCURRENT_REQUESTS, validImageFiles.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
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

  const handleAnswer = (selected: string) => {
    if (!session) return;
    const isCorrect = selected === session.questions[session.currentIndex].correctAnswer;
    setSession(prev => prev ? ({
      ...prev,
      score: isCorrect ? prev.score + 1 : prev.score,
      answers: { ...prev.answers, [prev.questions[prev.currentIndex].id]: selected }
    }) : null);
  };

  const handleNext = () => {
    if (!session) return;
    if (session.currentIndex + 1 >= session.questions.length) {
      if (session.isStillLoading) return;
      saveToHistory(session);
      setStatus(AppStatus.RESULT);
    } else {
      setSession(prev => prev ? ({ ...prev, currentIndex: prev.currentIndex + 1 }) : null);
    }
  };

  const reset = () => {
    setStatus(AppStatus.SETUP);
    setSession(null);
    setProcessedCount(0);
    setIsRateLimited(false);
    questionsRef.current = [];
  };

  const progressPercent = totalToProcess > 0 ? Math.round((processedCount / totalToProcess) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3 cursor-pointer" onClick={reset}>
            <div className="w-10 h-10 bg-gradient-to-tr from-indigo-600 to-blue-500 rounded-xl flex items-center justify-center shadow-lg transition-transform hover:scale-105">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5a18.022 18.022 0 01-3.827-5.802M10.474 11c1.171 1.027 2.687 1.75 4.526 2.148M9 16c.143.03.284.06.425.088m8.711-2.088a14.39 14.39 0 01-2.417-1.428" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-800 tracking-tight leading-none">TrilingualPro</h1>
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">PT • EN • ES AI Exam</span>
            </div>
          </div>
          <div className="flex gap-4">
            {status === AppStatus.SETUP && history.length > 0 && (
              <button 
                onClick={() => setStatus(AppStatus.HISTORY)}
                className="text-sm font-bold text-slate-600 hover:text-indigo-600 flex items-center gap-1 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Histórico
              </button>
            )}
            {status !== AppStatus.SETUP && (
              <button onClick={reset} className="text-sm font-bold text-slate-400 hover:text-rose-500 transition-colors">Encerrar</button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4">
        {status === AppStatus.SETUP && (
          <div className="py-20 text-center">
            <h2 className="text-5xl font-black mb-6 tracking-tight text-slate-900">Estude em 3 idiomas.</h2>
            <p className="text-xl text-slate-500 mb-12 max-w-2xl mx-auto leading-relaxed">
              Carregue suas questões em imagem e nossa IA cuidará da extração, tradução técnica e explicação detalhada para você.
            </p>
            <div className="bg-white p-12 rounded-[2.5rem] shadow-xl border border-slate-100 max-w-xl mx-auto mb-16 hover:border-indigo-100 transition-colors">
              <label className="inline-block cursor-pointer group w-full">
                <div className="mb-6 w-20 h-20 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <span className="bg-indigo-600 group-hover:bg-indigo-700 text-white font-black py-5 px-12 rounded-2xl shadow-xl transition-all block text-lg">Selecionar Pasta</span>
                <input type="file" {...({ webkitdirectory: "true", directory: "true" } as any)} multiple onChange={handleFileUpload} className="hidden" />
              </label>
              <p className="mt-6 text-sm text-slate-400 font-medium">Selecione uma pasta contendo as capturas de tela das questões (PNG/JPG).</p>
            </div>
          </div>
        )}

        {status === AppStatus.HISTORY && (
          <div className="py-12 max-w-4xl mx-auto">
             <button onClick={() => setStatus(AppStatus.SETUP)} className="text-indigo-600 font-bold mb-6 flex items-center gap-2 hover:translate-x-[-4px] transition-transform">
               <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
               </svg>
               Voltar
             </button>
             <h2 className="text-3xl font-black mb-8 text-slate-900 tracking-tight">Histórico de Estudos</h2>
             <div className="space-y-4">
               {history.map(entry => (
                 <div key={entry.id} className="bg-white p-6 rounded-3xl border border-slate-100 flex justify-between items-center shadow-sm hover:shadow-md transition-shadow">
                   <div>
                     <p className="text-[10px] font-black text-indigo-400 uppercase mb-1 tracking-widest">{entry.date}</p>
                     <h4 className="font-bold text-lg text-slate-800">{entry.folderName}</h4>
                     <p className="text-xs text-slate-400 font-medium">{entry.total} questões processadas</p>
                   </div>
                   <div className="text-right flex items-center gap-6">
                     <div>
                       <div className="text-2xl font-black text-slate-900">{entry.accuracy}%</div>
                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Precisão</p>
                     </div>
                     <div className="w-12 h-12 rounded-full border-4 border-slate-100 flex items-center justify-center relative">
                        <svg className="w-full h-full -rotate-90 absolute">
                          <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" className="text-indigo-500" strokeDasharray="125.6" strokeDashoffset={125.6 - (125.6 * entry.accuracy / 100)} strokeLinecap="round" />
                        </svg>
                     </div>
                   </div>
                 </div>
               ))}
             </div>
          </div>
        )}

        {status === AppStatus.LOADING && (
          <div className="py-32 text-center max-w-xl mx-auto">
            {isRateLimited && (
              <div className="mb-10 p-5 bg-amber-50 border border-amber-200 text-amber-700 rounded-2xl flex items-center gap-4 text-left animate-pulse">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.381z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <p className="font-bold text-sm uppercase tracking-tight">Limite de Cota Atingido</p>
                  <p className="text-xs opacity-90 leading-relaxed mt-1">A IA está aguardando permissão do Google para continuar. O processamento ficará mais lento para garantir que nada se perca.</p>
                </div>
              </div>
            )}
            
            <div className="relative w-32 h-32 mx-auto mb-10">
              <div className="absolute inset-0 border-8 border-indigo-100 rounded-full"></div>
              <div 
                className="absolute inset-0 border-8 border-indigo-600 rounded-full border-t-transparent animate-spin"
                style={{ animationDuration: isRateLimited ? '4s' : '1.5s' }}
              ></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-black text-slate-900">{progressPercent}%</span>
              </div>
            </div>

            <h3 className="text-3xl font-black mb-3 text-slate-900">Processando Trilinguismo...</h3>
            <p className="text-slate-500 font-medium mb-8">Analisando {processedCount} de {totalToProcess} imagens.</p>
            <div className="bg-slate-100 h-1 w-full rounded-full overflow-hidden mb-12">
               <div className="h-full bg-indigo-600 transition-all duration-1000" style={{ width: `${progressPercent}%` }}></div>
            </div>

            {processedCount >= 1 && (
              <button 
                onClick={() => startExam(session?.folderName || "Simulado")} 
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-black py-5 px-12 rounded-2xl shadow-2xl animate-bounce hover:scale-105 transition-transform"
              >
                COMEÇAR AGORA COM {processedCount} QUESTÕES
              </button>
            )}
          </div>
        )}

        {status === AppStatus.EXAM && session && (
          <div className="relative">
             {session.isStillLoading && (
               <div className="fixed bottom-6 right-6 bg-white shadow-2xl border border-slate-200 p-4 rounded-3xl z-50 flex items-center gap-4 animate-in slide-in-from-right-10">
                 <div className="w-8 h-8 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                 <div className="text-left">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Background Sync</p>
                    <p className="text-sm font-bold text-slate-700">{processedCount}/{totalToProcess} Questões</p>
                 </div>
               </div>
             )}
            <ExamView 
              question={session.questions[session.currentIndex]}
              currentIndex={session.currentIndex}
              totalQuestions={session.questions.length}
              onAnswer={handleAnswer}
              onNext={handleNext}
            />
          </div>
        )}

        {status === AppStatus.RESULT && session && (
          <div className="py-20 max-w-2xl mx-auto text-center">
            <div className="bg-white p-12 rounded-[3rem] shadow-2xl border border-slate-100 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
              <div className="text-6xl mb-8 scale-125">🏆</div>
              <h2 className="text-4xl font-black mb-4 text-slate-900">Simulado Concluído</h2>
              <p className="text-slate-500 font-medium leading-relaxed">Parabéns pelo esforço! Seu desempenho foi registrado no histórico para acompanhamento futuro.</p>
              
              <div className="grid grid-cols-2 gap-6 my-12">
                <div className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 transition-transform hover:scale-105">
                  <div className="text-5xl font-black text-slate-900">{session.score}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Acertos</div>
                </div>
                <div className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 transition-transform hover:scale-105">
                  <div className="text-5xl font-black text-slate-900">{Math.round((session.score / session.questions.length) * 100)}%</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Aproveitamento</div>
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <button onClick={reset} className="flex-1 bg-indigo-600 text-white font-black py-5 rounded-2xl shadow-lg hover:bg-indigo-700 transition-all text-lg hover:-translate-y-1">
                  Novo Estudo
                </button>
                <button onClick={() => setStatus(AppStatus.HISTORY)} className="flex-1 bg-slate-100 text-slate-600 font-black py-5 rounded-2xl hover:bg-slate-200 transition-all text-lg">
                  Ver Histórico
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="py-12 text-center border-t border-slate-200 mt-20">
         <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em]">SmartStudy Trilingual Engine v2.0</p>
      </footer>
    </div>
  );
};

export default App;
