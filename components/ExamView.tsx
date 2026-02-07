
import React, { useState } from 'react';
import { QuestionData } from '../types';

interface ExamViewProps {
  question: QuestionData;
  onAnswer: (selected: string) => void;
  onNext: () => void;
  currentIndex: number;
  totalQuestions: number;
}

type Lang = 'pt' | 'en' | 'es';

const ExamView: React.FC<ExamViewProps> = ({ 
  question, 
  onAnswer, 
  onNext, 
  currentIndex, 
  totalQuestions 
}) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [activeLang, setActiveLang] = useState<Lang>('pt');

  const handleOptionSelect = (option: string) => {
    if (showExplanation) return;
    setSelectedOption(option);
    const correct = option === question.correctAnswer;
    setIsCorrect(correct);
    setShowExplanation(true);
    onAnswer(option);
  };

  const handleNext = () => {
    setSelectedOption(null);
    setShowExplanation(false);
    setIsCorrect(null);
    onNext();
  };

  const LangBadge = ({ lang, label }: { lang: Lang, label: string }) => (
    <button 
      onClick={() => setActiveLang(lang)}
      className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
        activeLang === lang ? 'bg-indigo-600 text-white shadow-md scale-110' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="max-w-7xl mx-auto py-8">
      {/* Progress & Language Switcher */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Progresso do Simulado</span>
          <div className="flex items-center gap-4 mt-1">
             <div className="w-48 h-2 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${((currentIndex + 1) / totalQuestions) * 100}%` }}></div>
             </div>
             <span className="font-bold text-slate-700">{currentIndex + 1} / {totalQuestions}</span>
          </div>
        </div>
        
        <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-100 flex gap-2">
           <LangBadge lang="pt" label="Português" />
           <LangBadge lang="en" label="English" />
           <LangBadge lang="es" label="Español" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Col: Original Media & Question Text */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100">
             <span className="text-[10px] font-black text-slate-300 uppercase block mb-3">Documento Original</span>
             <img src={question.image} alt="Original" className="w-full rounded-2xl border border-slate-50" />
          </div>

          <div className="bg-indigo-50 p-8 rounded-[2.5rem] border border-indigo-100 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
               <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
               </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-800 leading-relaxed relative z-10">
              {question.texts.question[activeLang]}
            </h2>
          </div>
        </div>

        {/* Right Col: Trilingual Options & Explanations */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-100 overflow-hidden">
            <div className="p-8">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Selecione uma Alternativa</h3>
              <div className="space-y-4">
                {Object.keys(question.texts.options[activeLang]).map((key) => {
                  const optText = (question.texts.options[activeLang] as any)[key];
                  if (!optText) return null;

                  const isSelected = selectedOption === key;
                  const isCorrectAnswer = key === question.correctAnswer;
                  
                  let btnStyle = "w-full text-left p-5 rounded-2xl border-2 transition-all duration-300 flex items-start gap-4 ";
                  
                  if (showExplanation) {
                    if (isCorrectAnswer) btnStyle += "bg-emerald-50 border-emerald-500 text-emerald-900";
                    else if (isSelected) btnStyle += "bg-rose-50 border-rose-500 text-rose-900";
                    else btnStyle += "bg-slate-50 border-slate-100 text-slate-300 opacity-50";
                  } else {
                    btnStyle += isSelected 
                      ? "bg-indigo-50 border-indigo-500 text-indigo-900 shadow-md" 
                      : "bg-white border-slate-100 hover:border-indigo-200 hover:bg-slate-50 text-slate-700";
                  }

                  return (
                    <button key={key} disabled={showExplanation} onClick={() => handleOptionSelect(key)} className={btnStyle}>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-black flex-shrink-0 ${
                        showExplanation && isCorrectAnswer ? 'bg-emerald-500 text-white' :
                        showExplanation && isSelected ? 'bg-rose-500 text-white' :
                        isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {key}
                      </span>
                      <div className="flex-1">
                         <div className="font-bold text-base leading-snug">{optText}</div>
                         {/* Small hint of other languages for technical comparison */}
                         {!showExplanation && (
                           <div className="mt-1 flex gap-2 opacity-40 group-hover:opacity-100">
                             {activeLang !== 'pt' && <span className="text-[10px] font-medium">PT: {(question.texts.options.pt as any)[key]?.substring(0, 30)}...</span>}
                             {activeLang !== 'en' && <span className="text-[10px] font-medium">EN: {(question.texts.options.en as any)[key]?.substring(0, 30)}...</span>}
                           </div>
                         )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {showExplanation && (
              <div className={`p-8 border-t-2 animate-in slide-in-from-bottom-4 duration-500 ${isCorrect ? 'bg-emerald-50/50 border-emerald-100' : 'bg-rose-50/50 border-rose-100'}`}>
                <div className="flex items-center gap-3 mb-6">
                   <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isCorrect ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                      {isCorrect ? (
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                      ) : (
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                      )}
                   </div>
                   <div>
                      <h4 className={`text-xl font-black ${isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {isCorrect ? 'Excelente!' : 'Não foi dessa vez.'}
                      </h4>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Feedback Pedagógico Trilíngue</p>
                   </div>
                </div>

                <div className="space-y-6">
                   <div className="bg-white/60 p-5 rounded-2xl border border-white/50">
                      <h5 className="text-[10px] font-black text-indigo-400 uppercase mb-2 tracking-widest flex justify-between">
                         <span>Explicação Detalhada</span>
                         <span className="bg-indigo-100 px-2 py-0.5 rounded text-indigo-600">{activeLang}</span>
                      </h5>
                      <p className="text-slate-700 text-sm leading-relaxed italic">
                        "{question.explanations[activeLang]}"
                      </p>
                   </div>
                   
                   {/* Multilingual Preview */}
                   <div className="grid grid-cols-2 gap-4">
                      {Object.keys(question.explanations).filter(l => l !== activeLang).map(l => (
                        <div key={l} className="bg-slate-100/50 p-4 rounded-xl border border-slate-200/50">
                           <h6 className="text-[9px] font-black text-slate-400 uppercase mb-1">{l === 'pt' ? 'Português' : l === 'en' ? 'English' : 'Español'}</h6>
                           <p className="text-[10px] text-slate-500 line-clamp-3">{question.explanations[l as Lang]}</p>
                        </div>
                      ))}
                   </div>
                </div>

                <button onClick={handleNext} className="mt-10 w-full bg-slate-900 text-white font-black py-5 rounded-2xl shadow-xl hover:bg-black transition-all transform hover:-translate-y-1 active:scale-95">
                  {currentIndex + 1 === totalQuestions ? 'FINALIZAR SIMULADO' : 'PRÓXIMA QUESTÃO'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExamView;
