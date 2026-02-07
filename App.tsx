
import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, QuestionData, ExamSession, HistoryEntry } from './types';
import { analyzeQuestionImage } from './services/geminiService';
import ExamView from './components/ExamView';

const MAX_CONCURRENT_REQUESTS = 2;
const REQUEST_SPACING = 1500; 

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
            console.error(err);
            if (err.message?.includes("429")) setIsRateLimited(true);
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
    questionsRef.current = [];
  };

  const progressPercent = totalToProcess > 0 ? Math.round((processedCount / totalToProcess) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3 cursor-pointer" onClick={reset}>
            <div className="w-10 h-10 bg-gradient-to-tr from-indigo-600 to-blue-500 rounded-xl flex items-center justify-center shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5a18.022 18.022 0 01-3.827-5.802M10.474 11c1.171 1.027 2.687 1.75 4.526 2.148M9 16c.143.03.284.06.425.088m8.711-2.088a14.39 14.39 0 01-2.417-1.428" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-800 tracking-tight leading-none">TrilingualPro</h1>
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">PT • EN • ES AI Exam</span>
            </div>
          </div>
          {status !== AppStatus.SETUP && (
            <button onClick={reset} className="text-sm font-bold text-slate-400 hover:text-rose-500 transition-colors">Encerrar</button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4">
        {status === AppStatus.SETUP && (
          <div className="py-20 text-center">
            <h2 className="text-5xl font-black mb-6 tracking-tight">Estude em 3 idiomas.</h2>
            <p className="text-xl text-slate-500 mb-12 max-w-2xl mx-auto">Selecione uma pasta com imagens de questões para gerar um simulado técnico trilíngue instantâneo.</p>
            <label className="inline-block cursor-pointer">
              <span className="bg-indigo-600 hover:bg-indigo-700 text-white font-black py-5 px-12 rounded-2xl shadow-xl transition-all block text-lg">Selecionar Pasta de Estudos</span>
              <input type="file" {...({ webkitdirectory: "true", directory: "true" } as any)} multiple onChange={handleFileUpload} className="hidden" />
            </label>
            {history.length > 0 && (
              <button onClick={() => setStatus(AppStatus.HISTORY)} className="block mx-auto mt-8 text-indigo-600 font-bold hover:underline">Ver Histórico de Desempenho</button>
            )}
          </div>
        )}

        {status === AppStatus.HISTORY && (
          <div className="py-12 max-w-4xl mx-auto">
             <button onClick={() => setStatus(AppStatus.SETUP)} className="text-indigo-600 font-bold mb-6 flex items-center gap-2">← Voltar</button>
             <h2 className="text-3xl font-black mb-8">Histórico de Estudos</h2>
             <div className="space-y-4">
               {history.map(entry => (
                 <div key={entry.id} className="bg-white p-6 rounded-3xl border border-slate-100 flex justify-between items-center shadow-sm">
                   <div>
                     <p className="text-xs font-bold text-slate-400 uppercase mb-1">{entry.date}</p>
                     <h4 className="font-bold text-lg">{entry.folderName}</h4>
                   </div>
                   <div className="text-right">
                     <div className="text-2xl font-black">{entry.accuracy}%</div>
                     <p className="text-xs font-bold text-slate-400">PRECISÃO</p>
                   </div>
                 </div>
               ))}
             </div>
          </div>
        )}

        {status === AppStatus.LOADING && (
          <div className="py-32 text-center">
            <div className="w-24 h-24 border-8 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mx-auto mb-8"></div>
            <h3 className="text-2xl font-bold mb-2">Processando Trilinguismo...</h3>
            <p className="text-slate-400 font-medium">{processedCount} de {totalToProcess} imagens traduzidas</p>
            {processedCount >= 1 && (
              <button onClick={() => startExam(session?.folderName || "Simulado")} className="mt-10 bg-indigo-600 text-white font-bold py-4 px-10 rounded-xl shadow-lg animate-bounce">Começar Agora</button>
            )}
          </div>
        )}

        {status === AppStatus.EXAM && session && (
          <ExamView 
            question={session.questions[session.currentIndex]}
            currentIndex={session.currentIndex}
            totalQuestions={session.questions.length}
            onAnswer={handleAnswer}
            onNext={handleNext}
          />
        )}

        {status === AppStatus.RESULT && session && (
          <div className="py-20 max-w-2xl mx-auto text-center">
            <div className="bg-white p-12 rounded-[3rem] shadow-2xl border border-slate-100">
              <div className="text-6xl mb-6">🏆</div>
              <h2 className="text-4xl font-black mb-4">Simulado Concluído</h2>
              <div className="grid grid-cols-2 gap-4 my-10">
                <div className="p-6 bg-slate-50 rounded-3xl">
                  <div className="text-4xl font-black">{session.score}</div>
                  <div className="text-xs font-bold text-slate-400 uppercase mt-1">Acertos</div>
                </div>
                <div className="p-6 bg-slate-50 rounded-3xl">
                  <div className="text-4xl font-black">{Math.round((session.score / session.questions.length) * 100)}%</div>
                  <div className="text-xs font-bold text-slate-400 uppercase mt-1">Aproveitamento</div>
                </div>
              </div>
              <button onClick={reset} className="w-full bg-indigo-600 text-white font-black py-5 rounded-2xl shadow-lg hover:scale-[1.02] transition-transform">Novo Estudo</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
