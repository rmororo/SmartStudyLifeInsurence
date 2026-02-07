
import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, QuestionData, ExamSession, HistoryEntry } from './types';
import { analyzeQuestionImage } from './services/geminiService';
import ExamView from './components/ExamView';

// Reduzido para 2 para ser mais amigável com a cota do Free Tier do Gemini
const MAX_CONCURRENT_REQUESTS = 2;
// Intervalo mínimo obrigatório entre requisições de um mesmo worker (ms)
const REQUEST_SPACING = 1500; 

const CACHE_KEY = 'exam_ai_cache_v1';
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
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Erro ao carregar histórico", e);
      }
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
      setError("Nenhuma imagem encontrada na pasta selecionada.");
      setStatus(AppStatus.SETUP);
      return;
    }

    const folderName = validImageFiles[0].webkitRelativePath?.split('/')[0] || "Simulado Avulso";

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
              // Adiciona um pequeno delay aleatório extra para evitar disparos simultâneos perfeitos
              await new Promise(r => setTimeout(r, Math.random() * 500));
              result = await analyzeQuestionImage(base64);
              cache[cacheId] = result;
              localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
              // Espaçamento obrigatório após chamada bem sucedida para manter a saúde da cota
              await new Promise(r => setTimeout(r, REQUEST_SPACING));
            }

            const newQuestion: QuestionData = {
              id: `q-${Math.random().toString(36).substr(2, 9)}`,
              image: base64,
              extractedText: {
                question: result.question,
                options: result.options
              },
              correctAnswer: result.correctAnswer,
              explanationPT: result.explanationPT,
              explanationEN: result.explanationEN
            };

            questionsRef.current.push(newQuestion);
            
            setSession(prev => prev ? {
              ...prev,
              questions: [...questionsRef.current]
            } : null);

          } catch (err: any) {
            console.error(`Erro ao processar ${file.name}:`, err);
            if (err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED")) {
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
      if (status === AppStatus.LOADING && questionsRef.current.length > 0) {
        startExam(folderName);
      }
    };

    processBatch();
  };

  const startExam = (folderName: string) => {
    if (questionsRef.current.length === 0) return;
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
    setError(null);
    setIsRateLimited(false);
    questionsRef.current = [];
  };

  const clearHistory = () => {
    if(confirm("Deseja realmente apagar todo o histórico?")) {
      setHistory([]);
      localStorage.removeItem(HISTORY_KEY);
    }
  }

  const progressPercent = totalToProcess > 0 ? Math.round((processedCount / totalToProcess) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3 cursor-pointer" onClick={reset}>
            <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg transform hover:rotate-6 transition-transform">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-800 tracking-tight leading-none">SmartStudy</h1>
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Memory & IA Analytics</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {status === AppStatus.SETUP && history.length > 0 && (
              <button 
                onClick={() => setStatus(AppStatus.HISTORY)}
                className="text-sm font-bold text-slate-600 hover:text-blue-600 flex items-center gap-2 transition-colors px-4 py-2 rounded-full hover:bg-slate-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Ver Histórico
              </button>
            )}
            {status !== AppStatus.SETUP && (
              <button onClick={reset} className="text-sm font-bold text-rose-600 hover:bg-rose-50 px-4 py-2 rounded-full transition-colors">Sair</button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {status === AppStatus.SETUP && (
          <div className="py-16 text-center">
            <div className="mb-12">
              <h2 className="text-5xl font-black text-slate-900 mb-6 tracking-tight">Evolua seu estudo com IA.</h2>
              <p className="text-xl text-slate-500 max-w-2xl mx-auto">
                Suas questões são processadas uma única vez e armazenadas para sempre. 
                Estude com explicações bilíngues geradas instantaneamente.
              </p>
            </div>

            <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
              <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 flex flex-col items-center group hover:scale-[1.02] transition-all">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-6">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-4">Novo Simulado</h3>
                <label className="w-full cursor-pointer">
                  <span className="block w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 transition-all shadow-lg">Selecionar Pasta</span>
                  <input type="file" {...({ webkitdirectory: "true", directory: "true" } as any)} multiple onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 flex flex-col items-center group hover:scale-[1.02] transition-all">
                <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mb-6">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-4">Ver Desempenho</h3>
                <button 
                  onClick={() => setStatus(AppStatus.HISTORY)}
                  className="w-full bg-white border-2 border-slate-200 text-slate-700 font-bold py-4 rounded-2xl hover:bg-slate-50 transition-all"
                >
                  Histórico ({history.length})
                </button>
              </div>
            </div>
          </div>
        )}

        {status === AppStatus.HISTORY && (
          <div className="py-12 max-w-4xl mx-auto">
            <div className="flex justify-between items-end mb-10">
              <div>
                <button onClick={() => setStatus(AppStatus.SETUP)} className="text-blue-600 font-bold text-sm mb-2 flex items-center gap-1">
                  ← Voltar para Início
                </button>
                <h2 className="text-4xl font-black text-slate-900">Seu Histórico</h2>
              </div>
              <button onClick={clearHistory} className="text-xs font-bold text-rose-500 hover:underline">Limpar Histórico</button>
            </div>

            {history.length === 0 ? (
              <div className="bg-white p-20 rounded-3xl text-center border border-dashed border-slate-300">
                <p className="text-slate-400 font-medium">Nenhum simulado registrado ainda.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {history.map((entry) => (
                  <div key={entry.id} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:shadow-md transition-shadow">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-black bg-blue-100 text-blue-600 px-2 py-0.5 rounded uppercase">{entry.date}</span>
                      </div>
                      <h4 className="text-lg font-bold text-slate-800 mb-1">{entry.folderName}</h4>
                      <p className="text-xs text-slate-400 font-medium">Total de {entry.total} questões analisadas</p>
                    </div>

                    <div className="flex items-center gap-8">
                      <div className="text-right">
                        <div className="text-2xl font-black text-slate-900">{entry.score}<span className="text-slate-300 text-sm">/{entry.total}</span></div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Pontuação</div>
                      </div>
                      
                      <div className="w-32">
                        <div className="flex justify-between text-[10px] font-bold mb-1">
                          <span className="text-slate-400 uppercase tracking-tighter">Precisão</span>
                          <span className={`${entry.accuracy >= 70 ? 'text-emerald-500' : 'text-amber-500'}`}>{entry.accuracy}%</span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-1000 ${entry.accuracy >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                            style={{ width: `${entry.accuracy}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {status === AppStatus.LOADING && (
          <div className="max-w-xl mx-auto py-32 text-center">
            {isRateLimited && (
              <div className="mb-8 p-4 bg-amber-50 border border-amber-200 text-amber-700 rounded-2xl text-sm font-medium flex items-center gap-3 animate-pulse">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                Estamos aguardando a liberação da cota da IA pelo Google. Isso pode demorar alguns segundos.
              </div>
            )}

            <div className="relative w-48 h-48 mx-auto mb-12">
              <svg className="w-full h-full -rotate-90">
                <circle cx="96" cy="96" r="80" className="stroke-slate-100 fill-none stroke-[12]" />
                <circle 
                  cx="96" cy="96" r="80" 
                  className="stroke-blue-600 fill-none stroke-[12] transition-all duration-300 ease-out"
                  style={{ 
                    strokeDasharray: 502, 
                    strokeDashoffset: 502 - (502 * progressPercent) / 100,
                    strokeLinecap: 'round'
                  }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-black text-slate-900">{progressPercent}%</span>
              </div>
            </div>
            
            <h3 className="text-2xl font-bold text-slate-800 mb-3">Preparando seu material...</h3>
            <p className="text-slate-400 text-sm italic animate-pulse truncate px-10">{currentFilePath}</p>

            {processedCount >= 1 && (
              <button 
                onClick={() => startExam(session?.folderName || "Simulado")}
                className="mt-12 bg-blue-600 hover:bg-blue-700 text-white font-black py-4 px-12 rounded-2xl shadow-xl animate-bounce tracking-tight"
              >
                COMEÇAR AGORA ({processedCount})
              </button>
            )}
          </div>
        )}

        {status === AppStatus.EXAM && session && (
          <div className="relative py-8">
            {session.isStillLoading && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur-md shadow-2xl border border-slate-200 px-6 py-3 rounded-full z-50 flex items-center gap-4 animate-in fade-in slide-in-from-bottom-4">
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs font-black text-slate-600 uppercase tracking-widest">
                  Processando em Background: {processedCount}/{totalToProcess}
                </span>
                {isRateLimited && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold">RATE LIMIT</span>}
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
          <div className="max-w-2xl mx-auto py-20">
             <div className="bg-white rounded-[2rem] p-12 shadow-2xl border border-slate-100 text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-400 to-blue-500"></div>
              
              <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-8">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <h2 className="text-4xl font-black text-slate-900 mb-4 tracking-tighter">Excelente trabalho!</h2>
              <p className="text-slate-500 mb-12 font-medium">Os resultados foram salvos no seu histórico pessoal.</p>

              <div className="grid grid-cols-2 gap-6 mb-12">
                <div className="p-8 bg-slate-50 rounded-3xl">
                  <div className="text-5xl font-black text-slate-900">{session.score}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Acertos</div>
                </div>
                <div className="p-8 bg-slate-50 rounded-3xl">
                  <div className="text-5xl font-black text-slate-900">{Math.round((session.score / session.questions.length) * 100)}%</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Precisão</div>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <button onClick={reset} className="w-full bg-blue-600 text-white font-black py-5 rounded-2xl shadow-lg hover:bg-blue-700 transition-all text-lg">
                  Novo Simulado de Pasta
                </button>
                <button onClick={() => setStatus(AppStatus.HISTORY)} className="w-full bg-slate-100 text-slate-600 font-bold py-5 rounded-2xl hover:bg-slate-200 transition-all">
                  Ver Todo o Histórico
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="py-12 border-t border-slate-200 mt-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">SmartStudy AI Dashboard © 2024</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
