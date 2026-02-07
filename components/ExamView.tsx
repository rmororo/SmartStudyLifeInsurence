
import React, { useState } from 'react';
import { QuestionData } from '../types';

interface ExamViewProps {
  question: QuestionData;
  onAnswer: (selected: string) => void;
  onNext: () => void;
  currentIndex: number;
  totalQuestions: number;
}

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

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Questão {currentIndex + 1} de {totalQuestions}</span>
          <div className="w-64 h-2 bg-slate-200 rounded-full mt-2 overflow-hidden">
            <div 
              className="h-full bg-blue-600 transition-all duration-500" 
              style={{ width: `${((currentIndex + 1) / totalQuestions) * 100}%` }}
            ></div>
          </div>
        </div>
        <div className="text-right">
          <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-md text-sm font-medium border border-slate-200">
            Simulado Oficial (Draft)
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Original Image & Extracted Context */}
        <div className="space-y-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-widest">Imagem Original / Original Image</h3>
            <img 
              src={question.image} 
              alt="Question" 
              className="w-full h-auto rounded-lg border border-slate-100"
            />
          </div>
          
          <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
            <h2 className="text-xl font-semibold text-slate-800 leading-relaxed">
              {question.extractedText.question}
            </h2>
          </div>
        </div>

        {/* Right: Interaction and Feedback */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6">
              <h3 className="text-sm font-bold text-slate-500 mb-4 uppercase tracking-wider">Selecione a resposta / Select your answer</h3>
              <div className="space-y-3">
                {Object.entries(question.extractedText.options).map(([key, text]) => {
                  if (!text) return null;
                  const isSelected = selectedOption === key;
                  const isCorrectAnswer = key === question.correctAnswer;
                  
                  let buttonClass = "w-full text-left p-4 rounded-lg border transition-all duration-200 flex items-start gap-3 ";
                  
                  if (showExplanation) {
                    if (isCorrectAnswer) {
                      buttonClass += "bg-emerald-50 border-emerald-500 text-emerald-900 shadow-sm";
                    } else if (isSelected && !isCorrectAnswer) {
                      buttonClass += "bg-rose-50 border-rose-500 text-rose-900";
                    } else {
                      buttonClass += "bg-slate-50 border-slate-200 text-slate-400 opacity-60";
                    }
                  } else {
                    buttonClass += isSelected 
                      ? "bg-blue-50 border-blue-500 text-blue-700 shadow-md ring-2 ring-blue-100" 
                      : "bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-slate-50";
                  }

                  return (
                    <button
                      key={key}
                      disabled={showExplanation}
                      onClick={() => handleOptionSelect(key)}
                      className={buttonClass}
                    >
                      <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                        showExplanation && isCorrectAnswer ? 'bg-emerald-500 text-white' : 
                        showExplanation && isSelected && !isCorrectAnswer ? 'bg-rose-500 text-white' :
                        isSelected ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {key}
                      </span>
                      <span className="flex-1 text-base">{text}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {showExplanation && (
              <div className={`p-6 border-t ${isCorrect ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                <div className="flex items-center gap-2 mb-4">
                  {isCorrect ? (
                    <span className="text-emerald-700 font-bold flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Correto! / Correct!
                    </span>
                  ) : (
                    <span className="text-rose-700 font-bold flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      Incorreto! / Incorrect!
                    </span>
                  )}
                </div>

                <div className="space-y-6">
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Explicação (PT-BR)</h4>
                    <p className="text-slate-800 text-sm leading-relaxed">{question.explanationPT}</p>
                  </div>
                  <div className="border-t border-slate-200 pt-4">
                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Explanation (EN-US)</h4>
                    <p className="text-slate-800 text-sm leading-relaxed">{question.explanationEN}</p>
                  </div>
                </div>

                <button
                  onClick={handleNext}
                  className="mt-8 w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  {currentIndex + 1 === totalQuestions ? 'Finalizar Simulado' : 'Próxima Questão / Next Question'}
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
