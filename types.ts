
export interface QuestionData {
  id: string;
  image: string; // base64
  texts: {
    question: { pt: string; en: string; es: string };
    options: {
      pt: { [key: string]: string };
      en: { [key: string]: string };
      es: { [key: string]: string };
    };
  };
  correctAnswer: string;
  explanations: {
    pt: string;
    en: string;
    es: string;
  };
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
  HISTORY = 'HISTORY',
  STATS = 'STATS'
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  totalExams: number;
  averageScore: number;
  lastExamDate: string;
}

export interface GlobalStats {
  totalUsers: number;
  totalExams: number;
  averageGlobalScore: number;
  topPerformers: { name: string; score: number }[];
}
