
export interface QuestionData {
  id: string;
  image: string; // base64
  extractedText: {
    question: string;
    options: { [key: string]: string };
  };
  correctAnswer: string;
  explanationPT: string;
  explanationEN: string;
}

export interface ExamSession {
  id: string;
  folderName: string;
  questions: QuestionData[];
  currentIndex: number;
  score: number;
  answers: { [key: string]: string };
  isFinished: boolean;
  isStillLoading: boolean;
}

export interface HistoryEntry {
  id: string;
  date: string;
  folderName: string;
  score: number;
  total: number;
  accuracy: number;
}

export enum AppStatus {
  SETUP = 'SETUP',
  LOADING = 'LOADING',
  EXAM = 'EXAM',
  RESULT = 'RESULT',
  HISTORY = 'HISTORY'
}
